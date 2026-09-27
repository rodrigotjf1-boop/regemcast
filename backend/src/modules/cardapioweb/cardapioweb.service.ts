/**
 * Importação da base de clientes do Cardápio Web.
 *
 * Fluxo:
 * 1. O dono conecta a loja (a chave gerada no Portal do Cardápio Web; OAuth
 *    quando o app estiver na CW App Store). A credencial é conferida na hora
 *    (GET /merchant) e guardada cifrada.
 * 2. O dono declara o consentimento e inicia a importação. Ela roda em segundo
 *    plano, página a página (50 clientes), no ritmo que a API permite.
 * 3. Cada página vira um lote set-based: quem liberou WhatsApp entra na base e
 *    na lista "Clientes Cardápio Web"; quem desligou entra descadastrado.
 * 4. O andamento fica no banco. Se o servidor reiniciar, o job retoma da página
 *    seguinte à última gravada.
 * 5. Iniciar a importação engatilha a busca das compras (os pedidos de cada
 *    cliente, `cardapioweb.pedidos.service.ts`), que começa quando ela termina.
 * 6. Cada página grava também o saldo de cashback de quem já está na base; a
 *    leitura diária (`cardapioweb.saldos.service.ts`) o mantém em dia.
 *
 * Nunca sobrescreve: um contato que já existe mantém o consentimento que tinha
 * (pode ser mais antigo e mais forte) e um descadastro nunca é desfeito.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';

import { env } from '../../config/env';
import { ContextoDb, type Db } from '../../db/contexto';
import { contato, contatoLista, importacao, integracaoCardapioweb } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { gravarExtras } from '../contato/extras';
import { cashbackValido, cashbackVencendo, hojeDaConta } from '../contato/cashback';
import { cifrarToken, decifrarToken } from '../meta/cripto';
import { CardapiowebCliente, ErroCardapioWeb, type Credencial } from './cardapioweb.cliente';
import { prepararCargaDePedidos } from './cardapioweb.pedidos.service';
import { progressoDaCarga } from './cardapioweb.pedidos.regras';
import { saldosDaPagina, separarPagina } from './cardapioweb.regras';
import { bloquearClientes, gravarSaldos, proximaLeituraSql } from './cardapioweb.saldos';

const NOME_LISTA = 'Clientes Cardápio Web';
/** 300 req a cada 3 min por loja = 1 a cada 0,6 s. Folga para não bater no teto. */
const PAUSA_ENTRE_PAGINAS_MS = 800;
const MAX_TENTATIVAS = 5;
/** Sem batida de coração há este tempo, a importação é considerada órfã. */
export const MINUTOS_ORFA = 2;

