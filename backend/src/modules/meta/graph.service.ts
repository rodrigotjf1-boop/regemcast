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
  erroSemCodigo,
  frasesDoErro,
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
  /** A qualidade que a Meta atribui pelo que os destinatários fazem com a mensagem. */
  quality_score?: { score?: string; date?: number } | string;
  /** A categoria que a Meta considera certa; diferente de `category` = ela vai reclassificar. */
  correct_category?: string;
  /** A categoria de antes da última reclassificação. */
  previous_category?: string;
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

  /** O que o usuário lê: o que houve e o que fazer. */
  get mensagemParaUsuario(): string {
    return frasesDoErro(this.traduzido);
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

/**
 * Falha ao abrir uma mídia recebida. A mensagem já vem em português, pronta
 * para a tela: quem chama traduz para 4xx em vez de deixar virar 500.
 */
export class ErroMidia extends Error {}

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
/**
 * Até onde a lista de modelos segue o cursor: 30 páginas de 200 = 6.000, o
 * maior teto de modelos que a Meta dá a uma conta.
 */
const MAX_PAGINAS_DE_MODELOS = 30;
/** O que a lista de modelos sempre pede. */
const CAMPOS_DO_MODELO = 'id,name,language,status,category,components,rejected_reason';
/** Os sinais (`modelo-sinais.ts`): a qualidade e a categoria que a Meta considera certa. */
const SINAIS_DO_MODELO = 'quality_score,correct_category,previous_category';

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
          : erroSemCodigo({
              classe: 'transitorio',
              titulo: 'Não conseguimos falar com a Meta',
              explicacao: 'A conexão com a Meta falhou.',
              // Quem chama decide se tenta de novo (a campanha não reenvia o
              // que pode ter chegado): aqui não se promete nova tentativa.
              acao: 'Tente de novo em instantes.',
              esperaSegundos: 60,
            }),
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
  /**
   * Renova uma autorização que ainda vale: devolve um token novo, de 60 dias.
   *
   * É a troca oficial da Meta para token de usuário do sistema que vence
   * (`grant_type=fb_exchange_token` + `set_token_expires_in_60_days=true`). Só
   * funciona com o token ainda válido; vencido, o caminho é reconectar.
   *
   * Uma tentativa só, e sem o token no log: ele vai na consulta, e o que se
   * registra de uma falha é o código e a frase da Meta, nunca o endereço.
   */
  async renovarToken(tokenAtual: string): Promise<{ token: string; expiraEm: number | null }> {
    const r = await this.chamar<{ access_token?: string; expires_in?: number }>('oauth/access_token', {
      query: {
        grant_type: 'fb_exchange_token',
        client_id: env.meta.appId,
        client_secret: env.meta.appSecret,
        set_token_expires_in_60_days: 'true',
        fb_exchange_token: tokenAtual,
      },
      timeoutMs: 8_000,
      tentativas: 0,
    });
    return { token: r.access_token ?? '', expiraEm: r.expires_in ?? null };
  }

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

  /**
   * O portfólio de negócios dono da WABA — é com ele que se monta o endereço da
   * página de pagamento da conta na Meta. Chamada à parte da leitura da WABA,
   * curta e sem nova tentativa: se a Meta não devolver o campo, a conexão não
   * pode cair por causa de um botão.
   */
  async negocioDaWaba(wabaId: string, tokenDoCliente: string): Promise<string | null> {
    const r = await this.chamar<{ owner_business_info?: { id?: string } }>(wabaId, {
      token: tokenDoCliente,
      query: { fields: 'owner_business_info' },
      timeoutMs: 4_000,
      tentativas: 0,
    });
    const id = r?.owner_business_info?.id;
    return typeof id === 'string' && /^\d{5,30}$/.test(id) ? id : null;
  }

  /**
   * O `health_status` de um nó — a WABA ou o número: se dá para enviar e, se
   * não, o que está por trás. Sem nova tentativa e com prazo curto: quem chama
   * é a tela, o disparo e a rotina, e nenhum deles pode ficar esperando.
   */
  async saudeDe(noId: string, tokenDoCliente: string): Promise<unknown> {
    const r = await this.chamar<{ health_status?: unknown }>(noId, {
      token: tokenDoCliente,
      query: { fields: 'health_status' },
      timeoutMs: 6_000,
      tentativas: 0,
    });
    return r?.health_status;
  }

  /**
   * A cobrança da WABA: moeda, fuso, forma de pagamento e verificação da
   * empresa. Chamada à parte da saúde: um campo recusado aqui não pode esconder
   * o veredito de envio. Quem chama diz quais campos pedir — a Meta recusa a
   * chamada inteira quando a autorização não alcança um deles.
   */
  async cobrancaDaWaba(
    wabaId: string,
    tokenDoCliente: string,
    campos: readonly string[],
  ): Promise<{
    currency?: string;
    timezone_id?: string;
    primary_funding_id?: string;
    business_verification_status?: string;
  }> {
    return this.chamar(wabaId, {
      token: tokenDoCliente,
      query: { fields: campos.join(',') },
      timeoutMs: 6_000,
      tentativas: 0,
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
   * Limite de envio atual, pelo campo que substituiu `messaging_limit_tier`
   * (descontinuado). Existe desde a v24.0 e vale para o portfólio inteiro.
   * Pedido no próprio número, como a documentação mostra — no `phone_numbers`
   * da WABA um campo desconhecido derrubaria a consulta inteira. Formatos e
   * fonte em `limite.regras.ts`.
   */
  async limiteDoNumero(phoneNumberId: string, tokenDoCliente: string): Promise<unknown> {
    const r = await this.chamar<{ whatsapp_business_manager_messaging_limit?: unknown }>(phoneNumberId, {
      token: tokenDoCliente,
      query: { fields: 'whatsapp_business_manager_messaging_limit' },
    });
    return r.whatsapp_business_manager_messaging_limit;
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
      /**
       * O `components` já montado (`envio.regras.ts`), quando o modelo exige
       * mais que as variáveis do corpo: mídia, cupom, oferta, carrossel. Com
       * ele, `variaveis` não é lido — o corpo já está lá dentro.
       */
      componentes?: Record<string, unknown>[];
    },
    tokenDoCliente: string,
  ): Promise<string> {
    // Componente de corpo só entra quando há variável: mandar `parameters`
    // vazio num modelo sem variável faz a Meta recusar com 132000.
    const componentes =
      dados.componentes ??
      (dados.variaveis.length > 0
        ? [{ type: 'body', parameters: dados.variaveis.map((v) => ({ type: 'text', text: v })) }]
        : []);

    const corpo: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: dados.para,
      type: 'template',
      template: {
        name: dados.modelo,
        language: { code: dados.idioma },
        ...(componentes.length > 0 ? { components: componentes } : {}),
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
        traduzido: erroSemCodigo({
          classe: 'transitorio',
          titulo: 'A Meta aceitou sem devolver o identificador',
          explicacao:
            'A Meta respondeu sem o identificador da mensagem, então não temos como acompanhar a entrega.',
          acao: 'Não precisa fazer nada: tentamos de novo sozinhos.',
          esperaSegundos: 30,
        }),
        corpo: r,
      });
    }
    return wamid;
  }

  /**
   * Resposta de texto livre, na conversa.
   *
   * A Meta só aceita dentro da janela de 24 horas aberta pela última mensagem
   * do cliente; fora dela, recusa com 131047 — quem chama confere a janela
   * antes, e o erro traduzido cobre o resto. `tentativas: 0` pelo mesmo motivo
   * do `enviarModelo`: retentar no request duplica mensagem.
   */
  async enviarTexto(
    phoneNumberId: string,
    dados: { para: string; texto: string },
    tokenDoCliente: string,
  ): Promise<string> {
    const r = await this.chamar<{ messages?: Array<{ id?: string }> }>(`${phoneNumberId}/messages`, {
      metodo: 'POST',
      token: tokenDoCliente,
      corpo: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: dados.para,
        type: 'text',
        text: { body: dados.texto, preview_url: false },
      },
      tentativas: 0,
    });
    const wamid = r.messages?.[0]?.id;
    if (!wamid) {
      throw new ErroGraph({
        status: 200,
        codigo: null,
        traduzido: erroSemCodigo({
          classe: 'transitorio',
          titulo: 'A Meta aceitou sem devolver o identificador',
          explicacao: 'A Meta respondeu sem o identificador da mensagem.',
          acao: 'Confira no celular se ela chegou antes de mandar de novo.',
          quem: 'voce',
          esperaSegundos: 30,
        }),
        corpo: r,
      });
    }
    return wamid;
  }

  /**
   * Os bytes de uma mídia recebida (foto, áudio, documento).
   *
   * Dois passos, como a Meta manda: o id devolve um endereço temporário, e o
   * endereço só entrega o arquivo com o token do cliente no cabeçalho. O
   * endereço é conferido contra os domínios da Meta — nada de seguir para onde
   * uma resposta adulterada mandasse — e o tamanho tem teto: o arquivo passa
   * pela memória do servidor.
   */
  async baixarMidia(
    midiaId: string,
    tokenDoCliente: string,
    tetoBytes: number,
  ): Promise<{ conteudo: Buffer; tipoMime: string }> {
    const meta = await this.chamar<{ url?: string; mime_type?: string; file_size?: number }>(
      encodeURIComponent(midiaId),
      { token: tokenDoCliente },
    );

    const endereco = typeof meta.url === 'string' ? new URL(meta.url) : null;
    const dominioDaMeta = (h: string) =>
      ['fbsbx.com', 'facebook.com', 'whatsapp.net', 'fbcdn.net'].some((d) => h === d || h.endsWith(`.${d}`));
    if (!endereco || endereco.protocol !== 'https:' || !dominioDaMeta(endereco.hostname)) {
      throw new ErroMidia('A Meta não devolveu um endereço válido para esta mídia.');
    }
    if (typeof meta.file_size === 'number' && meta.file_size > tetoBytes) {
      throw new ErroMidia('Arquivo grande demais para abrir aqui. Veja no WhatsApp Business do celular.');
    }

    let resposta: Response;
    try {
      resposta = await fetch(endereco, {
        headers: { Authorization: `Bearer ${tokenDoCliente}` },
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_PADRAO_MS),
      });
    } catch {
      throw new ErroMidia('Não consegui baixar a mídia da Meta agora. Tente de novo em instantes.');
    }
    if (!resposta.ok) {
      throw new ErroMidia(
        resposta.status === 404
          ? 'Esta mídia não está mais disponível na Meta.'
          : 'Não consegui baixar a mídia da Meta agora. Tente de novo em instantes.',
      );
    }
    // O tamanho declarado é conferido ANTES de ler o corpo inteiro para a memória.
    if (Number(resposta.headers.get('content-length')) > tetoBytes) {
      throw new ErroMidia('Arquivo grande demais para abrir aqui. Veja no WhatsApp Business do celular.');
    }

    const conteudo = Buffer.from(await resposta.arrayBuffer());
    if (conteudo.length > tetoBytes) {
      throw new ErroMidia('Arquivo grande demais para abrir aqui. Veja no WhatsApp Business do celular.');
    }
    return { conteudo, tipoMime: meta.mime_type ?? resposta.headers.get('content-type') ?? 'application/octet-stream' };
  }

  /**
   * Entrega um arquivo à Meta para ENVIAR numa mensagem, e devolve o id dele.
   *
   * Não é o upload da criação do modelo (`enviarMidiaParaModelo`, que devolve
   * um `header_handle`): são duas rotas e dois identificadores que não servem
   * um no lugar do outro. Este é `POST /{numero}/media`, em multipart, com o
   * token do cliente; o id vale 30 dias.
   *
   * Uma tentativa só: quem chama é a rodada do disparo, que volta sozinha.
   */
  async subirMidiaParaEnvio(
    phoneNumberId: string,
    arquivo: { conteudo: Buffer; tipoMime: string; nome: string },
    tokenDoCliente: string,
  ): Promise<string> {
    const formulario = new FormData();
    formulario.set('messaging_product', 'whatsapp');
    formulario.set('type', arquivo.tipoMime);
    formulario.set('file', new Blob([new Uint8Array(arquivo.conteudo)], { type: arquivo.tipoMime }), arquivo.nome);

    let resposta: Response;
    try {
      resposta = await fetch(`${this.base}/${phoneNumberId}/media`, {
        method: 'POST',
        // Sem `Content-Type`: o fetch põe o do multipart, com a fronteira.
        headers: { Authorization: `Bearer ${tokenDoCliente}`, Accept: 'application/json' },
        body: formulario,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (erro) {
      const e = erro as Error;
      throw new ErroGraph({
        status: 0,
        codigo: null,
        traduzido: erroSemCodigo({
          classe: 'transitorio',
          titulo: 'Não conseguimos enviar o arquivo à Meta',
          explicacao: 'A conexão caiu durante o envio do arquivo do modelo.',
          acao: 'Não precisa fazer nada: tentamos de novo sozinhos.',
          esperaSegundos: 60,
        }),
        corpo: { error: { message: `${e?.name ?? 'Erro'}: ${e?.message ?? String(erro)}` } },
      });
    }

    const texto = await resposta.text().catch(() => '');
    let dados: { id?: unknown } & Record<string, unknown> = {};
    try {
      dados = texto ? JSON.parse(texto) : {};
    } catch {
      dados = { error: { message: texto.slice(0, 500) } };
    }

    if (!resposta.ok || typeof dados.id !== 'string' || !dados.id) {
      const codigo = codigoDoErro(dados);
      throw new ErroGraph({
        status: resposta.status,
        codigo,
        traduzido: traduzirErroMeta(codigo, mensagemDoErroMeta(dados)),
        traceId: resposta.headers.get('x-fb-trace-id') ?? undefined,
        corpo: dados,
      });
    }

    return dados.id;
  }

  /**
   * Modelos de mensagem da WABA.
   *
   * `limit` alto de propósito: a paginação da Graph é por cursor, e uma conta
   * madura passa fácil dos 25 padrão. Buscar de 25 em 25 numa tela que só lista
   * transformaria um request em cinco — e a Meta cobra rate limit por app, não
   * por cliente.
   *
   * Segue o cursor até o fim: a campanha confere o modelo escolhido contra esta
   * lista, e parar na primeira página faria o modelo nº 201 de uma conta grande
   * "não existir". O teto de páginas é só a trava contra um cursor que não
   * acaba — passar dele é registrado, não escondido.
   */
  async modelosDaWaba(
    wabaId: string,
    tokenDoCliente: string,
    limite = 200,
  ): Promise<{ data: ModeloBruto[] }> {
    const data: ModeloBruto[] = [];
    let depois: string | undefined;
    let campos = `${CAMPOS_DO_MODELO},${SINAIS_DO_MODELO}`;

    for (let pagina = 0; pagina < MAX_PAGINAS_DE_MODELOS; pagina++) {
      const pedir = () =>
        this.chamar<{
          data?: ModeloBruto[];
          paging?: { cursors?: { after?: string }; next?: string };
        }>(`${wabaId}/message_templates`, {
          token: tokenDoCliente,
          query: { fields: campos, limit: limite, after: depois },
        });

      let r: Awaited<ReturnType<typeof pedir>>;
      try {
        r = await pedir();
      } catch (erro) {
        // A lista é o que deixa montar campanha: se a Meta recusar os campos
        // dos sinais (qualidade, categoria certa), ela vem sem eles — e não cai.
        const recusouOCampo = erro instanceof ErroGraph && erro.codigo === 100 && campos !== CAMPOS_DO_MODELO;
        if (!recusouOCampo) throw erro;
        this.log.warn(`A Meta recusou os campos dos sinais do modelo; a lista segue sem eles: ${erro.detalheParaLog}`);
        campos = CAMPOS_DO_MODELO;
        r = await pedir();
      }
      data.push(...(r.data ?? []));

      // `next` só vem quando há mais; o cursor `after` sozinho vem sempre.
      depois = r.paging?.next ? r.paging.cursors?.after : undefined;
      if (!depois) return { data };
    }

    this.log.warn(
      `A lista de modelos da conta passou de ${MAX_PAGINAS_DE_MODELOS} páginas; paramos em ${data.length} modelos.`,
    );
    return { data };
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
        traduzido: erroSemCodigo({
          classe: 'config',
          titulo: 'Envio de mídia indisponível',
          explicacao: 'O envio de arquivos à Meta não está configurado neste servidor.',
          acao: 'Use o endereço da imagem por enquanto.',
          quem: 'nos',
          esperaSegundos: 0,
        }),
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
        traduzido: erroSemCodigo({
          classe: 'config',
          titulo: 'A Meta não abriu o envio do arquivo',
          explicacao: 'A Meta não abriu a sessão para receber o arquivo.',
          acao: 'Tente de novo. Se repetir, fale com o suporte.',
          quem: 'voce',
        }),
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
        traduzido: erroSemCodigo({
          classe: 'transitorio',
          titulo: 'Não conseguimos enviar o arquivo à Meta',
          explicacao: 'A conexão caiu durante o envio do arquivo.',
          acao: 'Tente de novo.',
          quem: 'voce',
          esperaSegundos: 30,
        }),
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
