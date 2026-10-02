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

import { doWhatsapp, gemeoDoCelular } from '../../common/telefone';
import { ContextoDb, type Db } from '../../db/contexto';
import { avisoDaCategoria, avisoDaQualidade, lerMudancaDeCategoria, lerMudancaDeQualidade } from './modelo-sinais';
import { motivoDoModelo } from './motivos-modelo';
import { avisoDoNome, lerDecisaoDoNome } from './nome-exibicao.regras';
import { ERRO_SEM_WHATSAPP, registrarFalhaSemWhatsapp } from '../contato/sem-whatsapp';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AvisoService } from '../aviso/aviso.service';
import { campanha, campanhaDestinatario, conta, modelo, waConta, waEvento, waNumero } from '../../db/schema';
import type { DestinoDoEvento } from './agenda.regras';
import { AgendaService } from './agenda.service';
import { ConversasService } from './conversas.service';
import { historicoRecusado, sincronizacaoConcluida } from './coexistencia.regras';
import {
  codigoDoErro,
  limparMensagemDaMeta,
  mensagemDoErroMeta,
  pausaPorErro,
  traduzirErroMeta,
  type ErroMetaTraduzido,
} from './erros-meta';
import { limiteInformado } from './limite.regras';
import { ERRO_MARKETING_PARADO, ORIGEM_PREFERENCIA, preferenciasDoAviso } from './preferencias.regras';
import { SaudeService } from './saude.service';
import { type TarifaDaMensagem, tarifaDoStatus } from './tarifa.regras';

/**
 * Mudanças na conta que não mexem no envio (tarifa, país, termos, parceiro
 * acrescentado): ficam no log, sem reler a saúde.
 */
const SO_INFORMATIVOS = new Set([
  'AD_ACCOUNT_LINKED',
  'AUTH_INTL_PRICE_ELIGIBILITY_UPDATE',
  'BUSINESS_PRIMARY_LOCATION_COUNTRY_UPDATE',
  'MM_LITE_TERMS_SIGNED',
  'PARTNER_ADDED',
  'PARTNER_APP_INSTALLED',
  'PARTNER_CLIENT_CERTIFICATION_STATUS_UPDATE',
  'VOLUME_BASED_PRICING_TIER_UPDATE',
]);

/** Quantos eventos processar por passada. */
const LOTE = 50;
/** Depois disso, o evento para de ser retomado e fica para inspeção. */
const MAX_TENTATIVAS = 5;

/**
 * O que sobra de um evento cujo conteúdo foi esvaziado: a linha continua (é a
 * trava de idempotência e o rastro de que o evento chegou), o conteúdo não.
 */
const CONTEUDO_ESVAZIADO = { esvaziado: true };

interface Mudanca {
  field?: string;
  value?: Record<string, unknown>;
  /**
   * O `entry.id` de onde a mudança veio — a WABA. Aviso de conta (limite de
   * envio, por exemplo) não traz número nenhum no `value`: sem isto, não dá
   * para saber de quem é. E entra na chave de idempotência: o mesmo aviso de
   * duas WABAs diferentes (as duas subiram para 2.000) não é o mesmo evento.
   */
  entrada?: string;
  /**
   * O `entry.time` — quando a Meta disparou o aviso. Entra na chave de
   * idempotência dos avisos sem id de mensagem: o MESMO conteúdo em outro
   * momento é outro evento (o modelo que cai de qualidade pela segunda vez, o
   * número sinalizado de novo), e sem isto seria descartado como reenvio.
   */
  quando?: number;
}

/** Evento da Meta → status do nosso registro. O que não está aqui é ignorado. */
const STATUS_DO_MODELO: Record<string, string> = {
  APPROVED: 'aprovado',
  REJECTED: 'rejeitado',
  PAUSED: 'pausado',
  DISABLED: 'desativado',
  PENDING: 'enviado',
  IN_APPEAL: 'enviado',
  REINSTATED: 'aprovado',
};

const QUALIDADE: Record<string, string> = {
  GREEN: 'verde',
  YELLOW: 'amarela',
  RED: 'vermelha',
  UNKNOWN: 'desconhecida',
};

/**
 * As palavras que valem como "não quero mais receber".
 *
 * Comparação sobre o texto INTEIRO, sem acento e sem pontuação: "parar" sozinho
 * é pedido de saída; "não vou parar de comprar com vocês" não é. Bloquear por
 * palavra solta no meio da frase tiraria da base quem não pediu nada.
 */
const PEDIDOS_DE_SAIDA = new Set([
  'parar promocoes',
  'parar',
  'pare',
  'sair',
  'sair da lista',
  'stop',
  'stop promotions',
  'cancelar',
  'descadastrar',
  'remover',
  'nao quero mais receber',
  'nao quero receber mais',
]);

