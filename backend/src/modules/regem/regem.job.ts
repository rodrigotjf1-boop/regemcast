/**
 * O revezamento das contas ligadas ao Regem.
 *
 * A cada 20 s pega até 8 contas com trabalho — leitura completa em andamento,
 * ou em dia com a consulta das mudanças vencida (30 min) — e roda um passo de
 * cada, ao mesmo tempo. Um passo lê no máximo 5 páginas de clientes e 5 de
 * vendas (mais uma releitura de clientes, se preciso): com 20 s entre as
 * voltas, fica abaixo das 60 consultas por minuto que o Regem aceita por token.
 * Conta grande não segura as outras: ela volta para o fim da fila.
 *
 * A reserva é pela trava no banco (`trava_ate`, 5 min): dois processos nunca
 * cuidam da mesma conta, e trava de processo que caiu vence sozinha. Ela é uma
 * CTE MATERIALIZADA — `update … where id in (select … limit N for update skip
 * locked)` reserva mais que N com a RLS ligada (a mesma lição da fila do
 * disparo, em `campanha.service.ts`).
 *
 * Escopo de sistema só para reservar (a conta ainda não é conhecida, motivo A
 * de `docs/rls.md`); o passo roda dentro da conta.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';

import { ContextoDb } from '../../db/contexto';
import { MINUTOS_ENTRE_CONSULTAS } from './regem.regras';
import { RegemService } from './regem.service';

const INTERVALO_MS = 20_000;
const CONTAS_POR_VOLTA = 8;

@Injectable()
export class RegemJob {
  private readonly log = new Logger('RegemFila');
  private rodando = false;

  constructor(
    private readonly ctx: ContextoDb,
    private readonly regem: RegemService,
  ) {}

  @Interval(INTERVALO_MS)
  async volta(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      const contas = await this.reservar();
      await Promise.allSettled(contas.map((c) => this.regem.passo(c)));
    } catch (erro) {
      // Nunca deixa subir: exceção aqui derruba o agendador.
      this.log.error(`Volta da sincronização com o Regem falhou: ${(erro as Error)?.message ?? String(erro)}`, (erro as Error)?.stack);
    } finally {
      this.rodando = false;
    }
  }

  /** Reserva as contas desta volta. Devolve os `conta_id`. */
  async reservar(): Promise<string[]> {
    return this.ctx.comEscopoSistema('regem.fila', async (db) => {
      const r = await db.execute(sql`
        with alvo as materialized (
          select id from integracao_regem
           where credencial_cifrada is not null
             and consentimento_em is not null
             and (clientes_status = 'carga'
                  or (clientes_status = 'em_dia'
                      and (clientes_ultima_consulta is null
                           or clientes_ultima_consulta < now() - make_interval(mins => ${MINUTOS_ENTRE_CONSULTAS})
                           or pedidos_status = 'carga'
                           or (pedidos_status = 'em_dia'
                               and (pedidos_ultima_consulta is null
                                    or pedidos_ultima_consulta < now() - make_interval(mins => ${MINUTOS_ENTRE_CONSULTAS}))))))
             and (proximo_em is null or proximo_em <= now())
             and (trava_ate is null or trava_ate < now())
           order by atualizado_em
           for update skip locked
           limit ${CONTAS_POR_VOLTA}
        )
        update integracao_regem i
           set trava_ate = now() + interval '5 minutes'
          from alvo
         where i.id = alvo.id
        returning i.conta_id
      `);
      return (r.rows as { conta_id: string }[]).map((x) => x.conta_id);
    });
  }
}
