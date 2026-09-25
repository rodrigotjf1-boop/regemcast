/**
 * Relê o limite de envio de cada número, de tempos em tempos.
 *
 * O aviso `business_capability_update` conta quando o limite muda — mas só se
 * o campo estiver assinado no app, e aviso pode se perder. A Meta sobe o
 * degrau em até 6 horas; reler a cada 6 horas mantém em dia a tela, a trava do
 * disparo e os tamanhos de bloco sem depender só do aviso.
 *
 * A cada 30 minutos pega até 50 números com leitura vencida (mais de 6 h, ou
 * nunca lida), um de cada vez. Nenhuma transação fica aberta durante a chamada
 * à Meta. Leitura que falha não grava nada — tenta de novo na próxima volta,
 * MENOS quando a autorização do número venceu (190, classe `credencial`): aí
 * só volta a tentar 6 h depois. Insistir a cada 30 min não conserta o token —
 * só enche o log, e o aviso útil ("reconecte") se perde no meio.
 *
 * Escopo de sistema: job sem conta (motivo A, `docs/rls.md`).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { eq, sql } from 'drizzle-orm';

import { env } from '../../config/env';
import { ContextoDb } from '../../db/contexto';
import { waNumero } from '../../db/schema';
import { decifrarToken } from './cripto';
import { ErroGraph, GraphService } from './graph.service';
import { limiteInformado } from './limite.regras';

const INTERVALO_MS = 30 * 60_000;
const POR_VOLTA = 50;
/** Autorização vencida: a próxima tentativa, só depois disto. */
const ESPERA_CREDENCIAL_MS = 6 * 3_600_000;

@Injectable()
export class LimiteJob {
  private readonly log = new Logger('LimiteDaMeta');
  private rodando = false;
  /**
   * Número com autorização vencida → quando tentar de novo. Em memória, de
   * propósito: sem coluna nova só para isso; reiniciar a API tenta uma vez e
   * volta a esperar.
   */
  private readonly esperaAte = new Map<string, number>();

  constructor(
    private readonly ctx: ContextoDb,
    private readonly graph: GraphService,
  ) {}

  @Interval(INTERVALO_MS)
  async acompanhar(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      await this.atualizarVencidos();
    } catch (erro) {
      // Nunca deixa subir: exceção aqui derruba o agendador.
      this.log.error(`Leitura do limite de envio falhou: ${(erro as Error)?.message ?? String(erro)}`, (erro as Error)?.stack);
    } finally {
      this.rodando = false;
    }
  }

  /** Relê os números com leitura vencida. Devolve quantos foram atualizados. */
  async atualizarVencidos(): Promise<number> {
    const numeros = await this.ctx.comEscopoSistema('meta.limite.vencidos', async (db) => {
      const r = await db.execute(sql`
        select n.id, n.phone_number_id, c.token_cifrado
          from wa_numero n
          join wa_conta c on c.id = n.wa_conta_id
         where n.status = 'registrado'
           and c.token_cifrado is not null
           and (n.tier_em is null or n.tier_em < now() - interval '6 hours')
         order by n.tier_em nulls first
         limit ${POR_VOLTA}
      `);
      return r.rows as { id: string; phone_number_id: string; token_cifrado: string }[];
    });

    let atualizados = 0;
    const agora = Date.now();
    for (const n of numeros) {
      if ((this.esperaAte.get(n.id) ?? 0) > agora) continue;
      let bruto: unknown;
      try {
        bruto = await this.graph.limiteDoNumero(n.phone_number_id, decifrarToken(n.token_cifrado, env.meta.tokenChave));
      } catch (erro) {
        const detalhe = erro instanceof ErroGraph ? erro.detalheParaLog : String(erro);
        if (erro instanceof ErroGraph && erro.classe === 'credencial') {
          this.esperaAte.set(n.id, agora + ESPERA_CREDENCIAL_MS);
          this.log.warn(
            `A autorização do número ${this.mascarar(n.phone_number_id)} venceu: a conta precisa reconectar o WhatsApp. Tento de novo em 6 h. ${detalhe}`,
          );
        } else {
          this.log.warn(`Não consegui ler o limite de envio do número ${this.mascarar(n.phone_number_id)}: ${detalhe}`);
        }
        continue;
      }
      this.esperaAte.delete(n.id);

      const informado = limiteInformado(bruto);
      if (!informado) {
        this.log.warn(
          `A Meta respondeu um limite que não reconhecemos para o número ${this.mascarar(n.phone_number_id)}: ${JSON.stringify(bruto)}. Nada foi gravado.`,
        );
        continue;
      }

      await this.ctx.comEscopoSistema('meta.limite.gravar', (db) =>
        db
          .update(waNumero)
          .set({ tierLimite: informado.limite, tierNome: informado.nome, tierEm: new Date() })
          .where(eq(waNumero.id, n.id)),
      );
      atualizados++;
    }
    return atualizados;
  }

  private mascarar(valor: string): string {
    return valor.length <= 4 ? '••••' : `••••${valor.slice(-4)}`;
  }
}
