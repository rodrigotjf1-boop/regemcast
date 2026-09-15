/**
 * Processamento dos eventos da Meta.
 *
 * Duas fases separadas de propósito:
 *
 *   `registrar()`  — grava o evento. Roda dentro do request, é rápido, e é o
 *                    que permite responder 200 para a Meta sem perder nada.
 *   `processar...` — aplica o efeito. Pode falhar, pode ser repetido, pode
 *                    rodar depois de um deploy.
 *
 * A chave de idempotência sai do conteúdo do evento. A Meta reenvia quando não
 * recebe 200 a tempo, e reenvio não pode disparar de novo os efeitos — no Regem
 * a trava de idempotência protege só a linha do histórico, então o reenvio
 * responde de novo ao cliente e regrava status.
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { ContextoDb } from '../../db/contexto';
import { waEvento, waNumero } from '../../db/schema';
import { codigoDoErro, mensagemDoErroMeta, traduzirErroMeta } from './erros-meta';

/** Quantos eventos processar por passada. */
const LOTE = 50;
/** Depois disso, o evento para de ser retomado e fica para inspeção. */
const MAX_TENTATIVAS = 5;

interface Mudanca {
  field?: string;
  value?: Record<string, unknown>;
}

const QUALIDADE: Record<string, string> = {
  GREEN: 'verde',
  YELLOW: 'amarela',
  RED: 'vermelha',
  UNKNOWN: 'desconhecida',
};

@Injectable()
export class WebhookService {
  private readonly log = new Logger('MetaWebhook');

  constructor(private readonly ctx: ContextoDb) {}

  /** Grava cada mudança do payload como um evento próprio. */
  async registrar(corpo: unknown): Promise<void> {
    const mudancas = this.extrairMudancas(corpo);
    if (!mudancas.length) return;

    await this.ctx.comEscopoSistema('meta.webhook.registrar', async (db) => {
      for (const m of mudancas) {
        const phoneNumberId = this.phoneNumberIdDe(m);
        await db
          .insert(waEvento)
          .values({
            chaveIdempotencia: this.chaveDe(m),
            tipo: m.field ?? 'desconhecido',
            phoneNumberId,
            payload: m as Record<string, unknown>,
          })
          // Reenvio da Meta não cria linha nova nem reprocessa: a chave é a
          // mesma, e o evento já foi tratado (ou está na fila).
          .onConflictDoNothing({ target: waEvento.chaveIdempotencia });
      }
    });
  }

  async processarPendentes(): Promise<number> {
    const pendentes = await this.ctx.comEscopoSistema('meta.webhook.ler', async (db) =>
      db
        .select({
          id: waEvento.id,
          tipo: waEvento.tipo,
          phoneNumberId: waEvento.phoneNumberId,
          payload: waEvento.payload,
          tentativas: waEvento.tentativas,
        })
        .from(waEvento)
        .where(and(isNull(waEvento.processadoEm), sql`tentativas < ${MAX_TENTATIVAS}`))
        .orderBy(waEvento.recebidoEm)
        .limit(LOTE),
    );

    let tratados = 0;
    for (const evento of pendentes) {
      try {
        await this.aplicar(evento.tipo, evento.payload as Mudanca);
        await this.ctx.comEscopoSistema('meta.webhook.concluir', async (db) => {
          await db
            .update(waEvento)
            .set({ processadoEm: new Date(), erro: null })
            .where(eq(waEvento.id, evento.id));
        });
        tratados++;
      } catch (erro) {
        const motivo = (erro as Error)?.message ?? String(erro);
        this.log.error(`Evento ${evento.id} (${evento.tipo}) falhou: ${motivo}`);
        await this.ctx.comEscopoSistema('meta.webhook.falha', async (db) => {
          await db
            .update(waEvento)
            .set({ tentativas: sql`tentativas + 1`, erro: motivo.slice(0, 500) })
            .where(eq(waEvento.id, evento.id));
        });
      }
    }
    return tratados;
  }

  /** Despacha pelo tipo. Tipo desconhecido não é erro: fica registrado e segue. */
  private async aplicar(tipo: string, mudanca: Mudanca): Promise<void> {
    switch (tipo) {
      case 'phone_number_quality_update':
        return this.qualidadeDoNumero(mudanca);
      case 'business_capability_update':
      case 'messaging_limit_update':
        return this.limiteDoNumero(mudanca);
      case 'messages':
        return this.mensagens(mudanca);
      case 'account_update':
      case 'account_review_update':
        return this.contaAtualizada(mudanca);
      default:
        this.log.debug(`Evento "${tipo}" recebido e guardado, sem tratamento próprio.`);
    }
  }

