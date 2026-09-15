/**
 * Cliente da Graph API da Meta.
 *
 * Três decisões que vêm de defeito observado no Regem:
 *
 * 1. **Timeout em toda chamada.** Lá o `fetch` é cru, sem `AbortSignal`. O
 *    `fetch` do Node não tem timeout de requisição por padrão — só um
 *    `headersTimeout` de ~300s. Como o worker de disparo é serializado por um
 *    booleano em memória, uma conexão pendurada com a Meta congela o envio de
 *    TODOS os clientes por minutos.
 *
 * 2. **O erro chega inteiro.** Lá o `catch(() => null)` descarta o objeto de
 *    erro, e a mensagem final vira "Falha ao enviar (sem resposta): " — vazia
 *    depois dos dois-pontos. Aqui todo erro carrega código numérico, mensagem
 *    da Meta e o `X-FB-Trace-Id`, que é o que o suporte da Meta pede quando
 *    você abre chamado.
 *
 * 3. **Retry decidido pelo código numérico**, não por "deu erro". Retentar um
 *    erro permanente queima destinatário e cobra de novo; não retentar um
 *    transitório perde entrega por um soluço. Quem decide é o catálogo em
 *    `erros-meta.ts`.
 */
import { Injectable, Logger } from '@nestjs/common';

import { env } from '../../config/env';
import {
  ClasseErroMeta,
  ErroMetaTraduzido,
  codigoDoErro,
  deveRetentar,
  mensagemDoErroMeta,
  traduzirErroMeta,
} from './erros-meta';

/** Erro de uma chamada à Graph, com tudo que serve para diagnosticar. */
export class ErroGraph extends Error {
  readonly status: number;
  readonly codigo: number | null;
  readonly traduzido: ErroMetaTraduzido;
  readonly traceId?: string;
  /** Corpo cru, só para o log. Nunca vai para o cliente. */
  readonly corpo?: unknown;

  constructor(dados: {
    status: number;
    codigo: number | null;
    traduzido: ErroMetaTraduzido;
    traceId?: string;
    corpo?: unknown;
  }) {
    super(`${dados.traduzido.titulo} (código ${dados.codigo ?? 'sem código'})`);
    this.name = 'ErroGraph';
    this.status = dados.status;
    this.codigo = dados.codigo;
    this.traduzido = dados.traduzido;
    this.traceId = dados.traceId;
    this.corpo = dados.corpo;
  }

  get classe(): ClasseErroMeta {
    return this.traduzido.classe;
  }

  get retentavel(): boolean {
    return deveRetentar(this.traduzido);
  }

  /** O que o usuário lê. */
  get mensagemParaUsuario(): string {
    return this.traduzido.explicacao;
  }

  /** O que vai para o log: tudo. */
  get detalheParaLog(): string {
    const p = [
      `http ${this.status}`,
      `código ${this.codigo ?? '—'}`,
      `classe ${this.classe}`,
      this.traceId ? `trace ${this.traceId}` : '',
      mensagemDoErroMeta(this.corpo) || '',
    ].filter(Boolean);
    return p.join(' · ');
  }
}

interface OpcoesChamada {
  metodo?: 'GET' | 'POST' | 'DELETE';
  corpo?: unknown;
  /** Token do cliente. Sem ele, a chamada usa o app access token. */
  token?: string;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
  /** Quantas vezes retentar erro transitório. O total de tentativas é 1 + este número. */
  tentativas?: number;
}

const TIMEOUT_PADRAO_MS = 15_000;
const TENTATIVAS_PADRAO = 2;

@Injectable()
export class GraphService {
  private readonly log = new Logger('Graph');

  private get base(): string {
    return `https://graph.facebook.com/${env.meta.graphVersao}`;
  }

  /**
   * Token do próprio app (`app_id|app_secret`).
   *
   * A Meta aceita esse formato direto no lugar de um token obtido por
   * `client_credentials`, o que evita guardar e renovar mais um segredo. Serve
   * para o que é do app — trocar o `code` do Embedded Signup, por exemplo —, e
   * nunca para agir em nome de cliente: para isso existe o token dele.
   */
  private get tokenDoApp(): string {
    return `${env.meta.appId}|${env.meta.appSecret}`;
  }

