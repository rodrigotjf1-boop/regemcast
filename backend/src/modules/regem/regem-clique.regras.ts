/**
 * "CONECTAR PELO REGEM" — as peças sem rede nem banco (Hub DMS, F6, plano "Clique RegemCast → Regem",
 * 15/11/2026; protótipo `prototipos/clique-empresa-inteira.html` do hub).
 *
 * O Regemcast é o APLICATIVO que pede (Padrão DMS §3): empurra o pedido ao Regem com o token do DMS ID
 * (RFC 9126), manda o dono à página do Regem com o número e, na volta, troca o código pela LIGAÇÃO da
 * empresa inteira (o Regem entrega uma só, sem loja: as lojas abertas depois entram sozinhas). O
 * contrato é o do Regem (`docs/integracao-regemcast.md` de lá, seção 1.1): PKCE S256, `state` preso a
 * quem começou e `iss` na volta (RFC 9207). Só leitura: as mesmas permissões do token `rgm_it_` de
 * hoje — a da 99 só quando o dono autorizou a 99 aqui (regra de 30/09/2026).
 */
import { createHash, randomBytes } from 'node:crypto';

import { ESCOPO_99, ESCOPOS_NECESSARIOS } from './regem.regras';

export const VALIDADE_DO_PEDIDO_MS = 10 * 60_000;

/** Tudo o que o Regemcast pode ler no Regem — o que pede ao DMS ID para o token (o Regem corta pela ligação). */
export const LEITURAS_DO_REGEM = [...ESCOPOS_NECESSARIOS, ESCOPO_99] as const;

const CAMINHO_DA_PORTA = '/api/v1/integracao';
const CAMINHO_DA_PAGINA = '/integracoes/autorizar';
const CAMINHO_DA_VOLTA = '/integracoes/regem/volta';

export type ConfigDoClique =
  | {
      ligado: true;
      /** A origem da API do Regem (é também o `iss` da volta). */
      api: string;
      /** O recurso do Regem no DMS ID (o destino do token): a API com `/api/v1/integracao`. */
      recurso: string;
      /** A página do Regem onde o presidente autoriza. */
      pagina: string;
      /** O endereço de volta do Regemcast, cadastrado na ficha dele no Regem. */
      volta: string;
      emissorDmsId: string;
      aplicativo: string;
      segredo: string;
    }
  | { ligado: false; motivo: string | null };