  /**
   * Qualidade do número.
   *
   * Isto precisa chegar ao cliente, e rápido: sete dias em "amarela" derrubam o
   * tier um nível, e quem não vê a tempo se queima sem entender por quê.
   */
  private async qualidadeDoNumero(m: Mudanca): Promise<void> {
    const v = m.value ?? {};
    const phoneNumberId = this.phoneNumberIdDe(m);
    const bruta = String(v.current_limit ?? v.event ?? v.quality_score ?? '').toUpperCase();
    const qualidade = QUALIDADE[bruta] ?? 'desconhecida';
    if (!phoneNumberId) return;

    await this.ctx.comEscopoSistema('meta.webhook.qualidade', async (db) => {
      await db
        .update(waNumero)
        .set({ qualidade, qualidadeEm: new Date() })
        .where(eq(waNumero.phoneNumberId, phoneNumberId));
    });

    if (qualidade === 'amarela' || qualidade === 'vermelha') {
      this.log.warn(
        `Qualidade do número ${this.mascarar(phoneNumberId)} caiu para ${qualidade}. ` +
          'Sete dias assim derrubam o tier um nível.',
      );
    }
  }

  private async limiteDoNumero(m: Mudanca): Promise<void> {
    const v = m.value ?? {};
    const phoneNumberId = this.phoneNumberIdDe(m);
    if (!phoneNumberId) return;

    const bruto = Number(
      v.max_daily_conversation_per_phone ?? v.max_daily_conversations_per_business ?? 0,
    );
    const tierNome = typeof v.messaging_limit_tier === 'string' ? v.messaging_limit_tier : null;
    if (!bruto && !tierNome) return;

    await this.ctx.comEscopoSistema('meta.webhook.limite', async (db) => {
      await db
        .update(waNumero)
        .set({
          ...(bruto ? { tierLimite: bruto } : {}),
          ...(tierNome ? { tierNome } : {}),
          tierEm: new Date(),
        })
        .where(eq(waNumero.phoneNumberId, phoneNumberId));
    });
  }

  /**
   * Eventos de mensagem: status de entrega e mensagens recebidas.
   *
   * Por ora registra o motivo real das falhas. A reconciliação com a campanha
   * entra na Fase 4, junto com o `wamid` por destinatário — sem ele, "enviado"
   * significa apenas "a Meta aceitou o POST", que é o defeito que faz uma
   * campanha do Regem marcar 100% enviada com 100% das mensagens em `failed`.
   */
  private async mensagens(m: Mudanca): Promise<void> {
    const v = m.value ?? {};
    const statuses = Array.isArray(v.statuses) ? v.statuses : [];

    for (const s of statuses as Array<Record<string, unknown>>) {
      if (s.status !== 'failed') continue;
      const codigo = codigoDoErro(s);
      const traduzido = traduzirErroMeta(codigo, mensagemDoErroMeta(s));
      this.log.warn(
        `Mensagem ${String(s.id ?? '?').slice(-8)} falhou — ` +
          `código ${codigo ?? '—'} · ${traduzido.titulo} · classe ${traduzido.classe}`,
      );
    }
  }

  private async contaAtualizada(m: Mudanca): Promise<void> {
    const v = m.value ?? {};
    this.log.log(
      `Conta atualizada pela Meta: ${JSON.stringify(v).slice(0, 300)}`,
    );
  }

  // ------------------------------------------------------------------ apoio

  private extrairMudancas(corpo: unknown): Mudanca[] {
    if (!corpo || typeof corpo !== 'object') return [];
    const o = corpo as Record<string, unknown>;
    const entradas = Array.isArray(o.entry) ? o.entry : [];
    const saida: Mudanca[] = [];
    for (const e of entradas as Array<Record<string, unknown>>) {
      const mudancas = Array.isArray(e.changes) ? e.changes : [];
      for (const c of mudancas as Mudanca[]) saida.push(c);
    }
    return saida;
  }

  /**
   * Chave de idempotência.
   *
   * Usa o id da mensagem quando existe — é o identificador estável que a Meta
   * repete no reenvio. Sem ele, o hash do conteúdo: dois eventos idênticos são,
   * para todo efeito, o mesmo evento.
   */
  private chaveDe(m: Mudanca): string {
    const v = m.value ?? {};
    const statuses = Array.isArray(v.statuses) ? v.statuses : [];
    const mensagens = Array.isArray(v.messages) ? v.messages : [];

    const primeiro =
      (statuses[0] as Record<string, unknown> | undefined) ??
      (mensagens[0] as Record<string, unknown> | undefined);

    if (primeiro?.id && typeof primeiro.id === 'string') {
      const estado = typeof primeiro.status === 'string' ? primeiro.status : 'msg';
      // O mesmo wamid vem várias vezes, uma por estado (sent, delivered, read).
      // A chave precisa distinguir os estados, senão só o primeiro é gravado.
      return `${m.field ?? 'evento'}:${primeiro.id}:${estado}`;
    }

    const hash = createHash('sha256').update(JSON.stringify(m)).digest('hex').slice(0, 32);
    return `${m.field ?? 'evento'}:${hash}`;
  }

  private phoneNumberIdDe(m: Mudanca): string | null {
    const v = m.value ?? {};
    const metadata = (v.metadata ?? {}) as Record<string, unknown>;
    const id = metadata.phone_number_id ?? v.phone_number_id ?? v.id;
    return typeof id === 'string' ? id : null;
  }

  /** Telefone e identificador nunca vão inteiros para o log. */
  private mascarar(valor: string): string {
    return valor.length <= 4 ? '••••' : `••••${valor.slice(-4)}`;
  }
}
