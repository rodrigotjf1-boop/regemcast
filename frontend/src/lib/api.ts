/**
 * Cliente HTTP do Regemcast.
 *
 * Enxuto de propósito: a sessão é um cookie httpOnly emitido pela API, então o
 * navegador só precisa mandar `credentials: 'include'`. Não existe token em
 * localStorage, não existe modo offline, não existe base alternativa — isso é
 * arquitetura de outro produto e não se aplica aqui.
 *
 * Contrato de erro da API (ver `ErroFilter` no backend):
 *   { mensagem: string, detalhes?: unknown, referencia?: string }
 * A `mensagem` já vem em pt-BR e pronta para o usuário — quem chama mostra ela,
 * e nunca inventa um texto genérico por cima. A `referencia` só aparece em erro
 * nosso (5xx) e é o que liga a tela do cliente à linha do log no servidor.
 */

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3010/api/v1').replace(/\/+$/, '');

export interface CorpoErro {
  mensagem?: string;
  referencia?: string;
  detalhes?: unknown;
}

/** Erro que carrega o que veio da API — status, mensagem em pt-BR e referência. */
export class ErroApi extends Error {
  readonly status: number;
  readonly referencia?: string;

  constructor(mensagem: string, status: number, extra?: { referencia?: string }) {
    super(mensagem);
    this.name = 'ErroApi';
    this.status = status;
    this.referencia = extra?.referencia;
  }

  /** Sessão ausente ou vencida. */
  get naoAutenticado(): boolean {
    return this.status === 401;
  }
}

export interface OpcoesRequisicao {
  /**
   * No 401, manda o navegador para /entrar. É o padrão em tela autenticada.
   * As rotas de autenticação passam `false`: ali o 401 É a resposta ("e-mail ou
   * senha não conferem") e precisa aparecer no formulário, não virar redirect.
   */
  redirecionarNo401?: boolean;
  sinal?: AbortSignal;
}

type Metodo = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

function mensagemDeRede(): string {
  return 'Não consegui falar com o servidor. Verifique sua conexão e tente de novo.';
}

function irParaEntrar(): void {
  if (typeof window === 'undefined') return;
  const atual = window.location.pathname + window.location.search;
  if (window.location.pathname.startsWith('/entrar')) return;
  const destino = atual && atual !== '/' ? `?de=${encodeURIComponent(atual)}` : '';
  window.location.replace(`/entrar${destino}`);
}

async function lerCorpo(resposta: Response): Promise<unknown> {
  const tipo = resposta.headers.get('content-type') ?? '';
  if (resposta.status === 204 || !tipo.includes('application/json')) {
    const texto = await resposta.text().catch(() => '');
    return texto ? { mensagem: texto } : null;
  }
  return resposta.json().catch(() => null);
}

async function requisitar<T>(
  metodo: Metodo,
  caminho: string,
  corpo?: unknown,
  opcoes?: OpcoesRequisicao,
): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(`${BASE}${caminho}`, {
      method: metodo,
      credentials: 'include',
      cache: 'no-store',
      signal: opcoes?.sinal,
      headers: corpo === undefined ? { Accept: 'application/json' } : {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch (erro) {
    // Servidor fora, DNS, CORS, offline. Não é 4xx: o cliente não errou nada.
    if (erro instanceof DOMException && erro.name === 'AbortError') throw erro;
    throw new ErroApi(mensagemDeRede(), 0);
  }

  const dados = await lerCorpo(resposta);

  if (!resposta.ok) {
    const corpoErro = (dados ?? {}) as CorpoErro;
    if (resposta.status === 401 && (opcoes?.redirecionarNo401 ?? true)) irParaEntrar();
    throw new ErroApi(
      corpoErro.mensagem?.trim() || 'Algo deu errado. Tente de novo em instantes.',
      resposta.status,
      { referencia: corpoErro.referencia },
    );
  }

  return (dados ?? null) as T;
}

export const api = {
  get: <T>(caminho: string, opcoes?: OpcoesRequisicao) =>
    requisitar<T>('GET', caminho, undefined, opcoes),
  post: <T>(caminho: string, corpo?: unknown, opcoes?: OpcoesRequisicao) =>
    requisitar<T>('POST', caminho, corpo ?? {}, opcoes),
  patch: <T>(caminho: string, corpo?: unknown, opcoes?: OpcoesRequisicao) =>
    requisitar<T>('PATCH', caminho, corpo ?? {}, opcoes),
  delete: <T>(caminho: string, opcoes?: OpcoesRequisicao) =>
    requisitar<T>('DELETE', caminho, undefined, opcoes),
};

/**
 * Texto pronto para o usuário a partir de qualquer erro capturado.
 *
 * Quando o servidor manda uma `referencia` (só em erro nosso), ela entra no
 * fim da frase: é o único jeito de o suporte achar no log exatamente a falha
 * que aquela pessoa viu.
 */
export function mensagemDoErro(erro: unknown): string {
  if (erro instanceof ErroApi) {
    return erro.referencia ? `${erro.message} (referência ${erro.referencia})` : erro.message;
  }
  if (erro instanceof Error && erro.message) return erro.message;
  return 'Algo deu errado. Tente de novo em instantes.';
}
