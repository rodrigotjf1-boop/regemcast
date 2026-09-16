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
import { and, count, desc, eq } from 'drizzle-orm';

import { paraCloudApi } from '../../common/telefone';
import { ContextoDb } from '../../db/contexto';
import { campanha, campanhaDestinatario, waNumero } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ErroGraph, GraphService } from '../meta/graph.service';
import { MetaService } from '../meta/meta.service';
import type { CriarCampanhaDto } from './dto/criar-campanha.dto';

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
   * Dispara a campanha.
   *
   * Cada destinatário é tratado isoladamente: uma falha não interrompe os
   * outros, e o motivo real fica gravado na linha dele. Interromper tudo no
   * primeiro erro é o que faz uma campanha parar por causa de um número
   * inválido no meio da lista.
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

    const numero = await this.numeroDeEnvio(contaId);

    await this.ctx.db
      .update(campanha)
      .set({ status: 'enviando', iniciadaEm: new Date() })
      .where(eq(campanha.id, campanhaId));

    const pendentes = await this.ctx.db
      .select({
        id: campanhaDestinatario.id,
        telefone: campanhaDestinatario.telefoneE164,
        variaveis: campanhaDestinatario.variaveis,
      })
      .from(campanhaDestinatario)
      .where(
        and(
          eq(campanhaDestinatario.campanhaId, campanhaId),
          eq(campanhaDestinatario.status, 'pendente'),
        ),
      );

    for (const d of pendentes) {
      await this.enviarUm(d, alvo, numero, credencial.token);
    }

    await this.ctx.db
      .update(campanha)
      .set({ status: 'concluida', concluidaEm: new Date() })
      .where(eq(campanha.id, campanhaId));

    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuarioId,
      acao: 'campanha.disparada',
      entidade: 'campanha',
      entidadeId: campanhaId,
      detalhe: { destinatarios: pendentes.length, modelo: alvo.modeloNome },
    });

    return this.detalhe(contaId, campanhaId);
  }

  /** Envia para um destinatário e grava o resultado, seja qual for. */
  private async enviarUm(
    destinatario: { id: string; telefone: string; variaveis: unknown },
    alvo: { modeloNome: string; modeloIdioma: string },
    phoneNumberId: string,
    token: string,
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
      await this.ctx.db
        .update(campanhaDestinatario)
        .set({ status: 'enviada', waMessageId: wamid, enviadaEm: new Date() })
        .where(eq(campanhaDestinatario.id, destinatario.id));
    } catch (erro) {
      const g = erro instanceof ErroGraph ? erro : null;
      const detalhe = g ? g.detalheParaLog : String(erro);

      this.log.warn(
        `Falha ao enviar para ${this.mascarar(destinatario.telefone)}: ${detalhe}`,
      );

      await this.ctx.db
        .update(campanhaDestinatario)
        .set({
          status: 'falhou',
          falhouEm: new Date(),
          erroCodigo: g?.codigo ?? null,
          erroTitulo: g?.traduzido.titulo ?? 'Falha no envio',
          // A explicação é o que a tela mostra; o detalhe técnico fica no log.
          erroDetalhe: g?.mensagemParaUsuario ?? 'Não conseguimos enviar esta mensagem.',
        })
        .where(eq(campanhaDestinatario.id, destinatario.id));
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
