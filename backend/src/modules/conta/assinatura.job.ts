/**
 * Virada do ciclo da assinatura.
 *
 * Existe por causa de um achado da auditoria: a assinatura nascia com um ciclo e
 * **ninguém nunca o avançava**. O primeiro ciclo terminava e continuava sendo o
 * "ciclo corrente" para sempre — então o contador de disparos, agora que conta,
 * somaria o uso de todos os meses num número só, e a tela de Conta mostraria
 * "12.000 de 5.000 neste mês" para quem mandou mil por mês.
 *
 * ## O que este job NÃO faz, de propósito
 *
 * Não cobra, não bloqueia e não mexe no status da assinatura. A única outra coisa
 * que faz é devolver à fila as campanhas pausadas por falta de disparos — o
 * ciclo novo é justamente o que traz os disparos de volta.
 *
 * O que acontece com quem não pagou é decisão de cobrança,
 * e cobrança é outra frente — misturar as duas aqui faria uma correção de
 * contagem virar, sem ninguém decidir, um corte de serviço.
 *
 * ## Por que em laço
 *
 * Se a API ficou fora do ar por dois meses, a assinatura está DOIS ciclos
 * atrasada. Um avanço só a deixaria ainda no passado. O laço repete até o ciclo
 * alcançar o presente, com teto para não girar para sempre num dado corrompido.
 *
 * ## Duas réplicas ao mesmo tempo
 *
 * Seguro sem trava extra. O `where ciclo_fim <= now()` é reavaliado pelo
 * Postgres depois que a primeira réplica confirma: a segunda vê o ciclo já
 * avançado, e a condição deixa de ser verdade. Ninguém avança duas vezes.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';

import { ContextoDb } from '../../db/contexto';
import { retomarPausadasPorTeto } from '../campanha/campanha.service';

/** Uma vez por hora: o ciclo é mensal, precisão de segundos não compra nada. */
const INTERVALO_MS = 60 * 60_000;

/** Teto de meses recuperados por rodada. Mais que isso é dado corrompido, não atraso. */
const MAX_VOLTAS = 24;

@Injectable()
export class AssinaturaJob {
  private readonly log = new Logger('Assinatura');
  private rodando = false;

  constructor(private readonly ctx: ContextoDb) {}

  @Interval(INTERVALO_MS)
  async virarCiclos(): Promise<number> {
    if (this.rodando) return 0;
    this.rodando = true;

    let total = 0;
    try {
      for (let volta = 0; volta < MAX_VOLTAS; volta++) {
        const avancadas = await this.ctx.comEscopoSistema('assinatura.virar_ciclo', async (db) => {
          const r = await db.execute(sql`
            update assinatura
               set ciclo_inicio = ciclo_fim,
                   ciclo_fim    = ciclo_fim + interval '1 month',
                   -- Redução de plano agendada entra agora, na virada.
                   plano_id               = coalesce(plano_proximo_ciclo_id, plano_id),
                   plano_proximo_ciclo_id = null,
                   -- Renovação cancelada: o mês pago acabou, a assinatura acaba junto.
                   status = case
                              when status = 'ativa' and mp_status in ('cancelled', 'paused') then 'cancelada'
                              else status
                            end
             where ciclo_fim <= now()
            returning conta_id
          `);
          const contas = (r.rows as { conta_id: string }[]).map((l) => l.conta_id);
          // Ciclo novo, disparos novos: quem pausou por falta de saldo volta à
          // fila na mesma transação. O worker confere o saldo na rodada seguinte.
          if (contas.length) await retomarPausadasPorTeto(db, contas);
          return contas.length;
        });

        total += avancadas;
        if (avancadas === 0) break;
      }

      if (total > 0) this.log.log(`${total} virada(s) de ciclo de assinatura.`);
    } catch (erro) {
      this.log.error(`Virada de ciclo falhou: ${(erro as Error)?.message ?? erro}`);
    } finally {
      this.rodando = false;
    }

    return total;
  }
}
