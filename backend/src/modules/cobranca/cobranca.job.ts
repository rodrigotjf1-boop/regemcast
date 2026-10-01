/**
 * Fim do mês grátis: avisos por e-mail e inadimplência.
 *
 * Uma vez por hora:
 *
 * 1. **Avisa** o dono 7 dias antes, 3 dias antes e no dia em que o grátis
 *    acaba — só quem ainda não tem assinatura paga. Cada aviso sai uma vez
 *    (`avisos_enviados`), mesmo com duas réplicas da API: a marcação é feita
 *    ANTES do envio, num update condicional que só uma réplica ganha.
 * 2. **Marca como inadimplente** quem passou do grátis sem pagar. A carência
 *    conta a partir do fim do grátis, e o bloqueio dos disparos em si é decidido
 *    na hora do envio (`motivoDeBloqueio`) — não depende deste job ter rodado.
 *
 * Conta ligada ao Regem fica de fora das duas coisas: quem usa o Regem não paga
 * (`common/gratuidade-regem.ts`). Quando a integração é desligada, o grátis
 * dela termina naquele instante (`RegemService.desligar`) e o aviso sai com a
 * frase própria.
 *
 * Nada aqui cobra nem cancela nada no Mercado Pago.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';

import { ligadaAoRegem, MARCA_REGEM_DESLIGADO } from '../../common/gratuidade-regem';
import { env } from '../../config/env';
import { ContextoDb } from '../../db/contexto';
import { EmailService } from '../email/email.service';
import { emailFimDoGratis } from '../email/modelos-email';

const INTERVALO_MS = 60 * 60_000;

/** Em que janela cada aviso sai (dias até o fim do grátis). */
const AVISOS: { marca: string; ateDias: number; deDias: number }[] = [
  { marca: 'd7', ateDias: 7, deDias: 3 },
  { marca: 'd3', ateDias: 3, deDias: 0 },
  { marca: 'd0', ateDias: 0, deDias: -1 },
];

@Injectable()
export class CobrancaJob {
  private readonly log = new Logger('CobrancaJob');
  private rodando = false;

  constructor(
    private readonly ctx: ContextoDb,
    private readonly email: EmailService,
  ) {}

  @Interval(INTERVALO_MS)
  async rodar(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      await this.avisarFimDoGratis();
      await this.marcarInadimplentes();
    } catch (erro) {
      this.log.error(`Rodada da cobrança falhou: ${(erro as Error)?.message ?? erro}`);
    } finally {
      this.rodando = false;
    }
  }

  async avisarFimDoGratis(): Promise<number> {
    let enviados = 0;
    const base = env.rede.appUrl.replace(/\/+$/, '');

    for (const aviso of AVISOS) {
      // Reivindica os avisos desta janela numa tacada: marca e devolve quem
      // precisa receber. Outra réplica, no mesmo instante, não pega os mesmos.
      const alvos = await this.ctx.comEscopoSistema(`cobranca.aviso.${aviso.marca}`, async (db) => {
        const r = await db.execute(sql`
          update assinatura a
             set avisos_enviados = array_append(a.avisos_enviados, ${aviso.marca})
            from conta c
           where c.id = a.conta_id
             and a.status = 'cortesia'
             and a.gratis_ate is not null
             and a.mp_status is distinct from 'authorized'
             and not ${ligadaAoRegem(sql`a.conta_id`)}
             and not (${aviso.marca} = any(a.avisos_enviados))
             and a.gratis_ate <= now() + make_interval(days => ${aviso.ateDias})
             and a.gratis_ate >  now() + make_interval(days => ${aviso.deDias})
          returning a.conta_id, a.gratis_ate, c.nome as conta_nome,
                    (${MARCA_REGEM_DESLIGADO} = any(a.avisos_enviados)) as regem_desligado
        `);
        const contas = r.rows as { conta_id: string; gratis_ate: string; conta_nome: string; regem_desligado: boolean }[];
        if (!contas.length) return [];

        const donos = await db.execute(sql`
          select conta_id, email from usuario
           where papel = 'dono' and status = 'ativo'
             and conta_id in (${sql.join(contas.map((c) => sql`${c.conta_id}`), sql`, `)})
        `);
        const emailDe = new Map((donos.rows as { conta_id: string; email: string }[]).map((d) => [d.conta_id, d.email]));
        return contas.map((c) => ({ ...c, email: emailDe.get(c.conta_id) }));
      });

      for (const alvo of alvos) {
        if (!alvo.email) continue;
        const gratisAte = new Date(alvo.gratis_ate);
        const corte = new Date(gratisAte.getTime() + env.mercadoPago.carenciaDias * 86_400_000);
        try {
          await this.email.enviar(
            emailFimDoGratis(alvo.email, alvo.conta_nome, gratisAte, corte, `${base}/plano`, {
              regemDesligado: alvo.regem_desligado,
            }),
          );
          enviados += 1;
        } catch (erro) {
          // O aviso fica marcado mesmo assim: reenviar a cada hora um e-mail que
          // falha só enche a fila do provedor. O motivo vai para o log e a
          // telemetria (o EmailService registra).
          this.log.warn(`Aviso ${aviso.marca} da conta ${alvo.conta_id} não saiu: ${(erro as Error)?.message}`);
        }
      }
    }

    if (enviados) this.log.log(`${enviados} aviso(s) de fim do grátis enviados.`);
    return enviados;
  }

  async marcarInadimplentes(): Promise<number> {
    return this.ctx.comEscopoSistema('cobranca.inadimplentes', async (db) => {
      const r = await db.execute(sql`
        update assinatura a
           set status = 'inadimplente', inadimplente_desde = a.gratis_ate
         where a.status = 'cortesia'
           and a.gratis_ate is not null
           and a.gratis_ate <= now()
           and a.mp_status is distinct from 'authorized'
           and not ${ligadaAoRegem(sql`a.conta_id`)}
        returning a.id
      `);
      if (r.rows.length) this.log.log(`${r.rows.length} conta(s) passaram do grátis sem pagar.`);
      return r.rows.length;
    });
  }
}
