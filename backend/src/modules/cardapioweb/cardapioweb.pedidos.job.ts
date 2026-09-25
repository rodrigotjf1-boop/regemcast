/**
 * O revezamento das lojas na sincronização de pedidos.
 *
 * A cada 15 s pega até 8 lojas com trabalho — carga do histórico em
 * andamento, ou em dia com a consulta vencida (30 min) — e roda um passo de
 * cada, ao mesmo tempo. Loja grande não segura as outras: cada passo é uma
 * página, e a loja volta para o fim da fila.
 *
 * A reserva é pela trava no banco (`pedidos_trava_ate`, 5 min): dois processos
 * nunca cuidam da mesma loja, e trava de processo que caiu vence sozinha. Ela é
 * uma CTE MATERIALIZADA — `update … where id in (select … limit N for update
 * skip locked)` reserva mais que N com a RLS ligada (a mesma lição da fila do
 * disparo, em `campanha.service.ts`).
 *
 * Espera a importação de clientes da loja terminar: os pedidos se ligam aos
 * contatos que ela cria.
 *
 * Escopo de sistema só para reservar (a conta ainda não é conhecida, motivo A
 * de `docs/rls.md`); o passo roda dentro da conta.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';

import { ContextoDb } from '../../db/contexto';
import { MINUTOS_ENTRE_CONSULTAS, PedidosCardapiowebService } from './cardapioweb.pedidos.service';

const INTERVALO_MS = 15_000;
const LOJAS_POR_VOLTA = 8;

@Injectable()
export class CardapiowebPedidosJob {
  private readonly log = new Logger('CardapioWebPedidos');
  private rodando = false;

  constructor(
    private readonly ctx: ContextoDb,
    private readonly pedidos: PedidosCardapiowebService,
  ) {}

  @Interval(INTERVALO_MS)
  async volta(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      const contas = await this.reservar();
      await Promise.allSettled(contas.map((c) => this.pedidos.passo(c)));
    } catch (erro) {
      // Nunca deixa subir: exceção aqui derruba o agendador.
      this.log.error(`Volta da sincronização de pedidos falhou: ${(erro as Error)?.message ?? String(erro)}`, (erro as Error)?.stack);
    } finally {
      this.rodando = false;
    }
  }

  /** Reserva as lojas desta volta. Devolve os `conta_id`. */
  async reservar(): Promise<string[]> {
    return this.ctx.comEscopoSistema('cardapioweb.pedidos.fila', async (db) => {
      const r = await db.execute(sql`
        with alvo as materialized (
          select id from integracao_cardapioweb
           where credencial_cifrada is not null
             and sinc_status <> 'rodando'
             and (pedidos_status = 'carga'
                  or (pedidos_status = 'em_dia'
                      and (pedidos_ultima_consulta is null
                           or pedidos_ultima_consulta < now() - make_interval(mins => ${MINUTOS_ENTRE_CONSULTAS}))))
             and (pedidos_proximo_em is null or pedidos_proximo_em <= now())
             and (pedidos_trava_ate is null or pedidos_trava_ate < now())
           order by pedidos_atualizado_em nulls first
           for update skip locked
           limit ${LOJAS_POR_VOLTA}
        )
        update integracao_cardapioweb i
           set pedidos_trava_ate = now() + interval '5 minutes'
          from alvo
         where i.id = alvo.id
        returning i.conta_id
      `);
      return (r.rows as { conta_id: string }[]).map((x) => x.conta_id);
    });
  }
}