export interface SituacaoCardapioWeb {
  conectado: boolean;
  modo: 'chave' | 'oauth' | null;
  lojaNome: string | null;
  sincronizacao: {
    status: 'parada' | 'rodando' | 'concluida' | 'falhou';
    pagina: number;
    totalPaginas: number | null;
    lidos: number;
    novos: number;
    bloqueados: number;
    invalidos: number;
    iniciadaEm: Date | null;
    concluidaEm: Date | null;
    erro: string | null;
    listaId: string | null;
  };
  /** As compras (pedidos) da loja: a carga do histórico e a consulta dos novos. */
  pedidos: {
    status: 'parado' | 'carga' | 'em_dia' | 'falhou';
    /** Carga: quanto do período já foi (0 a 100). */
    progresso: number;
    cargaDe: Date | null;
    cargaAte: Date | null;
    lidos: number;
    ignorados: number;
    ultimaConsulta: Date | null;
    erro: string | null;
    /** O que está guardado: compras, quantos clientes compraram, e de quando a quando. */
    compras: number;
    clientes: number;
    primeira: Date | null;
    ultima: Date | null;
  };
  /**
   * O cashback dos clientes: quantos têm saldo que vale hoje e a leitura diária
   * (4h). Conta só quem pode receber, como os públicos — o número daqui é o de lá.
   */
  saldos: {
    comCashback: number;
    /** Vence de hoje até daqui a 7 dias. */
    vencendo: number;
    /** Soma do cashback que vale hoje, em centavos. */
    totalCentavos: number;
    /** A leitura diária está no meio da lista agora. */
    lendo: boolean;
    ultimaLeitura: Date | null;
    proximaLeitura: Date | null;
    erro: string | null;
  };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class CardapiowebService {
  private readonly log = new Logger('CardapioWeb');
  /** Contas sendo importadas NESTE processo: evita dois laços na mesma conta. */
  private readonly emAndamento = new Set<string>();

  constructor(
    private readonly ctx: ContextoDb,
    private readonly cliente: CardapiowebCliente,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ------------------------------------------------------------ credencial

  private chave(): string {
    if (!env.integracoes.chave) {
      throw new ServiceUnavailableException(
        'A conexão com o Cardápio Web ainda não está disponível: falta configurar INTEGRACOES_CHAVE no servidor.',
      );
    }
    return env.integracoes.chave;
  }

  private credencialDe(linha: { modo: string; credencialCifrada: string | null }): Credencial {
    if (!linha.credencialCifrada) throw new BadRequestException('Conecte a loja do Cardápio Web primeiro.');
    return {
      modo: linha.modo === 'oauth' ? 'oauth' : 'chave',
      valor: decifrarToken(linha.credencialCifrada, this.chave()),
    };
  }

  // ------------------------------------------------------------ leitura

  async situacao(contaId: string): Promise<SituacaoCardapioWeb> {
    return this.ctx.comConta(contaId, async (db) => {
      const [l] = await db
        .select()
        .from(integracaoCardapioweb)
        .where(eq(integracaoCardapioweb.contaId, contaId))
        .limit(1);
      const [guardado] = (
        await db.execute(sql`
          select count(*)::int as compras, count(distinct contato_id)::int as clientes,
                 min(feita_em) as primeira, max(feita_em) as ultima
            from compra where conta_id = ${contaId} and fonte = 'cardapioweb'
        `)
      ).rows as { compras: number; clientes: number; primeira: string | null; ultima: string | null }[];
      const hoje = hojeDaConta(contaId);
      const [cashback] = (
        await db.execute(sql`
          select count(*) filter (where ${cashbackValido('contato', hoje)})::int as com_cashback,
                 count(*) filter (where ${cashbackVencendo('contato', hoje)})::int as vencendo,
                 coalesce(sum(cashback_centavos) filter (where ${cashbackValido('contato', hoje)}), 0)::bigint as total
            from contato
           where conta_id = ${contaId} and cashback_centavos > 0
             and opt_out = false and sem_whatsapp_em is null
        `)
      ).rows as { com_cashback: number; vencendo: number; total: string | number }[];
      const status = (l?.pedidosStatus ?? 'parado') as SituacaoCardapioWeb['pedidos']['status'];
      return {
        conectado: Boolean(l?.credencialCifrada),
        modo: l?.credencialCifrada ? (l.modo as 'chave' | 'oauth') : null,
        lojaNome: l?.lojaNome ?? null,
        sincronizacao: {
          status: (l?.sincStatus ?? 'parada') as SituacaoCardapioWeb['sincronizacao']['status'],
          pagina: l?.sincPagina ?? 0,
          totalPaginas: l?.sincTotalPaginas ?? null,
          lidos: l?.sincLidos ?? 0,
          novos: l?.sincNovos ?? 0,
          bloqueados: l?.sincBloqueados ?? 0,
          invalidos: l?.sincInvalidos ?? 0,
          iniciadaEm: l?.sincIniciadaEm ?? null,
          concluidaEm: l?.sincConcluidaEm ?? null,
          erro: l?.sincErro ?? null,
          listaId: l?.listaId ?? null,
        },
        pedidos: {
          status,
          progresso:
            status === 'em_dia'
              ? 100
              : l?.pedidosCargaDe && l.pedidosCargaAte
                ? progressoDaCarga(l.pedidosCargaDe, l.pedidosCargaAte, l.pedidosJanelaDe ?? l.pedidosCargaDe, l.pedidosPagina, null)
                : 0,
          cargaDe: l?.pedidosCargaDe ?? null,
          cargaAte: l?.pedidosCargaAte ?? null,
          lidos: l?.pedidosLidos ?? 0,
          ignorados: l?.pedidosIgnorados ?? 0,
          ultimaConsulta: l?.pedidosUltimaConsulta ?? null,
          erro: l?.pedidosErro ?? null,
          compras: guardado?.compras ?? 0,
          clientes: guardado?.clientes ?? 0,
          primeira: guardado?.primeira ? new Date(guardado.primeira) : null,
          ultima: guardado?.ultima ? new Date(guardado.ultima) : null,
        },
        saldos: {
          comCashback: Number(cashback?.com_cashback ?? 0),
          vencendo: Number(cashback?.vencendo ?? 0),
          totalCentavos: Number(cashback?.total ?? 0),
          lendo: (l?.saldosPagina ?? 0) > 0,
          ultimaLeitura: l?.saldosConcluidaEm ?? null,
          proximaLeitura: l?.saldosProximaEm ?? null,
          erro: l?.saldosErro ?? null,
        },
      };
    });
  }

  // ------------------------------------------------------------ conexão

  /** Confere a chave no Cardápio Web e guarda cifrada. */
  async conectarChave(contaId: string, usuarioId: string, chaveLoja: string): Promise<{ lojaNome: string }> {
    const valor = chaveLoja.trim();
    const segredo = this.chave();

    let loja;
    try {
      loja = await this.cliente.loja({ modo: 'chave', valor });
    } catch (erro) {
      if (erro instanceof ErroCardapioWeb) throw new BadRequestException(erro.message);
      throw erro;
    }

    await this.ctx.comConta(contaId, async (db) => {
      const [atual] = await db
        .select({ status: integracaoCardapioweb.sincStatus, lojaId: integracaoCardapioweb.lojaId })
        .from(integracaoCardapioweb)
        .where(eq(integracaoCardapioweb.contaId, contaId))
        .limit(1);
      if (atual?.status === 'rodando') {
        throw new BadRequestException('Há uma importação em andamento. Espere terminar para trocar a conexão.');
      }
      // Chave de OUTRA loja: o cashback que veio da antiga não vale nesta.
      if (atual?.lojaId && atual.lojaId !== loja.id) await apagarSaldos(db, contaId);

      await db
        .insert(integracaoCardapioweb)
        .values({
          contaId,
          modo: 'chave',
          credencialCifrada: cifrarToken(valor, segredo),
          lojaId: loja.id,
          lojaNome: loja.nome,
        })
        .onConflictDoUpdate({
          target: integracaoCardapioweb.contaId,
          set: {
            modo: 'chave',
            credencialCifrada: cifrarToken(valor, segredo),
            refreshCifrado: null,
            tokenExpiraEm: null,
            lojaId: loja.id,
            lojaNome: loja.nome,
            sincErro: null,
            // Parou por credencial recusada: a chave nova retoma de onde parou.
            // Chave de OUTRA loja: a busca de pedidos recomeça pelo dono ("Buscar pedidos").
            pedidosStatus: sql`case when ${integracaoCardapioweb.lojaId} is distinct from ${loja.id} then 'parado'
              when ${integracaoCardapioweb.pedidosStatus} <> 'falhou' then ${integracaoCardapioweb.pedidosStatus}
              when ${integracaoCardapioweb.pedidosJanelaDe} < ${integracaoCardapioweb.pedidosCargaAte} then 'carga'
              when ${integracaoCardapioweb.pedidosUltimaConsulta} is not null then 'em_dia'
              else 'parado' end`,
            pedidosErro: null,
            pedidosProximoEm: null,
            // Token novo: a leitura do cashback recomeça assim que der.
            saldosPagina: 0,
            saldosErro: null,
            saldosProximaEm: null,
          },
        });

      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioId,
        acao: 'cardapioweb.conectado',
        entidade: 'integracao_cardapioweb',
        detalhe: { modo: 'chave', loja: loja.nome, lojaId: loja.id },
      });
    });

    return { lojaNome: loja.nome };
  }

