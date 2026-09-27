/**
 * O revezamento das lojas na leitura diária do cashback.
 *
 * A cada 10 s pega até 8 lojas com a leitura vencida (4h no fuso da conta, ou
 * a nova tentativa depois de um erro) e roda um passo de cada, ao mesmo tempo
 * — cada passo é até 5 páginas, e a loja volta para o fim da fila.
 *
 * Espera a importação de clientes e a carga do histórico de pedidos da loja:
 * as três leem o mesmo Cardápio Web, com o mesmo limite de consultas por loja.
 * Loja que nunca terminou uma importação não entra — é a base importada que a
 * leitura mantém em dia.
 *
 * A reserva é pela trava no banco (`saldos_trava_ate`, 3 min), numa CTE
 * MATERIALIZADA — a mesma forma da fila de pedidos e do disparo (a outra
 * reserva mais que o limite com a RLS ligada). Escopo de sistema só para
 * reservar (a conta ainda não é conhecida, motivo A de `docs/rls.md`); o passo
 * roda dentro da conta.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';

import { ContextoDb } from '../../db/contexto';
import { SaldosCardapiowebService } from './cardapioweb.saldos.service';

const INTERVALO_MS = 10_000;
const LOJAS_POR_VOLTA = 8;

@Injectable()
export class CardapiowebSaldosJob {
  private readonly log = new Logger('CardapioWebCashback');
  private rodando = false;

  constructor(
    private readonly ctx: ContextoDb,
    private readonly saldos: SaldosCardapiowebService,
  ) {}

  @Interval(INTERVALO_MS)
  async volta(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      const contas = await this.reservar();
      await Promise.allSettled(contas.map((c) => this.saldos.passo(c)));
    } catch (erro) {
      // Nunca deixa subir: exceção aqui derruba o agendador.
      this.log.error(`Volta da leitura do cashback falhou: ${(erro as Error)?.message ?? String(erro)}`, (erro as Error)?.stack);
    } finally {
      this.rodando = false;
    }
  }

  /** Reserva as lojas desta volta. Devolve os `conta_id`. */
  async reservar(): Promise<string[]> {
    return this.ctx.comEscopoSistema('cardapioweb.saldos.fila', async (db) => {
      const r = await db.execute(sql`
        with alvo as materialized (
          select id from integracao_cardapioweb
           where credencial_cifrada is not null
             and sinc_concluida_em is not null
             and sinc_status <> 'rodando'
             and pedidos_status <> 'carga'
             and (saldos_proxima_em is null or saldos_proxima_em <= now())
             and (saldos_trava_ate is null or saldos_trava_ate < now())
           order by saldos_atualizado_em nulls first
           for update skip locked
           limit ${LOJAS_POR_VOLTA}
        )
        update integracao_cardapioweb i
           set saldos_trava_ate = now() + interval '3 minutes'
          from alvo
         where i.id = alvo.id
        returning i.conta_id
      `);
      return (r.rows as { conta_id: string }[]).map((x) => x.conta_id);
    });
  }
}