  async chamar<T>(caminho: string, opcoes: OpcoesChamada = {}): Promise<T> {
    const {
      metodo = 'GET',
      corpo,
      token,
      query,
      timeoutMs = TIMEOUT_PADRAO_MS,
      tentativas = TENTATIVAS_PADRAO,
    } = opcoes;

    const url = new URL(`${this.base}/${caminho.replace(/^\/+/, '')}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    let ultimoErro: ErroGraph | undefined;

    for (let tentativa = 0; tentativa <= tentativas; tentativa++) {
      if (tentativa > 0) {
        // Recuo exponencial com piso: 1s, 2s, 4s… O `esperaSegundos` do
        // catálogo manda quando for maior (o 131049 pede 24h, e aí não é caso
        // de esperar dentro do request — quem trata é a fila).
        const espera = Math.min(1000 * 2 ** (tentativa - 1), 8000);
        await new Promise((r) => setTimeout(r, espera));
      }

      try {
        return await this.umaChamada<T>(url, metodo, corpo, token ?? this.tokenDoApp, timeoutMs);
      } catch (erro) {
        if (!(erro instanceof ErroGraph)) throw erro;
        ultimoErro = erro;

        // Só transitório volta. `limite` também é retentável, mas com espera
        // longa — isso é trabalho da fila, não deste laço.
        if (erro.classe !== 'transitorio' || tentativa === tentativas) break;

        this.log.warn(
          `Retentando ${metodo} ${caminho} (tentativa ${tentativa + 1}/${tentativas}): ${erro.detalheParaLog}`,
        );
      }
    }

    throw ultimoErro!;
  }

  private async umaChamada<T>(
    url: URL,
    metodo: string,
    corpo: unknown,
    token: string,
    timeoutMs: number,
  ): Promise<T> {
    let resposta: Response;
    try {
      resposta = await fetch(url, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (erro) {
      // Rede, DNS, TLS, timeout. NÃO engolimos a causa: o `.catch(() => null)`
      // do Regem é exatamente o que torna esse caso impossível de diagnosticar.
      const e = erro as Error;
      const eTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      throw new ErroGraph({
        status: 0,
        codigo: eTimeout ? 131016 : null,
        traduzido: eTimeout
          ? traduzirErroMeta(131016)
          : {
              codigo: 0,
              classe: 'transitorio',
              titulo: 'Não conseguimos falar com a Meta',
              explicacao:
                'A conexão com a Meta falhou. Vamos tentar de novo automaticamente.',
              esperaSegundos: 60,
            },
        corpo: { error: { message: `${e?.name ?? 'Erro'}: ${e?.message ?? String(erro)}` } },
      });
    }

    const traceId = resposta.headers.get('x-fb-trace-id') ?? undefined;
    const texto = await resposta.text().catch(() => '');
    let dados: unknown = null;
    if (texto) {
      try {
        dados = JSON.parse(texto);
      } catch {
        dados = { error: { message: texto.slice(0, 500) } };
      }
    }

    if (!resposta.ok) {
      const codigo = codigoDoErro(dados);
      throw new ErroGraph({
        status: resposta.status,
        codigo,
        traduzido: traduzirErroMeta(codigo, mensagemDoErroMeta(dados)),
        traceId,
        corpo: dados,
      });
    }

    return (dados ?? {}) as T;
  }

  /**
   * Troca o `code` do Embedded Signup pelo token de acesso do cliente.
   *
   * O `code` vive **30 segundos**. Por isso ele não pode passear pelo front nem
   * esperar em fila: chega do navegador e é trocado aqui, no mesmo request.
   */
  async trocarCodePorToken(code: string): Promise<{ token: string; expiraEm: number | null }> {
    const r = await this.chamar<{ access_token: string; expires_in?: number }>(
      'oauth/access_token',
      {
        query: {
          client_id: env.meta.appId,
          client_secret: env.meta.appSecret,
          code,
        },
        // Uma tentativa só: o code expira em 30s, e retentar com um code já
        // consumido devolve erro diferente e mais confuso que o original.
        tentativas: 0,
      },
    );
    return { token: r.access_token, expiraEm: r.expires_in ?? null };
  }

  /** Assina nosso app na WABA do cliente. Sem isso, nenhum webhook daquela conta chega. */
  async assinarWebhook(wabaId: string, tokenDoCliente: string): Promise<void> {
    await this.chamar(`${wabaId}/subscribed_apps`, {
      metodo: 'POST',
      token: tokenDoCliente,
    });
  }

  /**
   * Registra o número na Cloud API. Sem isso, todo envio falha com 133010 — e
   * a mensagem crua da Meta não diz que falta registrar.
   */
  async registrarNumero(phoneNumberId: string, pin: string, tokenDoCliente: string): Promise<void> {
    await this.chamar(`${phoneNumberId}/register`, {
      metodo: 'POST',
      token: tokenDoCliente,
      corpo: { messaging_product: 'whatsapp', pin },
    });
  }

  /** Dados da WABA: nome, moeda e status de revisão. */
  async dadosDaWaba(
    wabaId: string,
    tokenDoCliente: string,
  ): Promise<{
    id: string;
    name?: string;
    currency?: string;
    account_review_status?: string;
  }> {
    return this.chamar(wabaId, {
      token: tokenDoCliente,
      query: { fields: 'id,name,currency,account_review_status' },
    });
  }

  /** Números da WABA, com qualidade e tier. */
  async numerosDaWaba(
    wabaId: string,
    tokenDoCliente: string,
  ): Promise<{
    data: Array<{
      id: string;
      display_phone_number?: string;
      verified_name?: string;
      quality_rating?: string;
      messaging_limit_tier?: string;
    }>;
  }> {
    return this.chamar(`${wabaId}/phone_numbers`, {
      token: tokenDoCliente,
      query: {
        fields: 'id,display_phone_number,verified_name,quality_rating,messaging_limit_tier',
      },
    });
  }

  /**
   * Pede à Meta a sincronização dos dados do app do celular (coexistência).
   *
   * Os dados NÃO voltam nesta resposta: ela só enfileira o pedido, e o
   * conteúdo chega depois pelos webhooks `smb_app_state_sync` (contatos) e
   * `history` (mensagens). Confundir o 200 daqui com "sincronizado" é o
   * mesmo erro de achar que "a Meta aceitou" significa "a mensagem chegou".
   *
   * O prazo é de 24 horas a partir do fim do onboarding; estourado, a Meta
   * desfaz a conexão e o cliente refaz o fluxo inteiro.
   */
  async sincronizarDadosDoApp(
    phoneNumberId: string,
    tipo: 'smb_app_state_sync' | 'history',
    tokenDoCliente: string,
  ): Promise<void> {
    await this.chamar(`${phoneNumberId}/smb_app_data`, {
      metodo: 'POST',
      token: tokenDoCliente,
      corpo: { messaging_product: 'whatsapp', sync_type: tipo },
    });
  }

}
