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
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { ContextoDb } from '../../db/contexto';
import { campanhaDestinatario, waEvento, waNumero } from '../../db/schema';
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

/** Status da Meta × o nosso. O que não está aqui não muda estado nenhum. */
const ESTADO_DA_META: Record<string, 'enviada' | 'entregue' | 'lida'> = {
  sent: 'enviada',
  delivered: 'entregue',
  read: 'lida',
};

/**
 * De quais estados se pode ir para cada novo estado.
 *
 * `falhou` não aceita vir de `entregue` nem de `lida`: mensagem que chegou não
 * falhou, e aceitar isso apagaria a entrega por causa de um evento fora de
 * ordem.
 */
const ANTERIORES_VALIDOS: Record<string, string[]> = {
  enviada: ['pendente', 'enviando'],
  entregue: ['pendente', 'enviando', 'enviada'],
  lida: ['pendente', 'enviando', 'enviada', 'entregue'],
  falhou: ['pendente', 'enviando', 'enviada'],
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
      case 'smb_app_state_sync':
      case 'history':
        return this.sincronizacaoDoApp(tipo, mudanca);
      case 'smb_message_echoes':
        return this.ecoDeMensagem(mudanca);
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
      const wamid = typeof s.id === 'string' ? s.id : null;
      const bruto = typeof s.status === 'string' ? s.status : '';
      const nosso = ESTADO_DA_META[bruto];

      if (bruto === 'failed') {
        const codigo = codigoDoErro(s);
        const traduzido = traduzirErroMeta(codigo, mensagemDoErroMeta(s));
        this.log.warn(
          `Mensagem ${String(s.id ?? '?').slice(-8)} falhou — ` +
            `código ${codigo ?? '—'} · ${traduzido.titulo} · classe ${traduzido.classe}`,
        );
        if (wamid) {
          await this.aplicarStatus(wamid, 'falhou', {
            erroCodigo: codigo,
            erroTitulo: traduzido.titulo,
            erroDetalhe: traduzido.explicacao,
          });
        }
        continue;
      }

      if (wamid && nosso) await this.aplicarStatus(wamid, nosso, {});
    }
  }

  /**
   * Leva o destinatário ao novo estado — e só para frente.
   *
   * A Meta não garante ordem: o `delivered` pode chegar antes do `sent`, e um
   * reenvio do mesmo evento chega depois de tudo. Sem a guarda, um `sent`
   * atrasado rebaixaria uma mensagem já lida, e a tela passaria a mostrar menos
   * do que aconteceu.
   *
   * A guarda vai no `where`, não em ler-decidir-gravar: dois webhooks do mesmo
   * wamid podem chegar ao mesmo tempo, e aí o segundo sobrescreveria a decisão
   * do primeiro. O banco resolve isso; a aplicação não.
   */
  private async aplicarStatus(
    wamid: string,
    novo: 'enviada' | 'entregue' | 'lida' | 'falhou',
    erro: { erroCodigo?: number | null; erroTitulo?: string; erroDetalhe?: string },
  ): Promise<void> {
    const agora = new Date();
    const carimbo: Record<string, Date> = {
      enviada: agora,
      entregue: agora,
      lida: agora,
      falhou: agora,
    };

    await this.ctx.comEscopoSistema('meta.webhook.status', async (db) => {
      await db
        .update(campanhaDestinatario)
        .set({
          status: novo,
          ...(novo === 'enviada' ? { enviadaEm: carimbo.enviada } : {}),
          ...(novo === 'entregue' ? { entregueEm: carimbo.entregue } : {}),
          ...(novo === 'lida' ? { lidaEm: carimbo.lida } : {}),
          ...(novo === 'falhou'
            ? {
                falhouEm: carimbo.falhou,
                erroCodigo: erro.erroCodigo ?? null,
                erroTitulo: erro.erroTitulo ?? null,
                erroDetalhe: erro.erroDetalhe ?? null,
              }
            : {}),
        })
        .where(
          and(
            eq(campanhaDestinatario.waMessageId, wamid),
            inArray(campanhaDestinatario.status, ANTERIORES_VALIDOS[novo]),
          ),
        );
    });
  }

  /**
   * Sincronização da coexistência: contatos e histórico do app do celular.
   *
   * Chega em FASES (0, 1, 2) — só a última significa concluído. Marcar como
   * pronto na primeira faria o produto anunciar dado que ainda não chegou.
   *
   * O código `2593109` tem significado próprio: o cliente recusou compartilhar.
   * Não é falha nossa nem da Meta, e a diferença importa — um pede retentativa,
   * o outro pede conversa com o cliente.
   */
  private async sincronizacaoDoApp(tipo: string, m: Mudanca): Promise<void> {
    const v = m.value ?? {};
    const phoneNumberId = this.phoneNumberIdDe(m);
    if (!phoneNumberId) return;

    const erros = Array.isArray(v.errors) ? (v.errors as Array<Record<string, unknown>>) : [];
    const recusado = erros.some((e) => Number(e.code) === 2593109);

    if (recusado) {
      await this.marcarSincronizacao(phoneNumberId, 'falhou', 'O cliente não autorizou compartilhar os dados do app.');
      this.log.warn(
        `Sincronização recusada pelo cliente no número ${this.mascarar(phoneNumberId)} (2593109).`,
      );
      return;
    }

    // A Meta manda a fase em `chunk_order`/`phase`; a última traz `progress`
    // completo. Sem um marcador confiável, o seguro é só concluir quando ela
    // sinalizar o fim — e continuar "sincronizando" enquanto houver dúvida.
    const fim =
      v.sync_status === 'COMPLETED' ||
      v.status === 'COMPLETED' ||
      Number(v.progress) >= 100;

    if (fim) {
      await this.marcarSincronizacao(phoneNumberId, 'concluida', null);
      this.log.log(`Sincronização (${tipo}) concluída no número ${this.mascarar(phoneNumberId)}.`);
    } else {
      this.log.debug(`Sincronização (${tipo}) em andamento no número ${this.mascarar(phoneNumberId)}.`);
    }
  }

  /**
   * Eco de mensagem: o cliente respondeu alguém pelo app do celular.
   *
   * Por ora só registramos. Na Fase 4 isto passa a importar de verdade: uma
   * resposta do próprio lojista abre a janela de 24 horas com aquele contato, e
   * o motor precisa saber disso para escolher entre modelo aprovado e texto
   * livre.
   */
  private async ecoDeMensagem(m: Mudanca): Promise<void> {
    const phoneNumberId = this.phoneNumberIdDe(m);
    this.log.debug(
      `Eco de mensagem do app no número ${phoneNumberId ? this.mascarar(phoneNumberId) : '?'}.`,
    );
  }

  private async marcarSincronizacao(
    phoneNumberId: string,
    estado: 'concluida' | 'falhou',
    erro: string | null,
  ): Promise<void> {
    await this.ctx.comEscopoSistema('meta.webhook.sincronizacao', async (db) => {
      await db
        .update(waNumero)
        .set({ sincronizacao: estado, sincronizacaoEm: new Date(), sincronizacaoErro: erro })
        .where(eq(waNumero.phoneNumberId, phoneNumberId));
    });
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
