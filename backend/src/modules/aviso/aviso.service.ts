/**
 * Avisos no celular: quem recebe o quê.
 *
 * Três tipos, que a pessoa liga e desliga por aparelho no app:
 *   - `campanhas`: campanha terminou ou parou sozinha (conexão, plano, pagamento);
 *   - `modelos`: a Meta aprovou, recusou ou pausou um modelo;
 *   - `cobranca`: pagamento recusado — este só para o dono.
 *
 * `avisar` NUNCA lança e nunca espera o Firebase dentro de uma transação: quem
 * chama faz `void this.avisos.avisar(...)` depois de gravar. Aviso atrasado ou
 * perdido é incômodo; campanha que trava porque o Firebase caiu é defeito.
 *
 * Tudo aqui roda na conta (`comConta`), menos registrar o aparelho: o token do
 * celular é único na base e pode estar em outra conta (`docs/rls.md`, motivo A).
 */
import { Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { ContextoDb } from '../../db/contexto';
import { dispositivo } from '../../db/schema';
import { FcmService, type MensagemPush } from './fcm.service';

export type TipoAviso = 'campanhas' | 'modelos' | 'cobranca';
export const TIPOS_AVISO: TipoAviso[] = ['campanhas', 'modelos', 'cobranca'];

export interface Avisos {
  campanhas: boolean;
  modelos: boolean;
  cobranca: boolean;
}

/** Normaliza o JSON gravado: chave ausente ou torta = ligado. */
export function avisosDe(bruto: unknown): Avisos {
  const o = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  return {
    campanhas: o.campanhas !== false,
    modelos: o.modelos !== false,
    cobranca: o.cobranca !== false,
  };
}

@Injectable()
export class AvisoService {
  private readonly log = new Logger('Avisos');

  constructor(
    private readonly ctx: ContextoDb,
    private readonly fcm: FcmService,
  ) {}

  /** Grava (ou move para esta conta) o aparelho. Escopo sistema: o token é único na base. */
  async registrar(
    u: { id: string; contaId: string },
    dados: { token: string; appVersao?: string; modelo?: string },
  ): Promise<Avisos> {
    return this.ctx.comEscopoSistema('aviso.registrar_dispositivo', async (db) => {
      const [linha] = await db
        .insert(dispositivo)
        .values({
          contaId: u.contaId,
          usuarioId: u.id,
          tokenFcm: dados.token,
          appVersao: dados.appVersao ?? null,
          modelo: dados.modelo ?? null,
        })
        .onConflictDoUpdate({
          target: dispositivo.tokenFcm,
          // Trocou de conta ou de pessoa: as preferências antigas eram de outro
          // alguém, então voltam ao padrão. Mesma pessoa: ficam.
          set: {
            contaId: u.contaId,
            usuarioId: u.id,
            appVersao: dados.appVersao ?? null,
            modelo: dados.modelo ?? null,
            vistoEm: new Date(),
            avisos: sql`case when ${dispositivo.usuarioId} = ${u.id}
                             then ${dispositivo.avisos}
                             else '{"campanhas": true, "modelos": true, "cobranca": true}'::jsonb end`,
          },
        })
        .returning({ avisos: dispositivo.avisos });
      return avisosDe(linha?.avisos);
    });
  }

  /** Sair do app: o aparelho para de receber. Só apaga o que é da própria pessoa, na conta dela. */
  async remover(u: { id: string; contaId: string }, token: string): Promise<void> {
    await this.ctx.comConta(u.contaId, (db) =>
      db
        .delete(dispositivo)
        .where(
          and(eq(dispositivo.contaId, u.contaId), eq(dispositivo.tokenFcm, token), eq(dispositivo.usuarioId, u.id)),
        ),
    );
  }

  async preferencias(u: { id: string; contaId: string }, token: string): Promise<Avisos | null> {
    return this.ctx.comConta(u.contaId, async (db) => {
      const [linha] = await db
        .select({ avisos: dispositivo.avisos })
        .from(dispositivo)
        .where(and(eq(dispositivo.tokenFcm, token), eq(dispositivo.usuarioId, u.id)))
        .limit(1);
      return linha ? avisosDe(linha.avisos) : null;
    });
  }

  async definirPreferencias(
    u: { id: string; contaId: string },
    token: string,
    mudancas: Partial<Avisos>,
  ): Promise<Avisos | null> {
    return this.ctx.comConta(u.contaId, async (db) => {
      const [atual] = await db
        .select({ avisos: dispositivo.avisos })
        .from(dispositivo)
        .where(and(eq(dispositivo.tokenFcm, token), eq(dispositivo.usuarioId, u.id)))
        .limit(1);
      if (!atual) return null;
      const novo = { ...avisosDe(atual.avisos), ...mudancas };
      await db
        .update(dispositivo)
        .set({ avisos: novo })
        .where(and(eq(dispositivo.tokenFcm, token), eq(dispositivo.usuarioId, u.id)));
      return novo;
    });
  }

  /**
   * Manda o aviso para os aparelhos da conta que querem este tipo.
   * Não lança. Token que o FCM diz não existir mais é apagado.
   */
  async avisar(
    contaId: string,
    tipo: TipoAviso,
    mensagem: MensagemPush,
    opcoes: { soDono?: boolean } = {},
  ): Promise<void> {
    if (!this.fcm.ligado) return;
    try {
      // Na conta: `comConta` abre transação própria, então vale também para o
      // aviso que sai solto, depois que a transação de quem chamou terminou.
      const alvos = await this.ctx.comConta(contaId, async (db) => {
        const r = await db.execute(sql`
          select d.id, d.token_fcm
            from dispositivo d
            join usuario u on u.id = d.usuario_id
           where d.conta_id = ${contaId}
             and u.conta_id = ${contaId}
             and u.status = 'ativo'
             and coalesce((d.avisos ->> ${tipo})::boolean, true)
             ${opcoes.soDono ? sql`and u.papel = 'dono'` : sql``}
        `);
        return r.rows as { id: string; token_fcm: string }[];
      });
      if (!alvos.length) return;

      const dados = { tipo, ...(mensagem.dados ?? {}) };
      const resultados = await Promise.all(
        alvos.map((a) => this.fcm.enviar(a.token_fcm, { ...mensagem, dados })),
      );
      const mortos = alvos.filter((_, i) => resultados[i] === 'invalido').map((a) => a.id);
      if (mortos.length) {
        await this.ctx.comConta(contaId, (db) =>
          db.delete(dispositivo).where(and(eq(dispositivo.contaId, contaId), inArray(dispositivo.id, mortos))),
        );
      }
    } catch (erro) {
      this.log.warn(`Aviso "${tipo}" para a conta ${contaId} não saiu: ${String(erro)}`);
    }
  }
}
