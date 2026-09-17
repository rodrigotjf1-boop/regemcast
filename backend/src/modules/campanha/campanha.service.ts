/**
 * Campanhas: criar, disparar e contar o que realmente aconteceu.
 *
 * Este módulo nasce corrigindo o defeito mais caro que a auditoria do Regem
 * encontrou: **lá uma campanha marca "100% enviada" com 100% das mensagens em
 * `failed`**. A causa é simples e vale repetir, porque é fácil de reintroduzir:
 * o envio guarda "a Meta aceitou o POST" e nunca reconcilia com o que ela
 * responde depois, por webhook, sobre cada mensagem.
 *
 * Aqui o caminho fecha: guardamos o `wamid` de cada destinatário, e o webhook
 * encontra a linha por ele. "Enviada" e "entregue" são estados diferentes, e a
 * tela mostra os dois.
 *
 * ## Por que criar e disparar são dois passos
 *
 * A campanha e os destinatários são gravados e **commitados** antes de qualquer
 * mensagem sair. Se o disparo falhar no meio, o registro do que ia ser enviado
 * já existe — dá para ver, retomar e explicar. Criar e enviar no mesmo request
 * significa que um erro no fim apaga o registro de mensagens que já saíram e
 * já foram cobradas.
 *
 * ## O que ainda não é
 *
 * O disparo é **síncrono**, dentro do request, com teto de destinatários. Não é
 * a versão final: a fila (BullMQ/Redis) entra na Fase 4 e resolve retomada,
 * vazão e paralelismo. O teto existe justamente para que a limitação seja
 * recusa explícita em vez de timeout no meio.
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';

import { paraCloudApi } from '../../common/telefone';
import { ContextoDb } from '../../db/contexto';
import { assinatura, campanha, campanhaDestinatario, conta, waNumero } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ErroGraph, GraphService } from '../meta/graph.service';
import { MetaService } from '../meta/meta.service';
import { TelemetriaService } from '../telemetria/telemetria.service';
import type { CriarCampanhaDto } from './dto/criar-campanha.dto';
import { decidir, momentoNoFuso, type RegraDeEnvio } from './janela';

type Executor = { execute: (q: SQL) => Promise<unknown> };

export const TITULO_DESCADASTRADO = 'Pediu para sair';

/**
 * Tira da fila quem pediu para não receber mais mensagens.
 *
 * Vira `falhou` com o motivo, e não some da campanha: sumir faria o total não
 * bater com o que a pessoa montou, e ela não saberia por que alguém ficou de
 * fora. Nada é enviado, nada conta no consumo do plano.
 *
 * Uma única consulta para a campanha inteira — conferir contato a contato seria
 * uma ida ao banco por destinatário.
 */
export async function marcarDescadastrados(db: Executor, filtro: SQL): Promise<void> {
  await db.execute(sql`
    update campanha_destinatario d
       set status = 'falhou',
           erro_titulo = ${TITULO_DESCADASTRADO},
           erro_detalhe = 'Esta pessoa pediu para não receber mais mensagens da sua empresa. Nada foi enviado.',
           falhou_em = now()
      from contato c
     where ${filtro}
       and d.status = 'pendente'
       and c.conta_id = d.conta_id
       and c.telefone_e164 = d.telefone_e164
       and c.opt_out = true
  `);
}

/** Estados em que a campanha ainda tem trabalho para o worker. */
const ESTADOS_ATIVOS = ['agendada', 'enviando'] as const;

/**
 * Quantas mensagens por rodada, no máximo.
 *
 * Pequeno de propósito: a rodada fala com a Meta uma vez por destinatário, e
 * uma rodada longa atrasa as campanhas de todas as outras contas que esperam
 * a vez. Vinte por rodada, a cada poucos segundos, mantém a fila andando para
 * todo mundo.
 */
const LOTE_POR_RODADA = 20;