/** Endereço https (ou http da própria máquina, em teste), sem usuário, busca nem fragmento. Devolve a origem. */
function origemDe(valor: string, comCaminho = false): string | null {
  try {
    const u = new URL(valor);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
    if (u.username || u.password || u.hash || u.search) return null;
    if (!comCaminho && u.pathname !== '/' && u.pathname !== '') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * A configuração, lida do ambiente (a distribuição configura no EasyPanel; nada disso é da conta):
 * - `REGEM_CLIQUE=true` liga o botão (sem isso, o cartão segue com "Quem liga é a nossa equipe");
 * - `REGEM_API_URL` (a API do Regem, com o `/api/v1` — a mesma da leitura), `REGEM_APP_URL` (o site do
 *   Regem) e `APP_URL` (o site do Regemcast): os padrões são os de produção;
 * - `DMS_ID_EMISSOR`, `HUB_APLICATIVO` e `HUB_SEGREDO`: o aplicativo do Regemcast no DMS ID, o mesmo do hub.
 * Configuração torta não liga: o motivo vai ao log, para a distribuição.
 */
export function lerConfigDoClique(e: Record<string, string | undefined>): ConfigDoClique {
  const v = (e.REGEM_CLIQUE ?? '').trim().toLowerCase();
  if (v !== 'true' && v !== '1' && v !== 'sim') return { ligado: false, motivo: null };
  const desligado = (motivo: string): ConfigDoClique => ({ ligado: false, motivo });

  const api = origemDe((e.REGEM_API_URL || 'https://api.dmsregem.com/api/v1').trim(), true);
  if (!api) return desligado('REGEM_API_URL precisa ser o endereço https da API do Regem');
  const site = origemDe((e.REGEM_APP_URL || 'https://app.dmsregem.com').trim());
  if (!site) return desligado('REGEM_APP_URL precisa ser o endereço https do site do Regem, sem caminho');
  const cast = origemDe((e.APP_URL || 'https://cast.dmsregem.com').trim(), true);
  if (!cast) return desligado('APP_URL precisa ser o endereço https do site do Regemcast');

  const emissorDmsId = (e.DMS_ID_EMISSOR ?? '').trim().replace(/\/+$/, '');
  const aplicativo = (e.HUB_APLICATIVO ?? '').trim();
  const segredo = (e.HUB_SEGREDO ?? '').trim();
  for (const [nome, valor] of [
    ['DMS_ID_EMISSOR', emissorDmsId],
    ['HUB_APLICATIVO', aplicativo],
    ['HUB_SEGREDO', segredo],
  ] as const) {
    if (!valor) return desligado(`falta ${nome} (o aplicativo do Regemcast no DMS ID)`);
  }
  return {
    ligado: true,
    api,
    recurso: `${api}${CAMINHO_DA_PORTA}`,
    pagina: `${site}${CAMINHO_DA_PAGINA}`,
    volta: `${cast}${CAMINHO_DA_VOLTA}`,
    emissorDmsId,
    aplicativo,
    segredo,
  };
}

// ───────────────────────────── o pedido ─────────────────────────────

export const hashDoEstado = (estado: string): string => createHash('sha256').update(estado, 'utf8').digest('hex');

/** O `state` (preso a quem começou; só o resumo é guardado) e o par do PKCE (o verificador fica cifrado no banco). */
export function gerarPedido(): { estado: string; estadoHash: string; verificador: string; desafio: string } {
  const estado = randomBytes(32).toString('base64url');
  const verificador = randomBytes(48).toString('base64url');
  return {
    estado,
    estadoHash: hashDoEstado(estado),
    verificador,
    desafio: createHash('sha256').update(verificador, 'ascii').digest('base64url'),
  };
}

const FORMATO_DO_ESTADO = /^[A-Za-z0-9_-]{43}$/;
export const formatoDoEstado = (v: unknown): v is string => typeof v === 'string' && FORMATO_DO_ESTADO.test(v);

/**
 * As permissões que o pedido leva: as três necessárias sempre; a da 99 só quando o dono autorizou a 99
 * aqui (sem essa autorização, a 99 nem aparece na página do Regem).
 */
export function permissoesDoPedido(incluir99: boolean): string[] {
  return incluir99 ? [...ESCOPOS_NECESSARIOS, ESCOPO_99] : [...ESCOPOS_NECESSARIOS];
}

/** O CNPJ da conta com 14 dígitos, ou nada (o Regem trata a conta sem CNPJ como de outra empresa). */
export function cnpjDaConta(bruto: string | null | undefined): string | null {
  const d = String(bruto ?? '').replace(/\D/g, '');
  return d.length === 14 ? d : null;
}

/**
 * O corpo do pedido empurrado (`POST /integracao/autorizacao/pedido`). A conta vai com o nome e o CNPJ
 * dela: com a mesma raiz de CNPJ da empresa no Regem, o presidente não precisa confirmar "outra empresa".
 */
export function corpoDoPedido(d: {
  volta: string;
  estado: string;
  desafio: string;
  incluir99: boolean;
  contaNome: string;
  contaCnpj: string | null;
  contaEmail: string;
}): Record<string, string> {
  const nome = d.contaNome.trim().slice(0, 120) || 'Conta do Regemcast';
  return {
    response_type: 'code',
    redirect_uri: d.volta,
    scope: permissoesDoPedido(d.incluir99).join(' '),
    state: d.estado,
    code_challenge: d.desafio,
    code_challenge_method: 'S256',
    conta_nome: nome,
    ...(d.contaCnpj ? { conta_cnpj: d.contaCnpj } : {}),
    conta_email: d.contaEmail.trim().toLowerCase().slice(0, 200),
  };
}

const FORMATO_DO_NUMERO = /^urn:ietf:params:oauth:request_uri:rgm_[A-Za-z0-9_-]{43}$/;
export const formatoDoNumero = (v: unknown): v is string => typeof v === 'string' && FORMATO_DO_NUMERO.test(v);

/** A página do Regem com o número do pedido: é para lá que o navegador vai. */
export function urlDaPagina(pagina: string, aplicativo: string, numero: string): string {
  const u = new URL(pagina);
  u.searchParams.set('client_id', aplicativo);
  u.searchParams.set('request_uri', numero);
  return u.toString();
}

// ───────────────────────────── a volta ─────────────────────────────

export type Volta =
  | { tipo: 'codigo'; estado: string; codigo: string }
  | { tipo: 'recusa'; estado: string; motivo: 'recusado' | 'pedido_invalido' }
  | { tipo: 'invalida'; motivo: string };

const texto = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Confere o que o navegador trouxe de volta, ANTES de ir ao banco. O `iss` tem de ser o do Regem (RFC
 * 9207): sem ele ou com outro, a volta não vale, mesmo com um `state` certo. O `state` tem a forma do que
 * o Regemcast gera; o código, um tamanho razoável (o Regem confere o resto na troca).
 */
export function conferirVolta(q: { code?: unknown; state?: unknown; iss?: unknown; error?: unknown }, emissorDoRegem: string): Volta {
  if (texto(q.iss) !== emissorDoRegem) return { tipo: 'invalida', motivo: 'a volta não veio do Regem' };
  if (!formatoDoEstado(q.state)) return { tipo: 'invalida', motivo: 'a volta veio sem o pedido que o Regemcast abriu' };
  const erro = texto(q.error);
  if (erro) return { tipo: 'recusa', estado: q.state, motivo: erro === 'access_denied' ? 'recusado' : 'pedido_invalido' };
  const codigo = texto(q.code);
  if (codigo.length < 20 || codigo.length > 300 || /\s/.test(codigo)) {
    return { tipo: 'invalida', motivo: 'a volta veio sem o código da autorização' };
  }
  return { tipo: 'codigo', estado: q.state, codigo };
}

// ───────────────────────────── a troca ─────────────────────────────

export type LigacaoDaEmpresa = { ligacao: string; prefixo: string | null; permissoes: string[] };

const FORMATO_DA_LIGACAO = /^dms_lg_regem_[A-Za-z0-9_-]{43}_[A-Za-z0-9_-]{6}$/;

/** A credencial guardada é uma ligação do clique (e não o token `rgm_it_` do console)? */
export const ehLigacao = (credencial: string): boolean => credencial.startsWith('dms_lg_regem_');

/**
 * A ligação que a troca devolveu, conferida: UM item, da empresa inteira (sem loja), o segredo com a cara
 * da ligação do Regem e as três leituras necessárias entre as permissões. Resposta torta devolve `null`:
 * nada é guardado.
 */
export function ligacaoDaTroca(resposta: unknown): LigacaoDaEmpresa | null {
  const lista = (resposta as { lojas?: unknown } | null)?.lojas;
  if (!Array.isArray(lista) || lista.length !== 1) return null;
  const l = lista[0] as Record<string, unknown> | null;
  if (!l || l.loja_id !== null) return null;
  const ligacao = texto(l.ligacao);
  if (!FORMATO_DA_LIGACAO.test(ligacao)) return null;
  const permissoes = Array.isArray(l.permissoes) ? (l.permissoes as unknown[]).filter((p): p is string => typeof p === 'string') : [];
  if (ESCOPOS_NECESSARIOS.some((e) => !permissoes.includes(e))) return null;
  return { ligacao, prefixo: texto(l.prefixo).slice(0, 40) || null, permissoes: permissoes.slice(0, 20) };
}
