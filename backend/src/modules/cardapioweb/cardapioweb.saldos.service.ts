/**
 * A leitura diária do cashback (Fase 4C, migration 034).
 *
 * Todo dia às 4h, no fuso da conta, a lista inteira de clientes da loja é
 * relida, 50 por consulta, e cada contato fica com o saldo de cashback e o
 * vencimento do dia. De quebra, quem desligou o WhatsApp no Cardápio Web
 * depois da importação sai dos envios — só bloqueia, nunca desbloqueia, a
 * mesma regra da importação.
 *
 * Só para loja que já importou os clientes: é essa base que a leitura mantém
 * em dia. Não traz cliente novo (isso é da importação e da busca de pedidos).
 *
 * Ritmo: até 5 páginas por passo, com 1,2 s entre uma e outra — umas 50
 * consultas por minuto, metade do que a API permite por loja (300 a cada 3
 * min), com folga para a busca de pedidos. O ponto em que parou fica no banco:
 * reinício ou deploy continua da página seguinte.
 *
 * Saldo que some: cliente que não aparece em DUAS leituras seguidas perde o
 * saldo. A ordem da lista não é documentada e uma página pode "andar" durante
 * a leitura — uma ausência só não prova que o cliente saiu.
 *
 * A importação lê o saldo junto (é a mesma lista), e a busca de pedidos relê o
 * saldo de quem comprou (a compra pode ter usado ou gerado cashback).
 */
import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import { env } from '../../config/env';
import { ContextoDb } from '../../db/contexto';
import { integracaoCardapioweb } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { cashbackValido, hojeDaConta } from '../contato/cashback';
import { decifrarToken } from '../meta/cripto';
import { CardapiowebCliente, ErroCardapioWeb, type Credencial } from './cardapioweb.cliente';
import { saldosDaPagina, separarPagina, type ClienteCardapioWeb } from './cardapioweb.regras';
import { bloquearClientes, gravarSaldos, proximaLeituraSql } from './cardapioweb.saldos';

const PAGINAS_POR_PASSO = 5;
const PAUSA_ENTRE_PAGINAS_MS = 1_200;
/** Sem aparecer em duas leituras seguidas (uma a cada ~24 h), o saldo sai. */
const HORAS_SEM_APARECER = 36;

