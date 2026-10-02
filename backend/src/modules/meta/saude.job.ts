/**
 * Relê a saúde de cada conta na Meta, de tempos em tempos.
 *
 * O aviso `account_update` conta quando a Meta restringe ou desativa a conta —
 * mas aviso se perde, e nem tudo que bloqueia o envio vira aviso (o pagamento,
 * por exemplo). Reler a cada 30 minutos mantém em dia a tela e o aviso no
 * celular, e é o que faz o dono saber do bloqueio antes de disparar.
 *
 * A cada 30 minutos pega até 50 contas com leitura vencida (mais de 30 minutos,
 * ou nunca lida), uma de cada vez. Nenhuma transação fica aberta durante a
 * chamada à Meta. Autorização vencida (190, classe `credencial`) só volta a ser
 * tentada no dia seguinte: insistir não conserta o token, só enche o log.
 *
 * Escopo de sistema: job sem conta (motivo A, `docs/rls.md`).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';

import { ContextoDb } from '../../db/contexto';
import { SaudeService } from './saude.service';

const INTERVALO_MS = 30 * 60_000;
const POR_VOLTA = 50;
/** Autorização vencida: a próxima tentativa, só depois disto. */
const ESPERA_CREDENCIAL_MS = 24 * 3_600_000;

@Injectable()
export class SaudeJob {
  private readonly log = new Logger('SaudeDaConta');
  private rodando = false;
  /** Conta com autorização vencida → quando tentar de novo. Em memória, como no limite de envio. */
  private readonly esperaAte = new Map<string, number>();

  constructor(
    private readonly ctx: ContextoDb,
    private readonly saude: SaudeService,
  ) {}

  @Interval(INTERVALO_MS)
  async acompanhar(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      await this.atualizarVencidas();
    } catch (erro) {
      // Nunca deixa subir: exceção aqui derruba o agendador.
      this.log.error(`Leitura da saúde das contas falhou: ${(erro as Error)?.message ?? String(erro)}`, (erro as Error)?.stack);
    } finally {
      this.rodando = false;
    }
  }

  /** Relê as contas com leitura vencida. Devolve quantas foram lidas. */
  async atualizarVencidas(): Promise<number> {
    const contas = await this.ctx.comEscopoSistema('meta.saude.vencidas', async (db) => {
      const r = await db.execute(sql`
        select id
          from wa_conta
         where token_cifrado is not null
           and (saude_em is null or saude_em < now() - interval '30 minutes')
         order by saude_em nulls first
         limit ${POR_VOLTA}
      `);
      return r.rows as { id: string }[];
    });

    let lidas = 0;
    const agora = Date.now();
    for (const c of contas) {
      if ((this.esperaAte.get(c.id) ?? 0) > agora) continue;
      const r = await this.saude.atualizarDoSistema({ waContaId: c.id });
      if (r.credencial) this.esperaAte.set(c.id, agora + ESPERA_CREDENCIAL_MS);
      else this.esperaAte.delete(c.id);
      if (r.leu) lidas++;
    }
    return lidas;
  }
}
