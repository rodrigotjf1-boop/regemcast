/**
 * Prazo de guarda das mensagens.
 *
 * Conta com `conversas_retencao_dias` > 0 tem apagado, de hora em hora, o que
 * passou do prazo — pela data ORIGINAL da mensagem. Conversa que fica sem
 * mensagem nenhuma sai junto.
 *
 * A lista de contas é lida em escopo de sistema (o job acorda sem conta); o
 * apagamento roda em `comConta`, com a RLS de cada uma. Apaga em blocos: uma
 * conta com anos de conversa não trava a tabela num `delete` só.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { gt, sql } from 'drizzle-orm';

import { ContextoDb } from '../../db/contexto';
import { conta } from '../../db/schema';

const INTERVALO_MS = 60 * 60_000;
const BLOCO = 5000;
/** Teto de blocos por conta por rodada: o resto fica para a próxima hora. */
const BLOCOS_POR_RODADA = 20;

@Injectable()
export class ConversaRetencao {
  private readonly log = new Logger('Conversas');
  private rodando = false;

  constructor(private readonly ctx: ContextoDb) {}

  @Interval(INTERVALO_MS)
  async apagarVencidas(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      const contas = await this.ctx.comEscopoSistema('conversas.retencao.contas', (db) =>
        db
          .select({ id: conta.id, dias: conta.conversasRetencaoDias })
          .from(conta)
          .where(gt(conta.conversasRetencaoDias, 0)),
      );

      for (const c of contas) {
        const apagadas = await this.apagarDaConta(c.id, c.dias);
        if (apagadas > 0) this.log.log(`Prazo de guarda: ${apagadas} mensagem(ns) apagada(s) da conta ${c.id}.`);
      }
    } catch (erro) {
      // Nunca deixa subir: exceção aqui derruba o agendador.
      this.log.error(`Prazo de guarda das conversas falhou: ${(erro as Error)?.message ?? String(erro)}`);
    } finally {
      this.rodando = false;
    }
  }

  /** Apaga o que passou do prazo numa conta. Devolve quantas mensagens saíram. */
  async apagarDaConta(contaId: string, dias: number): Promise<number> {
    let total = 0;
    for (let i = 0; i < BLOCOS_POR_RODADA; i++) {
      const apagadas = await this.ctx.comConta(contaId, async (db) => {
        const r = await db.execute(sql`
          delete from mensagem
           where id in (
             select id from mensagem
              where conta_id = ${contaId}
                and criada_em < now() - make_interval(days => ${dias})
              limit ${BLOCO}
           )
        `);
        return r.rowCount ?? 0;
      });
      total += apagadas;
      if (apagadas < BLOCO) break;
    }

    await this.ctx.comConta(contaId, (db) =>
      db.execute(sql`
        delete from conversa c
         where c.conta_id = ${contaId}
           and not exists (select 1 from mensagem m where m.conversa_id = c.id)
           and (c.ultima_mensagem_em is null or c.ultima_mensagem_em < now() - make_interval(days => ${dias}))
      `),
    );
    return total;
  }
}