  /**
   * Apaga a credencial. Os contatos já importados continuam na base — menos o
   * saldo de cashback: sem a conexão ele não se atualiza, e a campanha falaria
   * de um saldo que pode nem existir mais.
   */
  async desconectar(contaId: string, usuarioId: string): Promise<void> {
    await this.ctx.comConta(contaId, async (db) => {
      await db.delete(integracaoCardapioweb).where(eq(integracaoCardapioweb.contaId, contaId));
      await apagarSaldos(db, contaId);
      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioId,
        acao: 'cardapioweb.desconectado',
        entidade: 'integracao_cardapioweb',
      });
    });
  }

  // ------------------------------------------------------------ importação

  /**
   * Começa (ou recomeça do zero) a importação. O consentimento é obrigatório,
   * como na importação de arquivo: é a condição da Meta para mensagem iniciada
   * pela empresa.
   */
  async iniciar(
    contaId: string,
    usuarioId: string,
    dados: { consentimento: boolean; evidencia?: string },
  ): Promise<SituacaoCardapioWeb> {
    if (!dados.consentimento) {
      throw new BadRequestException(
        'Confirme que os clientes da sua loja autorizaram receber mensagens da empresa. Sem esse aceite não importamos.',
      );
    }

    await this.ctx.comConta(contaId, async (db) => {
      const [l] = await db
        .select()
        .from(integracaoCardapioweb)
        .where(eq(integracaoCardapioweb.contaId, contaId))
        .limit(1);
      if (!l?.credencialCifrada) throw new BadRequestException('Conecte a loja do Cardápio Web primeiro.');
      if (l.sincStatus === 'rodando') throw new BadRequestException('A importação já está em andamento.');

      // A lista de destino: a mesma de antes, se ainda existir; senão, nova.
      let listaId = l.listaId;
      if (listaId) {
        const [existe] = await db
          .select({ id: contatoLista.id })
          .from(contatoLista)
          .where(and(eq(contatoLista.contaId, contaId), eq(contatoLista.id, listaId)))
          .limit(1);
        if (!existe) listaId = null;
      }
      if (!listaId) {
        const [nova] = await db
          .insert(contatoLista)
          .values({
            contaId,
            nome: NOME_LISTA,
            descricao: `Clientes da loja ${l.lojaNome ?? ''} no Cardápio Web que liberaram WhatsApp.`.trim(),
          })
          .returning({ id: contatoLista.id });
        listaId = nova!.id;
      }

      const [registro] = await db
        .insert(importacao)
        .values({
          contaId,
          formato: 'cardapioweb',
          arquivoNome: `Cardápio Web — ${l.lojaNome ?? 'loja'}`,
          listaId,
          criadoPor: usuarioId,
        })
        .returning({ id: importacao.id });

      await db
        .update(integracaoCardapioweb)
        .set({
          sincStatus: 'rodando',
          sincPagina: 0,
          sincTotalPaginas: null,
          sincLidos: 0,
          sincNovos: 0,
          sincBloqueados: 0,
          sincInvalidos: 0,
          sincIniciadaEm: new Date(),
          sincConcluidaEm: null,
          sincErro: null,
          listaId,
          importacaoId: registro!.id,
          consentimentoPor: usuarioId,
          consentimentoEm: new Date(),
        })
        .where(and(eq(integracaoCardapioweb.contaId, contaId), ne(integracaoCardapioweb.sincStatus, 'rodando')));

      // Clientes e compras vêm juntos (opção B): a carga dos pedidos começa
      // quando a importação de clientes terminar — o job espera.
      if (l.pedidosStatus === 'parado' || l.pedidosStatus === 'falhou') await prepararCargaDePedidos(db, contaId);

      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioId,
        acao: 'cardapioweb.importacao_iniciada',
        entidade: 'importacao',
        entidadeId: registro!.id,
        detalhe: { loja: l.lojaNome, evidencia: dados.evidencia?.trim() || null },
      });
    });

    void this.rodar(contaId);
    return this.situacao(contaId);
  }

  /** Importações órfãs (servidor reiniciou no meio): o job chama a cada minuto. */
  async retomarOrfas(): Promise<number> {
    const contas = await this.ctx.comEscopoSistema('cardapioweb.retomar', async (db) => {
      const r = await db.execute(sql`
        select conta_id from integracao_cardapioweb
         where sinc_status = 'rodando'
           and atualizado_em < now() - make_interval(mins => ${MINUTOS_ORFA})
      `);
      return (r.rows as { conta_id: string }[]).map((x) => x.conta_id);
    });
    for (const c of contas) void this.rodar(c);
    return contas.length;
  }

  /** O laço da importação. Não lança: falha vira status `falhou` com o motivo. */
  async rodar(contaId: string): Promise<void> {
    if (this.emAndamento.has(contaId)) return;
    this.emAndamento.add(contaId);
    try {
      for (;;) {
        const l = await this.ctx.comConta(contaId, async (db) => {
          const [x] = await db
            .select()
            .from(integracaoCardapioweb)
            .where(eq(integracaoCardapioweb.contaId, contaId))
            .limit(1);
          return x ?? null;
        });
        if (!l || l.sincStatus !== 'rodando' || !l.credencialCifrada) return;

        const pagina = l.sincPagina + 1;
        const dados = await this.buscarComPaciencia(this.credencialDe(l), pagina);
        const terminou = dados.customers.length === 0 || pagina >= (dados.pagination.total_pages || 0);

        await this.gravarPagina(contaId, l, pagina, dados, terminou);
        if (terminou) {
          this.log.log(`Cardápio Web: importação da conta ${contaId} concluída em ${pagina} página(s).`);
          return;
        }
        await esperar(PAUSA_ENTRE_PAGINAS_MS);
      }
    } catch (erro) {
      const motivo =
        erro instanceof ErroCardapioWeb || erro instanceof BadRequestException
          ? erro.message
          : 'A importação parou por um erro nosso. Tente de novo; se repetir, fale com o suporte.';
      this.log.error(`Cardápio Web: importação da conta ${contaId} falhou: ${String(erro)}`);
      await this.ctx
        .comConta(contaId, (db) =>
          db
            .update(integracaoCardapioweb)
            .set({ sincStatus: 'falhou', sincErro: motivo })
            .where(eq(integracaoCardapioweb.contaId, contaId)),
        )
        .catch(() => undefined);
    } finally {
      this.emAndamento.delete(contaId);
    }
  }

  /** Busca uma página esperando e tentando de novo nos erros passageiros. */
  private async buscarComPaciencia(credencial: Credencial, pagina: number) {
    for (let tentativa = 1; ; tentativa++) {
      try {
        return await this.cliente.clientes(credencial, pagina);
      } catch (erro) {
        if (!(erro instanceof ErroCardapioWeb) || !erro.passageiro || tentativa >= MAX_TENTATIVAS) throw erro;
        await esperar(erro.status === 429 ? 60_000 : 15_000 * tentativa);
      }
    }
  }

  /** Uma página = uma transação curta, gravada em lote. */
  private async gravarPagina(
    contaId: string,
    l: typeof integracaoCardapioweb.$inferSelect,
    pagina: number,
    dados: Awaited<ReturnType<CardapiowebCliente['clientes']>>,
    terminou: boolean,
  ): Promise<void> {
    const { contatos, bloqueados, invalidos } = separarPagina(dados.customers);
    const agora = new Date();
    const hoje = agora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const loja = l.lojaNome ?? 'loja';

    await this.ctx.comConta(contaId, async (db) => {
      let novos = 0;
      if (contatos.length) {
        const inseridos = await db
          .insert(contato)
          .values(
            contatos.map((c) => ({
              contaId,
              telefoneE164: c.telefone,
              nome: c.nome,
              consentimentoOrigem: 'api' as const,
              consentimentoEm: agora,
              consentimentoEvidencia:
                `Cliente da loja "${loja}" no Cardápio Web` +
                (c.desde ? ` desde ${new Date(c.desde).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : '') +
                `, com WhatsApp liberado lá. Importado em ${hoje} com a declaração de consentimento do dono da conta.`,
              importacaoId: l.importacaoId,
            })),
          )
          .onConflictDoNothing({ target: [contato.contaId, contato.telefoneE164] })
          .returning({ id: contato.id });
        novos = inseridos.length;

        // E-mail e aniversário: só preenchem o que está vazio na base.
        await gravarExtras(
          db,
          contaId,
          contatos.map((c) => ({ telefone: c.telefone, email: c.email, dataNascimento: c.dataNascimento })),
          'cardapioweb',
        );

        // Na lista entram todos os liberados — inclusive os que já estavam na
        // base —, menos quem está descadastrado aqui.
        if (l.listaId) {
          await db.execute(sql`
            insert into contato_lista_item (conta_id, lista_id, contato_id)
            select conta_id, ${l.listaId}, id
              from contato
             where conta_id = ${contaId}
               and opt_out = false
               and telefone_e164 in (${sql.join(contatos.map((c) => sql`${c.telefone}`), sql`, `)})
            on conflict do nothing
          `);
        }
      }

      // Pediu para sair no Cardápio Web: entra (ou passa a estar) descadastrado.
      // Um descadastro que já existia não é tocado.
      await bloquearClientes(db, contaId, bloqueados, l.importacaoId, agora);

      // O cashback de quem está na base (inclusive quem acabou de entrar).
      await gravarSaldos(db, contaId, saldosDaPagina(dados.customers), agora);

      await db
        .update(integracaoCardapioweb)
        .set({
          sincPagina: pagina,
          sincTotalPaginas: dados.pagination.total_pages ?? null,
          sincLidos: sql`${integracaoCardapioweb.sincLidos} + ${dados.customers.length}`,
          sincNovos: sql`${integracaoCardapioweb.sincNovos} + ${novos}`,
          sincBloqueados: sql`${integracaoCardapioweb.sincBloqueados} + ${bloqueados.length}`,
          sincInvalidos: sql`${integracaoCardapioweb.sincInvalidos} + ${invalidos}`,
          // A importação leu o cashback de todos: a próxima leitura é a das 4h.
          ...(terminou
            ? {
                sincStatus: 'concluida',
                sincConcluidaEm: agora,
                saldosPagina: 0,
                saldosConcluidaEm: agora,
                saldosErro: null,
                saldosProximaEm: proximaLeituraSql(contaId),
              }
            : {}),
        })
        .where(and(eq(integracaoCardapioweb.contaId, contaId), eq(integracaoCardapioweb.sincStatus, 'rodando')));

      if (terminou && l.importacaoId) {
        // O registro da importação fica com os totais finais, como o de arquivo.
        await db.execute(sql`
          update importacao i
             set total_lidos = s.sinc_lidos,
                 validos     = s.sinc_lidos - s.sinc_invalidos,
                 invalidos   = s.sinc_invalidos,
                 novos       = s.sinc_novos,
                 ja_existiam = greatest(s.sinc_lidos - s.sinc_invalidos - s.sinc_novos - s.sinc_bloqueados, 0)
            from integracao_cardapioweb s
           where s.conta_id = ${contaId} and i.id = ${l.importacaoId}
        `);
      }
    });

    if (terminou) {
      await this.auditoria.registrarForaDeContexto({
        contaId,
        atorTipo: 'sistema',
        acao: 'cardapioweb.importacao_concluida',
        entidade: 'importacao',
        entidadeId: l.importacaoId ?? undefined,
        detalhe: { loja, paginas: pagina },
      });
    }
  }
}

/** Tira o cashback de todos os contatos da conta (desconectou, ou trocou de loja). */
async function apagarSaldos(db: Db, contaId: string): Promise<void> {
  await db.execute(sql`
    update contato set cashback_centavos = null, cashback_vence_em = null, cashback_em = null
     where conta_id = ${contaId} and cashback_em is not null
  `);
}