export function ehPedidoDeSaida(texto: string): boolean {
  const limpo = (texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return limpo.length > 0 && PEDIDOS_DE_SAIDA.has(limpo);
}

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

  constructor(
    private readonly ctx: ContextoDb,
    private readonly auditoria: AuditoriaService,
    private readonly avisos: AvisoService,
    private readonly agenda: AgendaService,
    private readonly conversas: ConversasService,
    private readonly saude: SaudeService,
  ) {}

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
        const destino = await this.aplicar(evento.tipo, evento.payload as Mudanca);
        await this.ctx.comEscopoSistema('meta.webhook.concluir', async (db) => {
          await db
            .update(waEvento)
            .set({
              processadoEm: new Date(),
              erro: null,
              // Agenda e histórico de conversa são dado pessoal: depois de
              // gravados no lugar deles (ou recusados pelo dono), não ficam
              // copiados aqui.
              ...(destino === 'esvaziar' ? { payload: CONTEUDO_ESVAZIADO } : {}),
            })
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

  /**
   * Despacha pelo tipo. Tipo desconhecido não é erro: fica registrado e segue.
   *
   * Devolve `esvaziar` quando o conteúdo do evento não deve continuar guardado.
   */
  private async aplicar(tipo: string, mudanca: Mudanca): Promise<DestinoDoEvento | void> {
    switch (tipo) {
      case 'phone_number_quality_update':
        return this.qualidadeDoNumero(mudanca);
      case 'phone_number_name_update':
        return this.nomeDoNumero(mudanca);
      case 'business_capability_update':
      case 'messaging_limit_update':
        return this.limiteDoNumero(mudanca);
      case 'messages': {
        // Primeiro o de sempre (pedido de saída, status de campanha), que não
        // depende da conversa; depois a conversa, se o número guarda.
        await this.mensagens(mudanca);
        const phoneNumberId = this.phoneNumberIdDe(mudanca);
        return phoneNumberId ? this.conversas.recebidas(phoneNumberId, mudanca.value ?? {}) : undefined;
      }
      case 'account_update':
      case 'account_review_update':
        return this.contaAtualizada(mudanca);
      case 'smb_app_state_sync':
        await this.sincronizacaoDoApp(tipo, mudanca);
        return this.agendaDoApp(mudanca);
      case 'history':
        await this.sincronizacaoDoApp(tipo, mudanca);
        return this.historicoDoApp(mudanca);
      case 'smb_message_echoes':
        return this.ecoDeMensagem(mudanca);
      case 'message_template_status_update':
        return this.statusDoModelo(mudanca);
      case 'message_template_quality_update':
        return this.qualidadeDoModelo(mudanca);
      case 'template_category_update':
        return this.categoriaDoModelo(mudanca);
      case 'user_preferences':
        return this.preferenciasDeMarketing(mudanca);
      default:
        this.log.debug(`Evento "${tipo}" recebido e guardado, sem tratamento próprio.`);
    }
  }

  /**
   * A Meta decidiu sobre um modelo: aprovou, recusou, pausou, desativou.
   *
   * Sem isto o nosso registro ficava em "enviado" para sempre — a lista da
   * Meta mostrava aprovado e a nossa contagem de "em análise" nunca baixava.
   * O modelo é achado pelo id da Meta (índice único `idx_modelo_meta_id`);
   * modelo criado fora do RegemCast não tem linha aqui e é ignorado.
   */
  private async statusDoModelo(m: Mudanca): Promise<void> {
    const v = m.value ?? {};
    const idMeta = v.message_template_id != null ? String(v.message_template_id) : '';
    const evento = String(v.event ?? '').toUpperCase();
    const status = STATUS_DO_MODELO[evento];
    if (!idMeta || !status) return;

    const motivo =
      status === 'rejeitado' || status === 'pausado' || status === 'desativado'
        ? motivoDoModelo(String(v.reason ?? ''))
        : null;

    const alterado = await this.ctx.comEscopoSistema('meta.webhook.modelo', async (db) => {
      const [linha] = await db
        .update(modelo)
        .set({
          status,
          motivo,
          respondidoEm: status === 'enviado' ? null : new Date(),
        })
        .where(and(eq(modelo.metaTemplateId, idMeta), sql`${modelo.status} <> ${status}`))
        .returning({ contaId: modelo.contaId, id: modelo.id, nome: modelo.nome });
      return linha ?? null;
    });
    if (!alterado) return;

    const texto: Record<string, [string, string]> = {
      aprovado: ['Modelo aprovado', 'A Meta aprovou o modelo. Ele já pode ser usado em campanha.'],
      rejeitado: ['Modelo recusado', motivo ? `A Meta recusou o modelo: ${motivo}` : 'A Meta recusou o modelo. Abra para ver o que ajustar.'],
      pausado: ['Modelo pausado pela Meta', 'Muita gente bloqueou ou denunciou este modelo. Ele não envia até a Meta liberar.'],
      desativado: ['Modelo desativado pela Meta', 'O modelo não pode mais ser usado. Crie outro pelo site.'],
    };
    const [titulo, corpo] = texto[status] ?? [];
    if (!titulo) return;
    void this.avisos.avisar(alterado.contaId, 'modelos', {
      titulo: `${titulo}: ${alterado.nome}`,
      corpo,
      dados: { modeloId: alterado.id },
    });
  }

  /**
   * De quem é o modelo de um aviso: a conta, o fuso dela e o nosso registro do
   * modelo, se existir.
   *
   * O aviso chega pelo id do modelo na Meta e pela WABA (`entry.id`), sem conta.
   * Modelo criado fora do Regemcast não tem linha aqui — e mesmo assim o dono
   * precisa saber: a conta sai da WABA.
   */
  private async donoDoModelo(
    idMeta: string,
    wabaId: string | undefined,
  ): Promise<{ contaId: string; fuso: string; modeloId: string | null; nome: string | null } | null> {
    return this.ctx.comEscopoSistema('meta.webhook.modelo', async (db) => {
      const [local] = idMeta
        ? await db
            .select({ contaId: modelo.contaId, id: modelo.id, nome: modelo.nome })
            .from(modelo)
            .where(eq(modelo.metaTemplateId, idMeta))
            .limit(1)
        : [];
      let contaId = local?.contaId ?? null;
      if (!contaId && wabaId) {
        const [daWaba] = await db.select({ contaId: waConta.contaId }).from(waConta).where(eq(waConta.wabaId, wabaId)).limit(1);
        contaId = daWaba?.contaId ?? null;
      }
      if (!contaId) return null;
      const [c] = await db.select({ fuso: conta.timezone }).from(conta).where(eq(conta.id, contaId)).limit(1);
      return { contaId, fuso: c?.fuso ?? 'America/Sao_Paulo', modeloId: local?.id ?? null, nome: local?.nome ?? null };
    });
  }

  /**
   * A qualidade de um modelo mudou (`message_template_quality_update`).
   *
   * Só a QUEDA vira aviso no celular: em vermelha o modelo está para ser
   * pausado, e pausado nenhuma campanha com ele sai. A tela lê a qualidade na
   * própria lista da Meta — aqui não se guarda nada.
   */
  private async qualidadeDoModelo(m: Mudanca): Promise<void> {
    const mudanca = lerMudancaDeQualidade(m.value ?? {});
    const aviso = mudanca && avisoDaQualidade(mudanca);
    if (!mudanca || !aviso) return;

    const dono = await this.donoDoModelo(mudanca.idMeta, m.entrada);
    if (!dono) return;
    void this.avisos.avisar(dono.contaId, 'modelos', {
      ...aviso,
      dados: { tela: 'modelos', ...(dono.modeloId ? { modeloId: dono.modeloId } : {}) },
    });
  }

  /**
   * A Meta vai mudar, ou mudou, a categoria de um modelo
   * (`template_category_update`).
   *
   * Ela reclassifica o que considera marketing disfarçado de utilidade: avisa
   * com 24 horas e muda. O preço por mensagem muda junto. Os dois momentos
   * viram aviso no celular; na mudança feita, o nosso registro guarda a
   * categoria nova em `categoria_meta`.
   */
  private async categoriaDoModelo(m: Mudanca): Promise<void> {
    const mudanca = lerMudancaDeCategoria(m.value ?? {});
    if (!mudanca) return;

    const dono = await this.donoDoModelo(mudanca.idMeta, m.entrada);
    if (!dono) return;

    if (mudanca.feita && dono.modeloId) {
      const modeloId = dono.modeloId;
      await this.ctx.comEscopoSistema('meta.webhook.modelo', (db) =>
        db.update(modelo).set({ categoriaMeta: mudanca.paraBruta }).where(eq(modelo.id, modeloId)),
      );
    }

    void this.avisos.avisar(dono.contaId, 'modelos', {
      ...avisoDaCategoria(mudanca, dono.fuso),
      dados: { tela: 'modelos', ...(dono.modeloId ? { modeloId: dono.modeloId } : {}) },
    });
  }

  /**
   * A Meta decidiu sobre o nome de exibição de um número
   * (`phone_number_name_update`).
   *
   * Com o nome sem aprovação o número envia com limite menor. O aviso chega
   * pela WABA (`entry.id`) e pelo telefone, sem conta e sem o id do número:
   *
   * - relê a saúde da conta na hora — é ela que diz se a restrição acabou, e a
   *   tela do WhatsApp passa a mostrar o estado novo;
   * - aprovado, guarda o nome no número (achado pelo telefone, dentro da WABA);
   * - aprovado ou recusado, avisa o dono no celular. "Em análise" e "adiado"
   *   não avisam.
   */
  private async nomeDoNumero(m: Mudanca): Promise<void> {
    const decisao = lerDecisaoDoNome(m.value ?? {});
    const wabaId = m.entrada;
    if (!decisao || !wabaId) return;

    const contaId = await this.ctx.comEscopoSistema('meta.webhook.nome', async (db) => {
      const [conta] = await db.select({ id: waConta.id, contaId: waConta.contaId }).from(waConta).where(eq(waConta.wabaId, wabaId)).limit(1);
      if (!conta) return null;
      if (decisao.decisao === 'aprovado' && decisao.nome && decisao.telefoneE164) {
        await db
          .update(waNumero)
          .set({ nomeExibicao: decisao.nome })
          .where(and(eq(waNumero.waContaId, conta.id), eq(waNumero.telefoneE164, decisao.telefoneE164)));
      }
      return conta.contaId;
    });
    if (!contaId) return;

    await this.saude.atualizarDoSistema({ wabaId });

    const aviso = avisoDoNome(decisao);
    if (!aviso) return;
    void this.avisos.avisar(contaId, 'campanhas', { ...aviso, dados: { tela: 'whatsapp' } });
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

  /**
   * O limite de envio mudou (`business_capability_update`).
   *
   * Desde out/2025 o limite é do PORTFÓLIO: o aviso chega pela WABA, sem
   * número nenhum, e vale para todos os números dela. Os formatos (nome do
   * degrau, número, -1) e a fonte estão em `limite.regras.ts`; valor que não
   * reconhecemos não grava nada — nunca vira "sem teto".
   */
  private async limiteDoNumero(m: Mudanca): Promise<void> {
    const v = m.value ?? {};
    const informado =
      limiteInformado(v.max_daily_conversations_per_business) ??
      limiteInformado(v.max_daily_conversation_per_phone) ??
      limiteInformado(v.messaging_limit_tier);
    if (!informado) return;

    const phoneNumberId = this.phoneNumberIdDe(m);
    const wabaId = m.entrada ?? null;
    if (!phoneNumberId && !wabaId) return;

    const alterados = await this.ctx.comEscopoSistema('meta.webhook.limite', async (db) => {
      const r = await db.execute(sql`
        update wa_numero n
           set tier_limite = ${informado.limite},
               tier_nome = ${informado.nome},
               tier_em = now()
         where ${
           phoneNumberId
             ? sql`n.phone_number_id = ${phoneNumberId}`
             : sql`n.wa_conta_id in (select c.id from wa_conta c where c.waba_id = ${wabaId})`
         }
        returning n.id
      `);
      return r.rows.length;
    });

    this.log.log(`Limite de envio agora ${informado.nome}: ${alterados} número(s) atualizado(s).`);
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

    await this.pedidosDeSaida(m);
    await this.respostasDeCampanha(m);

    for (const s of statuses as Array<Record<string, unknown>>) {
      const wamid = typeof s.id === 'string' ? s.id : null;
      const bruto = typeof s.status === 'string' ? s.status : '';
      const nosso = ESTADO_DA_META[bruto];
      // A tarifa vem no aviso de envio e em mais um (entrega ou leitura).
      const tarifa = tarifaDoStatus(s);

      if (bruto === 'failed') {
        const codigo = codigoDoErro(s);
        const daMeta = limparMensagemDaMeta(mensagemDoErroMeta(s));
        const traduzido = traduzirErroMeta(codigo, daMeta);
        this.log.warn(
          `Mensagem ${String(s.id ?? '?').slice(-8)} falhou — ` +
            `código ${codigo ?? '—'} · ${traduzido.titulo} · classe ${traduzido.classe} · alcance ${traduzido.alcance}`,
        );
        if (wamid) {
          const campanhas = await this.aplicarStatus(wamid, 'falhou', {
            erroCodigo: codigo,
            erroTitulo: traduzido.titulo,
            erroDetalhe: traduzido.explicacao,
            erroMeta: daMeta || null,
          });
          // A Meta aceitou e recusou depois, por algo que não é desta pessoa (o
          // pagamento da conta, uma restrição, o modelo): as próximas teriam a
          // mesma resposta. A campanha para, com a fila guardada.
          if (codigo !== null) await this.pausarPorErro(campanhas, traduzido, daMeta);
        }
        continue;
      }

      if (wamid && nosso) await this.aplicarStatus(wamid, nosso, {}, tarifa);
      // Status que não muda o nosso estado ainda pode trazer a tarifa.
      else if (wamid && tarifa) await this.guardarTarifaAvulsa(wamid, tarifa);
    }
  }

  /**
   * Quem pediu para sair entra na lista de bloqueio da conta, na hora.
   *
   * É o outro lado do botão "Parar promoções" que todo modelo de marketing
   * leva: o toque volta como mensagem, e é AQUI que ele vira efeito. Sem isto o
   * botão seria enfeite — a pessoa pediria para sair, continuaria recebendo e
   * bloquearia o número da empresa, que é o que derruba a qualidade.
   *
   * Vale também para quem escreve "sair", "parar" ou "stop": exigir o botão de
   * quem respondeu por escrito seria fingir que não entendemos o pedido.
   *
   * O contato pode não existir na base (a campanha aceita número digitado):
   * então a linha é criada já bloqueada, para uma importação futura não
   * ressuscitar o envio para quem pediu para sair.
   *
   * Celular brasileiro antigo chega no `from` com 12 dígitos (sem o 9º), e a
   * base pode ter a pessoa em qualquer das duas formas. O bloqueio vale para as
   * DUAS: bloquear só a que veio deixava a outra recebendo campanha.
   */
  private async pedidosDeSaida(m: Mudanca): Promise<void> {
    const v = m.value ?? {};
    const mensagens = Array.isArray(v.messages) ? v.messages : [];
    if (!mensagens.length) return;

    const phoneNumberId = this.phoneNumberIdDe(m);
    if (!phoneNumberId) return;

    for (const msg of mensagens as Array<Record<string, unknown>>) {
      const de = typeof msg.from === 'string' ? msg.from.replace(/\D/g, '') : '';
      if (!de) continue;

      const botao = msg.button as { text?: unknown; payload?: unknown } | undefined;
      const interativo = msg.interactive as { button_reply?: { title?: unknown } } | undefined;
      const texto = msg.text as { body?: unknown } | undefined;

      const dito =
        (typeof botao?.text === 'string' && botao.text) ||
        (typeof botao?.payload === 'string' && botao.payload) ||
        (typeof interativo?.button_reply?.title === 'string' && interativo.button_reply.title) ||
        (typeof texto?.body === 'string' && texto.body) ||
        '';

      if (!ehPedidoDeSaida(dito)) continue;

      const origem = msg.button || msg.interactive ? 'botao_modelo' : 'mensagem';
      await this.bloquearContato(phoneNumberId, de, origem);
    }
  }

  /**
   * A pessoa respondeu à mensagem da campanha.
   *
   * Resposta a uma mensagem nossa chega com `context.id` = o `wamid` dela — é
   * o mesmo id guardado no destinatário. Vale para qualquer número (não
   * depende das conversas ligadas) e só o FATO é gravado (`respondida_em`); o
   * texto não. O botão "Parar promoções" (e "sair", "parar"…) não conta: é
   * pedido de saída, não engajamento.
   *
   * O aviso chega pelo número, sem conta: o `update` é pelo `wamid`, que é
   * único (motivo A de `docs/rls.md`).
   */
  private async respostasDeCampanha(m: Mudanca): Promise<void> {
    const v = m.value ?? {};
    const mensagens = Array.isArray(v.messages) ? (v.messages as Array<Record<string, unknown>>) : [];
    const respondidas = new Set<string>();
    for (const msg of mensagens) {
      const contexto = msg.context as { id?: unknown } | undefined;
      const wamid = typeof contexto?.id === 'string' ? contexto.id : '';
      if (!wamid) continue;
      const botao = msg.button as { text?: unknown; payload?: unknown } | undefined;
      const interativo = msg.interactive as { button_reply?: { title?: unknown } } | undefined;
      const texto = msg.text as { body?: unknown } | undefined;
      const dito =
        (typeof botao?.text === 'string' && botao.text) ||
        (typeof botao?.payload === 'string' && botao.payload) ||
        (typeof interativo?.button_reply?.title === 'string' && interativo.button_reply.title) ||
        (typeof texto?.body === 'string' && texto.body) ||
        '';
      if (ehPedidoDeSaida(dito)) continue;
      respondidas.add(wamid);
    }
    if (!respondidas.size) return;

    await this.ctx.comEscopoSistema('meta.webhook.resposta', (db) =>
      db
        .update(campanhaDestinatario)
        .set({ respondidaEm: sql`coalesce(${campanhaDestinatario.respondidaEm}, now())` })
        .where(inArray(campanhaDestinatario.waMessageId, [...respondidas])),
    );
  }

  /**
   * A pessoa parou ou voltou a aceitar marketing da empresa pelo próprio
   * WhatsApp (`user_preferences`, formato em `preferencias.regras.ts`).
   *
   * Parar = sai dos envios, como o "Parar promoções": bloqueio com a origem
   * `preferencia_whatsapp`. Voltar = desfaz SÓ o bloqueio que veio daqui —
   * quem também pediu para sair pelo botão ou por mensagem continua de fora
   * (o pedido direto à empresa vale mais; o dono reativa em Bloqueios).
   */
  private async preferenciasDeMarketing(m: Mudanca): Promise<void> {
    const phoneNumberId = this.phoneNumberIdDe(m);
    if (!phoneNumberId) return;
    for (const p of preferenciasDoAviso(m.value ?? {})) {
      if (p.acao === 'parar') await this.bloquearContato(phoneNumberId, p.telefone, ORIGEM_PREFERENCIA);
      else await this.liberarPreferencia(phoneNumberId, p.telefone);
    }
  }

  /**
   * Voltou a aceitar marketing pelo WhatsApp: tira o bloqueio que a própria
   * preferência tinha posto. Só de quem tem autorização registrada na base —
   * a linha criada só para guardar o bloqueio (número que não estava na base)
   * não vira contato que recebe campanha.
   */
  private async liberarPreferencia(phoneNumberId: string, telefone: string): Promise<void> {
    const contaId = await this.contaDoNumero(phoneNumberId);
    if (!contaId) return;

    const pessoa = doWhatsapp(telefone);
    const formas = [...new Set([telefone, pessoa, gemeoDoCelular(pessoa)].filter((f): f is string => Boolean(f)))];
    const lista = sql.join(
      formas.map((f) => sql`${f}::text`),
      sql`, `,
    );

    const liberados = await this.ctx.comEscopoSistema('meta.webhook.preferencia.liberar', async (db) => {
      const r = await db.execute(sql`
        update contato
           set opt_out = false,
               opt_out_em = null,
               opt_out_origem = null
         where conta_id = ${contaId}
           and telefone_e164 in (${lista})
           and opt_out = true
           and opt_out_origem = ${ORIGEM_PREFERENCIA}
           and consentimento_origem is not null
        returning id
      `);
      return r.rows.length;
    });
    if (!liberados) return;

    this.log.log(`Contato ${this.mascarar(pessoa)} voltou a aceitar marketing pelo WhatsApp.`);
    await this.auditoria.registrarForaDeContexto({
      contaId,
      atorTipo: 'sistema',
      acao: 'contato.opt_in',
      entidade: 'contato',
      detalhe: { origem: ORIGEM_PREFERENCIA, telefone: this.mascarar(pessoa) },
    });
  }

  private async bloquearContato(phoneNumberId: string, telefone: string, origem: string): Promise<void> {
    const contaId = await this.contaDoNumero(phoneNumberId);
    if (!contaId) {
      this.log.warn(`Pedido de saída de um número que não é de nenhuma conta (${this.mascarar(phoneNumberId)}).`);
      return;
    }
    await this.bloquearNaConta(contaId, telefone, origem);
  }

  /** A conta dona do número: o aviso chega pelo número, sem conta (motivo A de `docs/rls.md`). */
  private async contaDoNumero(phoneNumberId: string): Promise<string | null> {
    return this.ctx.comEscopoSistema('meta.webhook.saida.conta', async (db) => {
      const [linha] = await db
        .select({ contaId: waNumero.contaId })
        .from(waNumero)
        .where(eq(waNumero.phoneNumberId, phoneNumberId))
        .limit(1);
      return linha?.contaId ?? null;
    });
  }

  /** Bloqueia a pessoa na conta, nas duas formas do celular; tira da fila o que ainda não saiu; audita. */
  private async bloquearNaConta(contaId: string, telefone: string, origem: string): Promise<void> {
    // A pessoa no formato da base (com o 9) e a outra forma do mesmo celular.
    const pessoa = doWhatsapp(telefone);
    const gemeo = gemeoDoCelular(pessoa);
    const formas = [...new Set([telefone, pessoa, gemeo].filter((f): f is string => Boolean(f)))];
    const lista = sql.join(
      formas.map((f) => sql`${f}::text`),
      sql`, `,
    );

    const bloqueou = await this.ctx.comEscopoSistema('meta.webhook.saida.bloquear', async (db) => {
      // Bloqueia a pessoa em qualquer forma que já esteja na base; só se não
      // estiver em nenhuma, cria a linha — na forma com o 9, a da base.
      const r = await db.execute(sql`
        with bloqueados as (
          update contato
             set opt_out = true,
                 opt_out_em = coalesce(opt_out_em, now()),
                 opt_out_origem = coalesce(opt_out_origem, ${origem})
           where conta_id = ${contaId}
             and telefone_e164 in (${lista})
             and opt_out = false
          returning id
        ),
        criados as (
          insert into contato (conta_id, telefone_e164, opt_out, opt_out_em, opt_out_origem)
          select ${contaId}, ${pessoa}, true, now(), ${origem}
           where not exists (
             select 1 from contato where conta_id = ${contaId} and telefone_e164 in (${lista})
           )
          on conflict (conta_id, telefone_e164) do nothing
          returning id
        )
        select (select count(*) from bloqueados) + (select count(*) from criados) as total
      `);

      // O que ainda não saiu não sai mais: a campanha em fila para essa pessoa
      // vira "descadastrado", com o motivo na tela.
      await db.execute(sql`
        update campanha_destinatario
           set status = 'falhou',
               erro_titulo = 'Pediu para sair',
               erro_detalhe = 'Esta pessoa pediu para não receber mais mensagens da sua empresa. Nada foi enviado.',
               falhou_em = now()
         where conta_id = ${contaId} and telefone_e164 in (${lista}) and status = 'pendente'
      `);

      return Number((r.rows[0] as { total?: unknown } | undefined)?.total ?? 0) > 0;
    });

    if (!bloqueou) return;

    this.log.log(`Contato ${this.mascarar(pessoa)} entrou na lista de bloqueio da conta (${origem}).`);
    await this.auditoria.registrarForaDeContexto({
      contaId,
      atorTipo: 'sistema',
      acao: 'contato.opt_out',
      entidade: 'contato',
      detalhe: { origem, telefone: this.mascarar(pessoa) },
    });
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
    erro: { erroCodigo?: number | null; erroTitulo?: string; erroDetalhe?: string; erroMeta?: string | null },
    tarifa: TarifaDaMensagem | null = null,
  ): Promise<string[]> {
    const agora = new Date();
    const carimbo: Record<string, Date> = {
      enviada: agora,
      entregue: agora,
      lida: agora,
      falhou: agora,
    };

    const alterados = await this.ctx.comEscopoSistema('meta.webhook.status', async (db) => {
      const mudados = await db
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
                erroMeta: erro.erroMeta ?? null,
              }
            : {}),
          // A tarifa vai no mesmo `update` do status: uma escrita por aviso na
          // tabela mais quente do sistema, não duas.
          ...(tarifa ? this.tarifaSeAindaNaoTem(tarifa) : {}),
        })
        .where(
          and(
            eq(campanhaDestinatario.waMessageId, wamid),
            inArray(campanhaDestinatario.status, ANTERIORES_VALIDOS[novo]),
          ),
        )
        .returning({
          contaId: campanhaDestinatario.contaId,
          telefone: campanhaDestinatario.telefoneE164,
          campanhaId: campanhaDestinatario.campanhaId,
        });

      // O status não andou (aviso repetido, ou fora de ordem: o `sent` chegou
      // depois do `read`), mas a tarifa que ele traz ainda vale.
      if (tarifa && !mudados.length) await this.guardarTarifa(db, wamid, tarifa);

      // Número sem WhatsApp (131026) em duas campanhas: sai sozinho dos
      // próximos envios. O `update` acima já achou a conta do destinatário.
      if (novo === 'falhou' && erro.erroCodigo === ERRO_SEM_WHATSAPP) {
        for (const a of mudados) await registrarFalhaSemWhatsapp(db, a.contaId, a.telefone);
      }
      return mudados;
    });

    // Parou o marketing pelo WhatsApp (131050): a Meta não entrega mais marketing
    // a esta pessoa e manda não reenviar — ela sai dos envios, como pelo aviso
    // `user_preferences` (que pode não estar assinado, ou ter chegado antes).
    if (novo === 'falhou' && erro.erroCodigo === ERRO_MARKETING_PARADO) {
      for (const a of alterados) await this.bloquearNaConta(a.contaId, a.telefone, ORIGEM_PREFERENCIA);
    }
    return [...new Set(alterados.map((a) => a.campanhaId))];
  }

  /**
   * Pausa a campanha quando a recusa que chegou pelo aviso é do MODELO ou da
   * CONTA (pagamento não configurado, conta restrita, credencial), e não de
   * quem recebe.
   *
   * A Meta aceita a mensagem no envio e só recusa depois, no aviso de entrega —
   * foi assim que o 131042 (pagamento) apareceu em 01/10/2026. Sem isto a
   * campanha seguiria mandando: cada mensagem seria aceita e recusada em
   * seguida, e a fila inteira viraria falha, uma pessoa por vez. Quem já tinha
   * sido aceito e recusado fica como falha, com o motivo; quem estava na fila
   * continua nela, e sai quando a campanha for retomada.
   *
   * Só pausa campanha que ainda está saindo: a que terminou não muda.
   */
  private async pausarPorErro(campanhaIds: string[], erro: ErroMetaTraduzido, daMeta: string): Promise<void> {
    const motivo = pausaPorErro(erro);
    if (!motivo || !campanhaIds.length) return;

    const pausadas = await this.ctx.comEscopoSistema('meta.webhook.pausar', (db) =>
      db
        .update(campanha)
        .set({ status: 'pausada', pausaMotivo: motivo, pausaErroCodigo: erro.codigo, pausaErroMeta: daMeta || null })
        .where(and(inArray(campanha.id, campanhaIds), inArray(campanha.status, ['agendada', 'enviando'])))
        .returning({ id: campanha.id, contaId: campanha.contaId, nome: campanha.nome }),
    );

    for (const c of pausadas) {
      this.log.warn(`Campanha ${c.id} pausada (${motivo}): a Meta recusou depois de aceitar (erro ${erro.codigo}: ${erro.titulo}).`);
      void this.avisos.avisar(c.contaId, 'campanhas', {
        titulo: `Campanha pausada: ${c.nome}`,
        corpo: `${erro.titulo}. ${erro.acao}`,
        dados: { campanhaId: c.id },
      });
    }
  }

  /**
   * Os dois campos da tarifa, para o `set` de um `update`. Vale a primeira que
   * chegar: o `pricing` vem em dois avisos da mesma mensagem, e o segundo (ou
   * um reenvio) não reescreve o que já está guardado.
   */
  private tarifaSeAindaNaoTem(tarifa: TarifaDaMensagem) {
    return {
      tarifaTipo: sql`coalesce(${campanhaDestinatario.tarifaTipo}, ${tarifa.tipo})`,
      tarifaCategoria: sql`coalesce(${campanhaDestinatario.tarifaCategoria}, ${tarifa.categoria})`,
    };
  }

  /** Guarda a tarifa sem mexer no status. Só em quem ainda não tem: não vira escrita à toa. */
  private async guardarTarifa(db: Db, wamid: string, tarifa: TarifaDaMensagem): Promise<void> {
    await db
      .update(campanhaDestinatario)
      .set({ tarifaTipo: tarifa.tipo, tarifaCategoria: tarifa.categoria })
      .where(and(eq(campanhaDestinatario.waMessageId, wamid), isNull(campanhaDestinatario.tarifaTipo)));
  }

  /**
   * A tarifa de um aviso cujo status não muda o nosso estado. O aviso chega
   * pelo `wamid`, sem conta (motivo A de `docs/rls.md`, como o status).
   */
  private async guardarTarifaAvulsa(wamid: string, tarifa: TarifaDaMensagem): Promise<void> {
    await this.ctx.comEscopoSistema('meta.webhook.status', (db) => this.guardarTarifa(db, wamid, tarifa));
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

    // O 2593109 e o `progress` vêm DENTRO de `history[]` (ver
    // `coexistencia.regras.ts`). Procurá-los em `value` nunca achava nada.
    if (historicoRecusado(v)) {
      await this.marcarSincronizacao(phoneNumberId, 'falhou', 'O cliente não autorizou compartilhar os dados do app.');
      this.log.warn(
        `Sincronização recusada pelo cliente no número ${this.mascarar(phoneNumberId)} (2593109).`,
      );
      return;
    }

    // Os lotes chegam em fases e fora de ordem; `progress` 100 é o fim. Sem
    // ele, o seguro é continuar "sincronizando".
    if (sincronizacaoConcluida(v)) {
      await this.marcarSincronizacao(phoneNumberId, 'concluida', null);
      this.log.log(`Sincronização (${tipo}) concluída no número ${this.mascarar(phoneNumberId)}.`);
    } else {
      this.log.debug(`Sincronização (${tipo}) em andamento no número ${this.mascarar(phoneNumberId)}.`);
    }
  }

  /**
   * A agenda do celular: contatos salvos, editados ou apagados no app.
   *
   * O que fazer com eles é a resposta do dono (ver `AgendaService`): sem
   * resposta, o lote fica guardado; com "não", é esvaziado; com "sim", vira
   * contato e o conteúdo sai daqui.
   */
  private async agendaDoApp(m: Mudanca): Promise<DestinoDoEvento | void> {
    const phoneNumberId = this.phoneNumberIdDe(m);
    const itens = m.value?.state_sync;
    if (!phoneNumberId || !Array.isArray(itens) || itens.length === 0) return;
    return this.agenda.aplicarLote(phoneNumberId, itens);
  }

  /** O histórico de conversas: vira conversa, conforme a resposta do dono (`ConversasService`). */
  private async historicoDoApp(m: Mudanca): Promise<DestinoDoEvento | void> {
    const phoneNumberId = this.phoneNumberIdDe(m);
    if (!phoneNumberId) return;
    return this.conversas.historico(phoneNumberId, m.value ?? {});
  }

  /**
   * Eco de mensagem: o lojista respondeu alguém pelo aplicativo do celular.
   *
   * Entra na conversa como resposta (e zera as não lidas dela). NÃO abre a
   * janela de 24 horas: quem abre é a mensagem do cliente, e é dela que
   * `conversa.ultima_entrada_em` conta.
   */
  private async ecoDeMensagem(m: Mudanca): Promise<DestinoDoEvento | void> {
    const phoneNumberId = this.phoneNumberIdDe(m);
    if (!phoneNumberId) return;
    return this.conversas.ecos(phoneNumberId, m.value ?? {});
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

  /**
   * A Meta mudou algo na conta: restringiu, apontou violação, desativou,
   * reativou, decidiu a revisão — ou o cliente tirou o acesso do aplicativo.
   *
   * O aviso diz QUE mudou; o que isso faz com o envio quem diz é o
   * `health_status`. Por isso o tratamento é reler a saúde da conta na hora: a
   * tela passa a mostrar o motivo e a saída, e o aviso no celular sai se o
   * envio ficou bloqueado. Até 01/10/2026 este aviso só ia para o log.
   *
   * De passagem, guarda o negócio dono da conta quando o aviso o traz — é com
   * ele que se monta o endereço do pagamento na Meta.
   */
  private async contaAtualizada(m: Mudanca): Promise<void> {
    const v = m.value ?? {};
    const evento = String(v.event ?? v.decision ?? '').toUpperCase();
    this.log.log(`Conta atualizada pela Meta (${evento || 'sem evento'}): ${JSON.stringify(v).slice(0, 300)}`);

    const info = (v.waba_info ?? {}) as { waba_id?: unknown; owner_business_id?: unknown };
    const wabaId = m.entrada ?? (typeof info.waba_id === 'string' ? info.waba_id : '');
    if (!wabaId) return;

    const dono = typeof info.owner_business_id === 'string' && /^\d{5,30}$/.test(info.owner_business_id) ? info.owner_business_id : null;
    if (dono) {
      await this.ctx.comEscopoSistema('meta.webhook.conta', (db) =>
        db
          .update(waConta)
          .set({ businessId: dono })
          .where(and(eq(waConta.wabaId, wabaId), isNull(waConta.businessId))),
      );
    }

    if (SO_INFORMATIVOS.has(evento)) return;
    await this.saude.atualizarDoSistema({ wabaId });
  }

  // ------------------------------------------------------------------ apoio

  private extrairMudancas(corpo: unknown): Mudanca[] {
    if (!corpo || typeof corpo !== 'object') return [];
    const o = corpo as Record<string, unknown>;
    const entradas = Array.isArray(o.entry) ? o.entry : [];
    const saida: Mudanca[] = [];
    for (const e of entradas as Array<Record<string, unknown>>) {
      const mudancas = Array.isArray(e.changes) ? e.changes : [];
      const entrada = typeof e.id === 'string' && e.id ? e.id : undefined;
      const quando = typeof e.time === 'number' && Number.isFinite(e.time) && e.time > 0 ? e.time : undefined;
      for (const c of mudancas as Mudanca[]) {
        saida.push({ ...c, ...(entrada ? { entrada } : {}), ...(quando ? { quando } : {}) });
      }
    }
    return saida;
  }

  /**
   * Chave de idempotência.
   *
   * Usa o id da mensagem quando existe — é o identificador estável que a Meta
   * repete no reenvio. Sem ele, o hash do conteúdo MAIS o momento do aviso
   * (`quando`, o `entry.time`): o reenvio repete os dois e é descartado; o
   * mesmo conteúdo em outro momento é outro evento, e é tratado.
   *
   * Até 02/10/2026 o momento não entrava: o segundo "modelo pausado", a
   * segunda queda de qualidade ou a segunda restrição da conta — iguais à
   * primeira, semanas depois — eram descartados como reenvio, para sempre.
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