type Linha = typeof integracaoCardapioweb.$inferSelect;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class SaldosCardapiowebService {
  private readonly log = new Logger('CardapioWebCashback');

  constructor(
    private readonly ctx: ContextoDb,
    private readonly cliente: CardapiowebCliente,
    private readonly auditoria: AuditoriaService,
  ) {}

  private credencial(l: Linha): Credencial {
    if (!env.integracoes.chave) {
      throw new ServiceUnavailableException('Falta configurar INTEGRACOES_CHAVE no servidor.');
    }
    if (!l.credencialCifrada) throw new BadRequestException('Conecte a loja do Cardápio Web primeiro.');
    return {
      modo: l.modo === 'oauth' ? 'oauth' : 'chave',
      valor: decifrarToken(l.credencialCifrada, env.integracoes.chave),
    };
  }

  private async linha(contaId: string): Promise<Linha | null> {
    return this.ctx.comConta(contaId, async (db) => {
      const [l] = await db.select().from(integracaoCardapioweb).where(eq(integracaoCardapioweb.contaId, contaId)).limit(1);
      return l ?? null;
    });
  }

  /** Um passo de uma loja (chamado pelo job). Não lança: o erro vira `saldos_erro`. Solta a trava no fim. */
  async passo(contaId: string): Promise<void> {
    try {
      const l = await this.linha(contaId);
      if (!l?.credencialCifrada) return;
      const cred = this.credencial(l);
      let pagina = l.saldosPagina;
      // Leitura nova: o início é dela — é dele que conta o "sumiu em duas leituras".
      const inicio = pagina === 0 || !l.saldosIniciadaEm ? new Date() : l.saldosIniciadaEm;

      for (let i = 0; i < PAGINAS_POR_PASSO; i++) {
        if (i > 0) await esperar(PAUSA_ENTRE_PAGINAS_MS);
        const proxima = pagina + 1;
        const dados = await this.cliente.clientes(cred, proxima);
        const terminou = dados.customers.length === 0 || proxima >= (dados.pagination.total_pages || 0);
        await this.gravarPagina(contaId, l, proxima, inicio, dados.customers);
        pagina = proxima;
        if (terminou) {
          await this.concluir(contaId, l, inicio, pagina);
          return;
        }
      }
    } catch (erro) {
      await this.registrarErro(contaId, erro);
    } finally {
      await this.ctx
        .comConta(contaId, (db) =>
          db.update(integracaoCardapioweb).set({ saldosTravaAte: null }).where(eq(integracaoCardapioweb.contaId, contaId)),
        )
        .catch((e: unknown) => this.log.error(`Não consegui soltar a trava do cashback da conta ${contaId}: ${String(e)}`));
    }
  }

  /** Uma página = uma transação curta: saldos, bloqueios e o ponto em que parou. */
  private async gravarPagina(
    contaId: string,
    l: Linha,
    pagina: number,
    inicio: Date,
    clientes: ClienteCardapioWeb[],
  ): Promise<void> {
    const agora = new Date();
    await this.ctx.comConta(contaId, async (db) => {
      await gravarSaldos(db, contaId, saldosDaPagina(clientes), agora);
      await bloquearClientes(db, contaId, separarPagina(clientes).bloqueados, l.importacaoId, agora);
      await db
        .update(integracaoCardapioweb)
        .set({ saldosPagina: pagina, saldosIniciadaEm: inicio, saldosErro: null, saldosAtualizadoEm: agora })
        .where(eq(integracaoCardapioweb.contaId, contaId));
    });
  }

  /** Fim da lista: sai o saldo de quem sumiu, e a próxima leitura fica para as 4h. */
  private async concluir(contaId: string, l: Linha, inicio: Date, paginas: number): Promise<void> {
    const r = await this.ctx.comConta(contaId, async (db) => {
      const apagados = await db.execute(sql`
        update contato
           set cashback_centavos = null, cashback_vence_em = null, cashback_em = null
         where conta_id = ${contaId}
           and cashback_centavos > 0
           and cashback_em < ${inicio}::timestamptz - make_interval(hours => ${sql.raw(String(HORAS_SEM_APARECER))})
      `);
      const [contagem] = (
        await db.execute(sql`
          select count(*) filter (where ${cashbackValido('contato', hojeDaConta(contaId))})::int as com_cashback
            from contato
           where conta_id = ${contaId} and cashback_centavos > 0
        `)
      ).rows as { com_cashback: number }[];
      await db
        .update(integracaoCardapioweb)
        .set({
          saldosPagina: 0,
          saldosConcluidaEm: new Date(),
          saldosErro: null,
          saldosProximaEm: proximaLeituraSql(contaId),
          saldosAtualizadoEm: new Date(),
        })
        .where(eq(integracaoCardapioweb.contaId, contaId));
      return { apagados: apagados.rowCount ?? 0, comCashback: Number(contagem?.com_cashback ?? 0) };
    });

    this.log.log(
      `Cardápio Web: cashback da conta ${contaId} lido (${paginas} página(s), ${r.comCashback} com saldo, ${r.apagados} saldo(s) de quem sumiu apagado(s)).`,
    );
    await this.auditoria.registrarForaDeContexto({
      contaId,
      atorTipo: 'sistema',
      acao: 'cardapioweb.cashback_lido',
      entidade: 'integracao_cardapioweb',
      detalhe: { loja: l.lojaNome, paginas, comCashback: r.comCashback, apagados: r.apagados },
    });
  }

  /**
   * Erro passageiro do Cardápio Web (limite, fora do ar): tenta de novo do
   * mesmo ponto em 1 ou 2 min. Recusa (token, permissão): recomeça na leitura
   * das 4h — ou antes, quando o token for trocado. Erro nosso: 5 min.
   */
  private async registrarErro(contaId: string, erro: unknown): Promise<void> {
    const doCardapioWeb = erro instanceof ErroCardapioWeb;
    const motivo = doCardapioWeb
      ? erro.message
      : 'A leitura do cashback parou por um erro nosso. Tentamos de novo em alguns minutos.';
    if (doCardapioWeb) this.log.warn(`Cardápio Web: cashback da conta ${contaId}: ${motivo}`);
    else this.log.error(`Cardápio Web: cashback da conta ${contaId} falhou: ${String(erro)}`, (erro as Error)?.stack);

    const quando = !doCardapioWeb
      ? { saldosProximaEm: new Date(Date.now() + 300_000) }
      : erro.passageiro
        ? { saldosProximaEm: new Date(Date.now() + (erro.status === 429 ? 60_000 : 120_000)) }
        : { saldosPagina: 0, saldosProximaEm: proximaLeituraSql(contaId) };
    await this.ctx
      .comConta(contaId, (db) =>
        db
          .update(integracaoCardapioweb)
          .set({ ...quando, saldosErro: motivo, saldosAtualizadoEm: new Date() })
          .where(eq(integracaoCardapioweb.contaId, contaId)),
      )
      .catch((e: unknown) => this.log.error(`Não consegui registrar o erro do cashback da conta ${contaId}: ${String(e)}`));
  }
}
