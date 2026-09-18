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

/**
 * Modelo como a Meta devolve — cru, sem tradução.
 *
 * Fica `unknown` nas partes que variam (botões, cartões de carrossel) porque a
 * Meta muda a forma delas com frequência e tipar errado é pior que não tipar:
 * o TypeScript passa a garantir uma mentira.
 */
export interface ModeloBruto {
  id: string;
  name: string;
  language?: string;
  status?: string;
  category?: string;
  rejected_reason?: string;
  components?: Array<{
    type?: string;
    format?: string;
    text?: string;
    buttons?: unknown[];
    [k: string]: unknown;
  }>;
}

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
   * Envia uma mensagem de modelo e devolve o `wamid`.
   *
   * O `wamid` é o que importa aqui — não o 200. Ele é a única chave que liga
   * esta mensagem aos webhooks de entrega que chegam depois. Descartá-lo é
   * exatamente o que faz uma campanha marcar "enviada" e nunca descobrir que
   * todas falharam.
   *
   * `tentativas: 0` de propósito. Retentar envio no mesmo request duplica
   * mensagem quando o primeiro POST chegou e só a resposta se perdeu — e
   * mensagem duplicada queima o destinatário e cobra duas vezes. Retentativa é
   * trabalho de quem tem estado (a fila), não deste método.
   */
  async enviarModelo(
    phoneNumberId: string,
    dados: {
      para: string;
      modelo: string;
      idioma: string;
      variaveis: string[];
    },
    tokenDoCliente: string,
  ): Promise<string> {
    const corpo: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: dados.para,
      type: 'template',
      template: {
        name: dados.modelo,
        language: { code: dados.idioma },
        // Componente de corpo só entra quando há variável: mandar `parameters`
        // vazio num modelo sem variável faz a Meta recusar com 132000.
        ...(dados.variaveis.length > 0
          ? {
              components: [
                {
                  type: 'body',
                  parameters: dados.variaveis.map((v) => ({ type: 'text', text: v })),
                },
              ],
            }
          : {}),
      },
    };

    const r = await this.chamar<{ messages?: Array<{ id?: string }> }>(
      `${phoneNumberId}/messages`,
      { metodo: 'POST', token: tokenDoCliente, corpo, tentativas: 0 },
    );

    const wamid = r.messages?.[0]?.id;
    if (!wamid) {
      // A Meta respondeu 200 sem identificador. Não dá para reconciliar depois,
      // então é melhor tratar como falha agora do que gravar "enviada" numa
      // mensagem que nunca terá status.
      throw new ErroGraph({
        status: 200,
        codigo: null,
        traduzido: {
          codigo: 0,
          classe: 'transitorio',
          titulo: 'A Meta aceitou sem devolver o identificador',
          explicacao:
            'A Meta respondeu sem o identificador da mensagem, então não temos como acompanhar a entrega. Vamos tentar de novo.',
          esperaSegundos: 30,
        },
        corpo: r,
      });
    }
    return wamid;
  }

  /**
   * Modelos de mensagem da WABA.
   *
   * `limit` alto de propósito: a paginação da Graph é por cursor, e uma conta
   * madura passa fácil dos 25 padrão. Buscar de 25 em 25 numa tela que só lista
   * transformaria um request em cinco — e a Meta cobra rate limit por app, não
   * por cliente.
   */
  async modelosDaWaba(
    wabaId: string,
    tokenDoCliente: string,
    limite = 200,
  ): Promise<{ data: ModeloBruto[] }> {
    return this.chamar(`${wabaId}/message_templates`, {
      token: tokenDoCliente,
      query: {
        fields: 'id,name,language,status,category,components,rejected_reason',
        limit: limite,
      },
    });
  }

  /**
   * Cria um modelo de mensagem na WABA do cliente.
   *
   * A resposta traz `id`, `status` e, quando a Meta reclassifica, `category` —
   * ela move para MARKETING o que considera marketing disfarçado de utilidade,
   * e o preço da mensagem muda junto. Guardar as duas categorias separadas é o
   * que permite explicar a cobrança depois.
   *
   * **Sem tentativa automática.** Criar modelo não é idempotente: a Meta recusa
   * nome repetido, então reenviar depois de um timeout devolve "esse nome já
   * existe" — um erro que parece defeito nosso quando, na verdade, o primeiro
   * envio funcionou. Quem decide repetir é o cliente, vendo a lista.
   */
  async criarModelo(
    wabaId: string,
    tokenDoCliente: string,
    corpo: Record<string, unknown>,
  ): Promise<{ id: string; status?: string; category?: string }> {
    return this.chamar(`${wabaId}/message_templates`, {
      metodo: 'POST',
      token: tokenDoCliente,
      corpo,
      tentativas: 0,
    });
  }

  /**
   * Edita um modelo que já está na Meta.
   *
   * Só componentes: a CATEGORIA de um modelo aprovado não pode mudar (a Meta
   * recusa), e mandar o campo de qualquer jeito transforma uma edição simples
   * numa recusa sem explicação. Categoria diferente é modelo novo.
   *
   * Sem retentativa automática: editar não é idempotente do ponto de vista do
   * limite (a Meta conta 1 edição por 24 horas em modelo aprovado), e repetir
   * às cegas queimaria a cota do cliente.
   */
  async editarModelo(
    templateId: string,
    tokenDoCliente: string,
    componentes: Record<string, unknown>[],
  ): Promise<{ success?: boolean }> {
    return this.chamar(templateId, {
      metodo: 'POST',
      token: tokenDoCliente,
      corpo: { components: componentes },
      tentativas: 0,
    });
  }

  /** O modelo como a Meta o vê agora. Usado depois de editar, para saber o status real. */
  async lerModelo(
    templateId: string,
    tokenDoCliente: string,
  ): Promise<{ id: string; status?: string; category?: string }> {
    return this.chamar(templateId, {
      token: tokenDoCliente,
      query: { fields: 'id,status,category' },
    });
  }

  /** Apaga o modelo na Meta. O nome só volta a ficar livre depois disto. */
  async excluirModelo(
    wabaId: string,
    tokenDoCliente: string,
    nome: string,
    templateId?: string | null,
  ): Promise<void> {
    await this.chamar(`${wabaId}/message_templates`, {
      metodo: 'DELETE',
      token: tokenDoCliente,
      // Com `hsm_id` a Meta apaga só ESTE idioma; só com `name` ela apaga todos
      // os idiomas daquele modelo. Mandamos o id quando temos — apagar o
      // espanhol junto com o português seria uma surpresa cara.
      query: templateId ? { name: nome, hsm_id: templateId } : { name: nome },
      tentativas: 0,
    });
  }

  /**
   * Envia um arquivo à Meta e devolve o `header_handle` do modelo.
   *
   * A Meta NÃO busca a URL da mídia de um modelo: ela recebe os bytes, por um
   * protocolo de upload em DOIS passos (Resumable Upload API):
   *
   * 1. `POST /{app-id}/uploads` abre uma sessão e devolve o id dela.
   * 2. `POST /{sessão}` com os bytes crus devolve o handle (`h`).
   *
   * O segundo passo foge ao resto da Graph em dois detalhes que derrubam quem
   * reaproveita o cliente JSON: o cabeçalho é `Authorization: OAuth …` (e não
   * `Bearer`), e o corpo é o arquivo cru, com `file_offset` indicando de onde
   * começar. Por isso este método não passa por `chamar()`.
   *
   * O token é o do APP, não o do cliente: a sessão de upload pertence ao app.
   */
  async enviarMidiaParaModelo(conteudo: Buffer, tipoMime: string): Promise<string> {
    if (!env.meta.appId || !env.meta.appSecret) {
      throw new ErroGraph({
        status: 0,
        codigo: null,
        traduzido: {
          codigo: 0,
          classe: 'config',
          titulo: 'Envio de mídia indisponível',
          explicacao:
            'O envio de arquivos à Meta não está configurado neste servidor. Use o endereço da imagem por enquanto.',
          esperaSegundos: 0,
        },
        corpo: { error: { message: 'META_APP_ID ou META_APP_SECRET ausentes' } },
      });
    }

    // Passo 1: abrir a sessão.
    const sessao = await this.chamar<{ id: string }>(`${env.meta.appId}/uploads`, {
      metodo: 'POST',
      query: { file_length: conteudo.length, file_type: tipoMime },
      tentativas: 0,
    });

    if (!sessao?.id) {
      throw new ErroGraph({
        status: 0,
        codigo: null,
        traduzido: traduzirErroMeta(null, 'A Meta não abriu a sessão de upload.'),
        corpo: sessao,
      });
    }

    // Passo 2: os bytes crus. `OAuth` e não `Bearer` — é o formato que esta rota
    // específica aceita.
    let resposta: Response;
    try {
      resposta = await fetch(`${this.base}/${sessao.id}`, {
        method: 'POST',
        headers: {
          Authorization: `OAuth ${this.tokenDoApp}`,
          file_offset: '0',
        },
        // O fetch do Node aceita Uint8Array; o tipo de Buffer da versão atual
        // não casa com BodyInit, embora seja o mesmo dado em tempo de execução.
        body: new Uint8Array(conteudo),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (erro) {
      const e = erro as Error;
      throw new ErroGraph({
        status: 0,
        codigo: null,
        traduzido: {
          codigo: 0,
          classe: 'transitorio',
          titulo: 'Não conseguimos enviar o arquivo à Meta',
          explicacao: 'A conexão caiu durante o envio do arquivo. Tente de novo.',
          esperaSegundos: 30,
        },
        corpo: { error: { message: `${e?.name ?? 'Erro'}: ${e?.message ?? String(erro)}` } },
      });
    }

    const texto = await resposta.text().catch(() => '');
    let dados: { h?: string } & Record<string, unknown> = {};
    try {
      dados = texto ? JSON.parse(texto) : {};
    } catch {
      dados = { error: { message: texto.slice(0, 500) } };
    }

    if (!resposta.ok || !dados.h) {
      const codigo = codigoDoErro(dados);
      throw new ErroGraph({
        status: resposta.status,
        codigo,
        traduzido: traduzirErroMeta(codigo, mensagemDoErroMeta(dados)),
        traceId: resposta.headers.get('x-fb-trace-id') ?? undefined,
        corpo: dados,
      });
    }

    return dados.h;
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
