/**
 * Vigia do prazo da coexistência.
 *
 * A Meta dá **24 horas**, contadas do fim do onboarding, para copiarmos os
 * dados do WhatsApp Business do celular. Estourado o prazo, ela desfaz a
 * conexão — e o cliente só descobre quando a primeira campanha não sai.
 *
 * Três coisas acontecem aqui, nesta ordem:
 *
 * 1. **Quem terminou vira `concluida`**, pelo histórico já recebido. É a rede
 *    de segurança do webhook: até 24/09/2026 o aviso de 100% era procurado no
 *    lugar errado e nunca concluía nada (ver `coexistencia.regras.ts`).
 *
 * 2. **Quem ficou 24 horas SEM SINAL vira `expirada`.** Não basta o relógio da
 *    conexão: com a cópia chegando, marcar "expirado" mandaria o cliente
 *    conectar de novo sem motivo. Por isso só expira quem não recebeu lote
 *    nenhum de agenda ou histórico nas últimas 24 horas.
 *
 * 3. **Quem ficou em `pendente` ganha nova tentativa.** Existe uma janela real
 *    entre gravar o número (que já nasce "pendente") e pedir a sincronização à
 *    Meta. Processo que cai nesse intervalo deixa o número parado, com o
 *    relógio das 24 horas correndo em silêncio. Sem esta retomada, a única
 *    saída seria o cliente refazer o fluxo inteiro sem entender por quê.
 *
 * O intervalo é de 15 minutos porque o prazo é de 24 horas: precisão de
 * segundos aqui não compra nada, e bater no banco de minuto em minuto por um
 * evento que muda uma vez por dia é desperdício.
 *
 * Uma réplica só, como o resto da Fase 1. Com mais de uma, N réplicas fariam a
 * mesma varredura — as marcações são idempotentes, mas a retomada mandaria o
 * mesmo pedido N vezes à Meta. Quando o disparo virar fila (Fase 4), isto vai
 * junto, com lock no Redis.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';

import { ContextoDb } from '../../db/contexto';
import { waNumero } from '../../db/schema';
import { MetaService } from './meta.service';

const INTERVALO_MS = 15 * 60_000;
const PRAZO_HORAS = 24;
/** Teto por rodada: uma varredura não pode virar uma enxurrada de chamadas. */
const LOTE = 100;

const MENSAGEM_EXPIRADA =
  'O prazo de 24 horas para copiar os dados do WhatsApp Business terminou. ' +
  'Conecte o número de novo e mantenha o aplicativo aberto no celular durante a cópia.';

@Injectable()
export class CoexistenciaJob {
  private readonly log = new Logger('Coexistencia');
  private rodando = false;

  constructor(
    private readonly ctx: ContextoDb,
    private readonly meta: MetaService,
  ) {}