/** Depois de quanto tempo um destinatário em "enviando" é considerado preso. */
const MINUTOS_PRESO = 10;

export interface ResumoCampanha {
  id: string;
  nome: string;
  modeloNome: string;
  modeloIdioma: string;
  status: string;
  criadoEm: Date;
  iniciadaEm: Date | null;
  concluidaEm: Date | null;
  /** Contagem por status, derivada dos destinatários — nunca de contador guardado. */
  porStatus: Record<string, number>;
  total: number;
}

@Injectable()
export class CampanhaService {
  private readonly log = new Logger('Campanha');

  constructor(
    private readonly ctx: ContextoDb,
    private readonly meta: MetaService,
    private readonly graph: GraphService,
    private readonly auditoria: AuditoriaService,
    private readonly telemetria: TelemetriaService,
  ) {}

  /** Cria a campanha com os destinatários em `pendente`. Nada é enviado aqui. */
  async criar(contaId: string, usuarioId: string, dto: CriarCampanhaDto): Promise<{ id: string }> {
    // Recusa cedo: sem WhatsApp conectado a campanha não teria como sair, e
    // deixar criar para falhar no disparo só adianta a frustração.
    const credencial = await this.meta.tokenDaConta(contaId);
    if (!credencial) {
      throw new BadRequestException(
        'Conecte sua conta do WhatsApp antes de criar uma campanha.',
      );
    }

    // Normaliza ANTES de qualquer outra coisa, por dois motivos.
    //
    // É este valor que vai para a Meta: quando a validação e a gravação usam
    // funções diferentes, o número que passou no formulário não é o número que
    // sai — foi assim que "21989751705", sem o 55, virou um destinatário
    // internacional inexistente e um erro da Meta que não explicava nada.
    //
    // E é por ele que a duplicidade tem de ser medida: "21989751705" e
    // "5521989751705" são a MESMA pessoa. Comparar o texto cru deixaria os dois
    // passarem aqui para estourar depois no índice único, com uma mensagem do
    // banco que ninguém entende.
    const normalizados = dto.destinatarios.map((d) => {
      const { e164 } = paraCloudApi(d.telefone);
      if (!e164) {
        throw new BadRequestException(
          `O telefone ${d.telefone} não é válido. Informe DDD + número, por exemplo 21 99999-8888.`,
        );
      }
      return { telefoneE164: e164, variaveis: d.variaveis ?? [] };
    });

    const repetido = normalizados.find(
      (d, i) => normalizados.findIndex((o) => o.telefoneE164 === d.telefoneE164) !== i,
    );
    if (repetido) {
      // O banco também barra (índice único), mas a mensagem dele não diz qual
      // número está repetido — e é isso que a pessoa precisa saber.
      throw new BadRequestException(
        `O telefone ${repetido.telefoneE164} aparece mais de uma vez. Cada pessoa recebe uma vez só.`,
      );
    }

    // O banco também barra tetos fora de ordem (constraint da migration 011),
    // mas o erro dele chegaria como 500. Conferir aqui devolve a frase certa.
    const tetos = [dto.maxPorDia, dto.maxPorSemana, dto.maxPorMes];
    const [dia, semana, mes] = tetos;
    if (
      (dia && semana && dia > semana) ||
      (semana && mes && semana > mes) ||
      (dia && mes && dia > mes)
    ) {
      throw new BadRequestException(
        'Os limites precisam ser crescentes: o do dia não pode passar o da semana, nem o da semana o do mês.',
      );
    }

    const [criada] = await this.ctx.db
      .insert(campanha)
      .values({
        contaId,
        nome: dto.nome.trim(),
        modeloId: dto.modeloId ?? null,
        modeloNome: dto.modeloNome,
        modeloIdioma: dto.modeloIdioma,
        modeloCategoria: dto.modeloCategoria ?? null,
        status: 'rascunho',
        criadaPor: usuarioId,
        janelaDias: dto.janelaDias ?? [],
        // Só grava a janela quando vier COMPLETA. Início sem fim não é uma
        // regra: é um formulário pela metade, e tratá-lo como janela deixaria
        // a campanha parada por uma decisão que ninguém tomou.
        janelaInicio: dto.janelaInicio && dto.janelaFim ? dto.janelaInicio : null,
        janelaFim: dto.janelaInicio && dto.janelaFim ? dto.janelaFim : null,
        pausaSegundos: dto.pausaSegundos ?? 0,
        maxPorDia: dto.maxPorDia ?? null,
        maxPorSemana: dto.maxPorSemana ?? null,
        maxPorMes: dto.maxPorMes ?? null,
      })
      .returning({ id: campanha.id });

    await this.ctx.db.insert(campanhaDestinatario).values(
      normalizados.map((d) => ({
        contaId,
        campanhaId: criada!.id,
        telefoneE164: d.telefoneE164,
        variaveis: d.variaveis,
      })),
    );

    // Já na montagem: a pessoa vê, antes de disparar, quem não vai receber e
    // por quê — em vez de descobrir no relatório depois.
    await marcarDescadastrados(this.ctx.db, sql`d.campanha_id = ${criada!.id}`);

    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuarioId,
      acao: 'campanha.criada',
      entidade: 'campanha',
      entidadeId: criada!.id,
      detalhe: {
        nome: dto.nome,
        modelo: dto.modeloNome,
        destinatarios: dto.destinatarios.length,
      },
    });

    return { id: criada!.id };
  }

  /**
   * Dispara a campanha — isto é, AGENDA.
   *
   * Nenhuma mensagem sai dentro deste request. A campanha vira `agendada` e o
   * worker a envia, rodada a rodada, respeitando janela, pausa e tetos.
   *
   * Duas razões para não enviar aqui, e as duas são defeitos que o envio
   * síncrono tinha:
   *
   * 1. Respeitar "só das 9 às 20" é impossível dentro do request: se a janela
   *    está fechada, alguém precisa enviar depois.
   * 2. O request segurava uma conexão de banco durante TODAS as chamadas à
   *    Meta. Com dez destinatários era tolerável; numa campanha de verdade, é
   *    o que esgota o pool e derruba o painel de todas as contas.
   *
   * Tudo que pode falhar de forma previsível é conferido AGORA, para o cliente
   * receber o erro na tela e não descobrir uma campanha parada horas depois.
   */
  async disparar(
    contaId: string,
    usuarioId: string,
    campanhaId: string,
  ): Promise<ResumoCampanha> {
    const alvo = await this.buscar(contaId, campanhaId);

    if (alvo.status !== 'rascunho') {
      // Disparar de novo reenviaria para quem já recebeu. Mensagem duplicada
      // queima o destinatário e cobra outra vez.
      throw new BadRequestException(
        `Esta campanha já foi disparada (está "${alvo.status}"). Crie outra para enviar de novo.`,
      );
    }

    const credencial = await this.meta.tokenDaConta(contaId);
    if (!credencial) {
      throw new BadRequestException('Conecte sua conta do WhatsApp antes de disparar.');
    }

    // Falha cedo: sem número registrado a campanha ficaria agendada para sempre.
    await this.numeroDeEnvio(contaId);

    await this.ctx.db
      .update(campanha)
      .set({ status: 'agendada', iniciadaEm: new Date() })
      .where(eq(campanha.id, campanhaId));

    const [{ total }] = await this.ctx.db
      .select({ total: count(campanhaDestinatario.id) })
      .from(campanhaDestinatario)
      .where(eq(campanhaDestinatario.campanhaId, campanhaId));

    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuarioId,
      acao: 'campanha.disparada',
      entidade: 'campanha',
      entidadeId: campanhaId,
      detalhe: { destinatarios: Number(total), modelo: alvo.modeloNome },
    });

    return this.detalhe(contaId, campanhaId);
  }

  /**
   * Retoma uma campanha pausada.
   *
   * A campanha pausa quando a conexão com o WhatsApp cai no meio do envio. Os
   * destinatários que faltavam voltaram para a fila, intactos — e é isto que
   * os coloca de volta para andar.
   *
   * Confere a conexão ANTES de reagendar. Retomar sem ela só pausaria de novo
   * na rodada seguinte, e o cliente veria o botão "funcionar" e nada sair.
   */
  async retomar(contaId: string, usuarioId: string, campanhaId: string): Promise<ResumoCampanha> {
    const alvo = await this.buscar(contaId, campanhaId);

    if (alvo.status !== 'pausada') {
      throw new BadRequestException(`Só dá para retomar uma campanha pausada — esta está "${alvo.status}".`);
    }

    const credencial = await this.meta.tokenDaConta(contaId);
    if (!credencial) {
      throw new BadRequestException('Reconecte o WhatsApp antes de retomar: a conexão ainda está fora.');
    }
    await this.numeroDeEnvio(contaId);

    await this.ctx.db
      .update(campanha)
      .set({ status: 'agendada' })
      .where(and(eq(campanha.id, campanhaId), eq(campanha.status, 'pausada')));

    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuarioId,
      acao: 'campanha.retomada',
      entidade: 'campanha',
      entidadeId: campanhaId,
      detalhe: { modelo: alvo.modeloNome },
    });

    return this.detalhe(contaId, campanhaId);
  }

  // ----------------------------------------------------------------- worker
  //
  // Tudo daqui para baixo roda FORA de request, chamado pelo worker. Não há
  // contexto de banco pronto: cada acesso abre o próprio, curto. E nenhuma
  // transação fica aberta durante uma chamada à Meta.

  /** Campanhas com trabalho pendente. Escopo de sistema: o worker não é conta nenhuma. */
  async campanhasAtivas(): Promise<string[]> {
    return this.ctx.comEscopoSistema('campanha.worker.listar', async (db) => {
      const linhas = await db
        .select({ id: campanha.id })
        .from(campanha)
        .where(inArray(campanha.status, [...ESTADOS_ATIVOS]))
        .limit(200);
      return linhas.map((l) => l.id);
    });
  }

  /**
   * Uma rodada de uma campanha.
   *
   * O passo que mais importa é a reivindicação com `FOR UPDATE SKIP LOCKED`.
   * Duas réplicas da API — ou duas rodadas sobrepostas — podem olhar a mesma
   * campanha ao mesmo tempo; sem o lock, as duas pegariam os mesmos
   * destinatários e cada pessoa receberia a mensagem duas vezes, cobrada duas
   * vezes. Com ele, a segunda pula o que a primeira já pegou. É o lock do
   * próprio Postgres: não precisa de Redis para isto.
   */
  async processarRodada(campanhaId: string, agora = new Date()): Promise<void> {
    const estado = await this.ctx.comEscopoSistema('campanha.worker.ler', async (db) => {
      const [linha] = await db
        .select({
          id: campanha.id,
          contaId: campanha.contaId,
          status: campanha.status,
          modeloNome: campanha.modeloNome,
          modeloIdioma: campanha.modeloIdioma,
          janelaDias: campanha.janelaDias,
          janelaInicio: campanha.janelaInicio,
          janelaFim: campanha.janelaFim,
          pausaSegundos: campanha.pausaSegundos,
          maxPorDia: campanha.maxPorDia,
          maxPorSemana: campanha.maxPorSemana,
          maxPorMes: campanha.maxPorMes,
          fuso: conta.timezone,
          // O ciclo em que o disparo conta. É o MESMO campo que a tela de Conta
          // usa para ler o consumo — duas definições de ciclo divergiriam.
          cicloInicio: assinatura.cicloInicio,
        })
        .from(campanha)
        .innerJoin(conta, eq(conta.id, campanha.contaId))
        .leftJoin(assinatura, eq(assinatura.contaId, campanha.contaId))
        .where(eq(campanha.id, campanhaId))
        .limit(1);

      if (!linha) return null;

      // Os períodos são contados no FUSO DA CONTA. "Hoje" em UTC começa às 21h
      // de São Paulo — o teto diário zeraria no meio da noite do cliente.
      const contagem = await db.execute(sql`
        select
          count(*) filter (where enviada_em >= date_trunc('day',   now() at time zone ${linha.fuso}) at time zone ${linha.fuso}) as dia,
          count(*) filter (where enviada_em >= date_trunc('week',  now() at time zone ${linha.fuso}) at time zone ${linha.fuso}) as semana,
          count(*) filter (where enviada_em >= date_trunc('month', now() at time zone ${linha.fuso}) at time zone ${linha.fuso}) as mes,
          max(enviada_em) as ultimo
        from campanha_destinatario
        where campanha_id = ${campanhaId} and enviada_em is not null
      `);

      return { campanha: linha, contagem: contagem.rows[0] as Record<string, unknown> };
    });

    if (!estado || !ESTADOS_ATIVOS.includes(estado.campanha.status as (typeof ESTADOS_ATIVOS)[number])) {
      return;
    }

    const c = estado.campanha;
    const regra: RegraDeEnvio = {
      janelaDias: (c.janelaDias as number[] | null) ?? [],
      janelaInicio: c.janelaInicio,
      janelaFim: c.janelaFim,
      pausaSegundos: c.pausaSegundos,
      maxPorDia: c.maxPorDia,
      maxPorSemana: c.maxPorSemana,
      maxPorMes: c.maxPorMes,
    };

    const ultimo = estado.contagem.ultimo ? new Date(String(estado.contagem.ultimo)) : null;
    const decisao = decidir(
      regra,
      momentoNoFuso(agora, c.fuso),
      {
        dia: Number(estado.contagem.dia ?? 0),
        semana: Number(estado.contagem.semana ?? 0),
        mes: Number(estado.contagem.mes ?? 0),
      },
      ultimo,
      agora,
      LOTE_POR_RODADA,
    );

    if (!decisao.pode) return;

    // Reivindicação atômica. `SKIP LOCKED` é o que impede envio duplicado.
    const reivindicados = await this.ctx.comEscopoSistema('campanha.worker.reivindicar', async (db) => {
      // Quem pediu para sair DEPOIS de a campanha ser montada não recebe. A
      // conferência é feita aqui, na hora do envio, e não só na montagem: entre
      // montar e a janela abrir podem passar dias. Mandar para quem já pediu
      // para sair viola a política da Meta e derruba a qualidade do número.
      await marcarDescadastrados(db, sql`d.campanha_id = ${campanhaId}`);

      const r = await db.execute(sql`
        update campanha_destinatario
           set status = 'enviando', atualizado_em = now()
         where id in (
           select id from campanha_destinatario
            where campanha_id = ${campanhaId} and status = 'pendente'
            order by criado_em
            for update skip locked
            limit ${decisao.quantas}
         )
        returning id, telefone_e164, variaveis
      `);
      return r.rows as { id: string; telefone_e164: string; variaveis: unknown }[];
    });

    if (!reivindicados.length) {
      await this.concluirSeTerminou(campanhaId);
      return;
    }

    await this.ctx.comEscopoSistema('campanha.worker.iniciar', (db) =>
      db
        .update(campanha)
        .set({ status: 'enviando' })
        .where(and(eq(campanha.id, campanhaId), eq(campanha.status, 'agendada'))),
    );

    // Credencial lida agora, e não guardada do disparo: o token pode ter vencido
    // entre o agendamento e esta rodada.
    const acesso = await this.ctx.comConta(c.contaId, async () => {
      const credencial = await this.meta.tokenDaConta(c.contaId);
      const [numero] = await this.ctx.db
        .select({ phoneNumberId: waNumero.phoneNumberId })
        .from(waNumero)
        .where(and(eq(waNumero.contaId, c.contaId), eq(waNumero.status, 'registrado')))
        .limit(1);
      return { credencial, phoneNumberId: numero?.phoneNumberId ?? null };
    });

    if (!acesso.credencial || !acesso.phoneNumberId) {
      // A conexão caiu entre o disparo e agora. Os destinatários VOLTAM para a
      // fila — não é culpa deles, e queimá-los como "falhou" seria perder a
      // campanha por um token vencido. A campanha pausa, para não girar em
      // falso a cada rodada.
      await this.ctx.comEscopoSistema('campanha.worker.pausar', async (db) => {
        await db
          .update(campanhaDestinatario)
          .set({ status: 'pendente' })
          .where(inArray(campanhaDestinatario.id, reivindicados.map((d) => d.id)));
        await db.update(campanha).set({ status: 'pausada' }).where(eq(campanha.id, campanhaId));
      });

      this.log.warn(
        `Campanha ${campanhaId} pausada: a conta ${c.contaId} perdeu a conexão com a Meta antes do envio.`,
      );
      return;
    }

    for (const d of reivindicados) {
      await this.enviarUm(
        c.contaId,
        { id: d.id, telefone: d.telefone_e164, variaveis: d.variaveis },
        c,
        acesso.phoneNumberId,
        acesso.credencial.token,
        c.cicloInicio,
        campanhaId,
      );
    }

    await this.concluirSeTerminou(campanhaId);
  }

  /**
   * Destinatários presos em `enviando`.
   *
   * Acontece quando o processo cai DEPOIS de reivindicar e ANTES de gravar o
   * resultado. A pergunta é o que fazer com eles, e a resposta é deliberada:
   * **viram `falhou`, e nunca voltam para `pendente` sozinhos.**
   *
   * Porque não dá para saber se a Meta recebeu. Se o processo caiu depois de a
   * Meta aceitar e antes de gravarmos o `wamid`, reenviar entregaria a mesma
   * mensagem duas vezes — cobrada duas vezes, na pessoa que talvez já tenha
   * lido a primeira. Entre perder uma mensagem e duplicá-la, numa campanha de
   * marketing, perder é o erro mais barato. E fica registrado, com motivo.
   */
  async recuperarPresos(): Promise<number> {
    return this.ctx.comEscopoSistema('campanha.worker.presos', async (db) => {
      const r = await db.execute(sql`
        update campanha_destinatario
           set status = 'falhou',
               falhou_em = now(),
               erro_titulo = 'Envio interrompido',
               erro_detalhe = 'O envio foi interrompido e não dá para saber se a mensagem chegou. Para não correr o risco de enviar duas vezes, ela não foi reenviada.'
         where status = 'enviando'
           and atualizado_em < now() - make_interval(mins => ${MINUTOS_PRESO})
        returning id
      `);
      return r.rows.length;
    });
  }

  /** Conclui a campanha quando não sobra ninguém para enviar. */
  private async concluirSeTerminou(campanhaId: string): Promise<void> {
    await this.ctx.comEscopoSistema('campanha.worker.concluir', async (db) => {
      const [{ restam }] = await db
        .select({ restam: count(campanhaDestinatario.id) })
        .from(campanhaDestinatario)
        .where(
          and(
            eq(campanhaDestinatario.campanhaId, campanhaId),
            inArray(campanhaDestinatario.status, ['pendente', 'enviando']),
          ),
        );

      if (Number(restam) === 0) {
        await db
          .update(campanha)
          .set({ status: 'concluida', concluidaEm: new Date() })
          .where(and(eq(campanha.id, campanhaId), inArray(campanha.status, [...ESTADOS_ATIVOS])));
      }
    });
  }

  /**
   * Envia para um destinatário e grava o resultado, seja qual for.
   *
   * Cada destinatário é tratado isoladamente: uma falha não interrompe os
   * outros, e o motivo real fica gravado na linha dele. A gravação abre uma
   * transação curta DEPOIS da chamada à Meta — nunca uma que fique aberta
   * durante ela.
   */
  private async enviarUm(
    contaId: string,
    destinatario: { id: string; telefone: string; variaveis: unknown },
    alvo: { modeloNome: string; modeloIdioma: string },
    phoneNumberId: string,
    token: string,
    cicloInicio: Date | null,
    campanhaId: string,
  ): Promise<void> {
    const variaveis = Array.isArray(destinatario.variaveis)
      ? destinatario.variaveis.map((v) => String(v))
      : [];

    try {
      const wamid = await this.graph.enviarModelo(
        phoneNumberId,
        {
          para: destinatario.telefone,
          modelo: alvo.modeloNome,
          idioma: alvo.modeloIdioma,
          variaveis,
        },
        token,
      );

      /*
       * "enviada", não "entregue". A Meta aceitou e devolveu um identificador;
       * se chegou ao aparelho, quem diz é o webhook. Chamar isto de entregue é
       * a mentira que faz a campanha do Regem marcar 100% de sucesso.
       */
      /*
       * O status e o contador na MESMA transação. Separados, uma queda entre os
       * dois deixaria mensagem enviada sem contar (a cobrança perde) ou contada
       * sem enviar (o cliente paga pelo que não saiu).
       *
       * Até esta mudança, `uso_ciclo.disparos` NUNCA era incrementado: a tela
       * de Conta mostrava consumo zero para sempre, e a cobrança por faixa de
       * disparos não tinha contador.
       *
       * O upsert com `disparos + 1` é atômico no Postgres: dez envios
       * simultâneos somam dez, e não um — que é o que um "ler, somar, gravar"
       * em código faria.
       */
      await this.ctx.comConta(contaId, async (db) => {
        await db
          .update(campanhaDestinatario)
          .set({ status: 'enviada', waMessageId: wamid, enviadaEm: new Date() })
          .where(eq(campanhaDestinatario.id, destinatario.id));

        if (cicloInicio) {
          await db.execute(sql`
            insert into uso_ciclo (conta_id, ciclo_inicio, disparos)
            values (${contaId}, ${cicloInicio}, 1)
            on conflict (conta_id, ciclo_inicio)
            do update set disparos = uso_ciclo.disparos + 1, atualizado_em = now()
          `);
        }
      });
    } catch (erro) {
      const g = erro instanceof ErroGraph ? erro : null;
      const detalhe = g ? g.detalheParaLog : String(erro);

      this.log.warn(`Falha ao enviar para ${this.mascarar(destinatario.telefone)}: ${detalhe}`);

      // Sem o telefone: a telemetria agrupa por conta e código, e não precisa
      // saber para quem era a mensagem.
      void this.telemetria.registrar({
        contaId,
        origem: 'meta',
        classe: g?.classe ?? null,
        codigo: g?.codigo ?? null,
        status: g?.status ?? null,
        mensagem: detalhe,
        detalhe: { campanhaId, traceId: g?.traceId ?? null },
      });

      await this.ctx.comConta(contaId, (db) =>
        db
          .update(campanhaDestinatario)
          .set({
            status: 'falhou',
            falhouEm: new Date(),
            erroCodigo: g?.codigo ?? null,
            erroTitulo: g?.traduzido.titulo ?? 'Falha no envio',
            // A explicação é o que a tela mostra; o detalhe técnico fica no log.
            erroDetalhe: g?.mensagemParaUsuario ?? 'Não conseguimos enviar esta mensagem.',
          })
          .where(eq(campanhaDestinatario.id, destinatario.id)),
      );
    }
  }

  /** Número registrado da conta. Sem ele não há de onde enviar. */
  private async numeroDeEnvio(contaId: string): Promise<string> {
    const [numero] = await this.ctx.db
      .select({ phoneNumberId: waNumero.phoneNumberId, status: waNumero.status })
      .from(waNumero)
      .where(and(eq(waNumero.contaId, contaId), eq(waNumero.status, 'registrado')))
      .limit(1);

    if (!numero) {
      throw new BadRequestException(
        'Nenhum número pronto para enviar. Conclua a conexão do WhatsApp antes de disparar.',
      );
    }
    return numero.phoneNumberId;
  }

  async listar(contaId: string): Promise<ResumoCampanha[]> {
    const linhas = await this.ctx.db
      .select()
      .from(campanha)
      .where(eq(campanha.contaId, contaId))
      .orderBy(desc(campanha.criadoEm))
      .limit(100);

    return Promise.all(linhas.map((c) => this.comContagem(c)));
  }

  async detalhe(contaId: string, campanhaId: string): Promise<ResumoCampanha> {
    return this.comContagem(await this.buscar(contaId, campanhaId));
  }

  /** Destinatários de uma campanha, com o que aconteceu com cada um. */
  async destinatarios(contaId: string, campanhaId: string) {
    await this.buscar(contaId, campanhaId);

    return this.ctx.db
      .select({
        id: campanhaDestinatario.id,
        telefone: campanhaDestinatario.telefoneE164,
        status: campanhaDestinatario.status,
        erroTitulo: campanhaDestinatario.erroTitulo,
        erroDetalhe: campanhaDestinatario.erroDetalhe,
        enviadaEm: campanhaDestinatario.enviadaEm,
        entregueEm: campanhaDestinatario.entregueEm,
        lidaEm: campanhaDestinatario.lidaEm,
        falhouEm: campanhaDestinatario.falhouEm,
      })
      .from(campanhaDestinatario)
      .where(eq(campanhaDestinatario.campanhaId, campanhaId))
      .orderBy(campanhaDestinatario.criadoEm);
  }

  private async buscar(contaId: string, campanhaId: string) {
    const [achada] = await this.ctx.db
      .select()
      .from(campanha)
      .where(and(eq(campanha.id, campanhaId), eq(campanha.contaId, contaId)))
      .limit(1);

    // 404 e não 403: dizer "existe, mas não é sua" confirma a existência do id
    // para quem está sondando. A RLS já filtraria, mas o `where` explícito
    // deixa a intenção visível para quem lê.
    if (!achada) throw new NotFoundException('Campanha não encontrada.');
    return achada;
  }

  /**
   * Junta a campanha à contagem por status.
   *
   * Contado na hora, do banco. Contador guardado precisa ser mantido no envio e
   * no webhook, e o dia em que um dos dois falha o número na tela mente sem
   * ninguém perceber.
   */
  private async comContagem(c: typeof campanha.$inferSelect): Promise<ResumoCampanha> {
    const linhas = await this.ctx.db
      .select({ status: campanhaDestinatario.status, quantos: count() })
      .from(campanhaDestinatario)
      .where(eq(campanhaDestinatario.campanhaId, c.id))
      .groupBy(campanhaDestinatario.status);

    const porStatus: Record<string, number> = {};
    let total = 0;
    for (const l of linhas) {
      porStatus[l.status] = Number(l.quantos);
      total += Number(l.quantos);
    }

    return {
      id: c.id,
      nome: c.nome,
      modeloNome: c.modeloNome,
      modeloIdioma: c.modeloIdioma,
      status: c.status,
      criadoEm: c.criadoEm,
      iniciadaEm: c.iniciadaEm,
      concluidaEm: c.concluidaEm,
      porStatus,
      total,
    };
  }

  /** Telefone nunca vai inteiro para o log. */
  private mascarar(valor: string): string {
    return valor.length <= 4 ? '••••' : `••••${valor.slice(-4)}`;
  }
}