  @Interval(INTERVALO_MS)
  async acompanhar(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      // Concluir ANTES de expirar: quem terminou não pode ser tratado como vencido.
      await this.concluirPeloHistorico();
      await this.expirarVencidos();
      await this.retomarPendentes();
    } catch (erro) {
      // Nunca deixa subir: exceção aqui derruba o agendador e leva junto a
      // própria rede de segurança.
      this.log.error(
        `Acompanhamento da coexistência falhou: ${(erro as Error)?.message ?? String(erro)}`,
        (erro as Error)?.stack,
      );
    } finally {
      this.rodando = false;
    }
  }

  /**
   * Conclui quem já recebeu o aviso de 100% no histórico.
   *
   * O lote de histórico fica guardado no registro de eventos até ser gravado
   * nas conversas, então a conclusão pode ser lida dali — inclusive a de quem
   * terminou antes de o webhook saber ler o progresso. Só olha números ainda
   * "sincronizando": no dia a dia, a consulta não acha ninguém.
   *
   * A referência ao número é `wa_numero.phone_number_id` escrita por extenso,
   * de propósito: `wa_evento` também tem `phone_number_id`, e um nome sem
   * tabela dentro do `exists` casaria o evento com ele mesmo — concluindo
   * todos os números de uma vez.
   */
  private async concluirPeloHistorico(): Promise<void> {
    const concluidos = await this.ctx.comEscopoSistema('coexistencia.concluir', (db) =>
      db
        .update(waNumero)
        .set({ sincronizacao: 'concluida', sincronizacaoEm: new Date(), sincronizacaoErro: null })
        .where(
          and(
            eq(waNumero.sincronizacao, 'sincronizando'),
            sql`exists (
              select 1 from wa_evento e
               where e.phone_number_id = wa_numero.phone_number_id
                 and e.tipo = 'history'
                 and jsonb_path_exists(e.payload, '$.value.history[*].metadata.progress ? (@ >= 100 || @ == "100")')
            )`,
          ),
        )
        .returning({ phoneNumberId: waNumero.phoneNumberId }),
    );

    for (const n of concluidos) {
      this.log.log(`Sincronização concluída pelo histórico recebido no número ${this.mascarar(n.phoneNumberId)}.`);
    }
  }

  /**
   * Marca como `expirada` quem passou das 24 horas sem sinal da cópia.
   *
   * Escopo de sistema porque a varredura é entre contas: o job acorda sem
   * sessão e sem conta. Ele não faz regra de negócio aqui — só carimba o
   * estado e sai.
   */
  private async expirarVencidos(): Promise<void> {
    const limite = new Date(Date.now() - PRAZO_HORAS * 3_600_000);

    const vencidos = await this.ctx.comEscopoSistema('coexistencia.expirar', (db) =>
      db
        .update(waNumero)
        .set({
          sincronizacao: 'expirada',
          sincronizacaoEm: new Date(),
          sincronizacaoErro: MENSAGEM_EXPIRADA,
        })
        .where(
          and(
            inArray(waNumero.sincronizacao, ['pendente', 'sincronizando']),
            isNotNull(waNumero.onboardadoEm),
            lt(waNumero.onboardadoEm, limite),
            // Lote chegando é cópia andando: só expira quem ficou 24 horas sem
            // receber nada de agenda nem de histórico.
            sql`not exists (
              select 1 from wa_evento e
               where e.phone_number_id = wa_numero.phone_number_id
                 and e.tipo in ('history', 'smb_app_state_sync')
                 and e.recebido_em > now() - make_interval(hours => ${PRAZO_HORAS})
            )`,
          ),
        )
        .returning({ id: waNumero.id, phoneNumberId: waNumero.phoneNumberId }),
    );

    for (const n of vencidos) {
      this.log.warn(
        `Prazo de sincronização estourado no número ${this.mascarar(n.phoneNumberId)}. ` +
          'A Meta desfaz a conexão; o cliente precisa conectar de novo.',
      );
    }
  }

  /**
   * Tenta de novo os que ficaram em `pendente` com prazo ainda de pé.
   *
   * O escopo de sistema dura só a consulta da fila. A ação acontece em
   * `comConta`, dentro do `MetaService` — que é onde o token daquele cliente
   * pode ser lido.
   */
  private async retomarPendentes(): Promise<void> {
    const fila = await this.ctx.comEscopoSistema('coexistencia.fila', (db) =>
      db
        .select({
          id: waNumero.id,
          contaId: waNumero.contaId,
          phoneNumberId: waNumero.phoneNumberId,
        })
        .from(waNumero)
        .where(inArray(waNumero.sincronizacao, ['pendente']))
        .limit(LOTE),
    );

    if (fila.length === 0) return;

    this.log.log(`${fila.length} número(s) com sincronização pendente. Pedindo de novo à Meta.`);

    for (const n of fila) {
      const estado = await this.meta.retomarSincronizacao(n.contaId, n.id, n.phoneNumberId);
      if (estado === 'sincronizando') {
        this.log.log(`Sincronização retomada no número ${this.mascarar(n.phoneNumberId)}.`);
      }
    }
  }

  /** Identificador nunca vai inteiro para o log. */
  private mascarar(valor: string): string {
    return valor.length <= 4 ? '••••' : `••••${valor.slice(-4)}`;
  }
}
