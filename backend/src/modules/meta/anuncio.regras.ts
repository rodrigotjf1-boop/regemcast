/**
 * Conversas abertas por anúncio — as regras, sem banco.
 *
 * Quando alguém clica num anúncio de "clique para o WhatsApp" e escreve, a Meta
 * manda a origem junto da mensagem (`referral`, no aviso `messages`; conferido
 * na documentação oficial em 29/09/2026):
 *
 *   source_type  `ad` (anúncio) ou `post` (publicação)
 *   source_id    o id do anúncio (ou da publicação)
 *   source_url   o endereço dele
 *   ctwa_clid    o identificador do clique — some em anúncio no Status do WhatsApp
 *   headline, body, image_url, video_url, welcome_message… — o conteúdo do anúncio
 *
 * Daqui sai só o que liga o anúncio ao pedido: a origem, o momento e o telefone
 * de quem escreveu. O conteúdo do anúncio e o da mensagem NÃO são lidos.
 *
 * O resto do arquivo é o contrato de leitura que o Liame espera
 * (`docs/integracoes/regemcast.md`, no repositório dele): nomes em snake_case,
 * ordem estável por (`atualizado_em`, `id`), cursor opaco, e só o que entrou há
 * pelo menos 5 segundos — uma transação que confirma tarde não fica para trás
 * do cursor.
 */
import { telefoneDaPessoa } from './conversas.regras';

/** A permissão que lê — e que, existindo na conta, liga a gravação. */
export const ESCOPO_DE_LEITURA = 'conversas.anuncio.ler';
export const LIMITE_PADRAO = 200;
export const LIMITE_MAXIMO = 500;
/** Só sai o que entrou há pelo menos isto. */
export const MARGEM_SEGUNDOS = 5;
/** Depois disto, a linha é apagada. */
export const GUARDA_DIAS = 180;

export interface AberturaPorAnuncio {
  wamid: string;
  /** Quem escreveu, no formato do `contato` (só dígitos, com o 55 e o 9º dígito). */
  telefone: string;
  abertaEm: Date;
  origemTipo: string;
  origemId: string;
  ctwaClid: string | null;
  origemUrl: string | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const lista = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);

/** Texto aparado, ou nulo se vazio ou maior que o teto (id cortado seria outro id). */
function texto(v: unknown, teto: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.length <= teto ? t : null;
}

const TIPO = /^[a-z_]{1,30}$/;

/**
 * As mensagens do aviso que chegaram com a origem de um anúncio. Mensagem sem
 * `referral`, sem o id da origem ou de quem não dá para saber o telefone fica
 * de fora — não há o que ligar. Uma linha por mensagem.
 */
export function aberturasPorAnuncio(value: unknown): AberturaPorAnuncio[] {
  const porWamid = new Map<string, AberturaPorAnuncio>();
  for (const m of lista(obj(value).messages)) {
    const referral = obj(m.referral);
    const origemId = texto(referral.source_id, 100);
    const origemTipo = texto(referral.source_type, 30)?.toLowerCase() ?? '';
    const wamid = texto(m.id, 300);
    const telefone = telefoneDaPessoa(m.from);
    if (!origemId || !TIPO.test(origemTipo) || !wamid || !telefone) continue;

    const segundos = Number(m.timestamp);
    porWamid.set(wamid, {
      wamid,
      telefone,
      abertaEm: Number.isFinite(segundos) && segundos > 0 ? new Date(segundos * 1000) : new Date(),
      origemTipo,
      origemId,
      ctwaClid: texto(referral.ctwa_clid, 1000),
      origemUrl: texto(referral.source_url, 2000),
    });
  }
  return [...porWamid.values()];
}

// ---------------------------------------------------------------- a leitura

/** Onde a leitura parou: a hora de entrada (com os microssegundos do banco) e o id. */
export interface Cursor {
  t: string;
  i: string;
}

const INSTANTE_DO_BANCO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function montarCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify({ t: c.t, i: c.i }), 'utf8').toString('base64url');
}

/** Sem cursor → nulo (leitura do começo). Cursor que não é nosso → `invalido`. */
export function lerCursor(bruto: unknown): Cursor | null | 'invalido' {
  if (bruto === undefined || bruto === null || bruto === '') return null;
  if (typeof bruto !== 'string' || bruto.length > 400) return 'invalido';
  try {
    const lido = obj(JSON.parse(Buffer.from(bruto, 'base64url').toString('utf8')));
    const { t, i } = lido;
    if (typeof t !== 'string' || typeof i !== 'string') return 'invalido';
    if (!INSTANTE_DO_BANCO.test(t) || !UUID.test(i) || Number.isNaN(Date.parse(t))) return 'invalido';
    return { t, i };
  } catch {
    return 'invalido';
  }
}

const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

/** O `desde` da carga inicial: um instante completo, com fuso. */
export function lerDesde(bruto: unknown): Date | null | 'invalido' {
  if (bruto === undefined || bruto === null || bruto === '') return null;
  if (typeof bruto !== 'string' || !INSTANTE.test(bruto)) return 'invalido';
  const d = new Date(bruto);
  return Number.isNaN(d.getTime()) ? 'invalido' : d;
}

export function lerLimite(bruto: unknown): number {
  const n = Number(bruto);
  if (bruto === undefined || bruto === null || !Number.isInteger(n) || n < 1) return LIMITE_PADRAO;
  return Math.min(n, LIMITE_MAXIMO);
}

/** `wa_numero.telefone_e164` guarda o número como a Meta o exibe ("+55 21 9…"): aqui, só o "+" e os dígitos. */
export function numeroEmE164(bruto: unknown): string | null {
  const digitos = typeof bruto === 'string' ? bruto.replace(/\D/g, '') : '';
  return digitos.length >= 8 && digitos.length <= 15 ? `+${digitos}` : null;
}

export interface LinhaDeAbertura {
  id: string;
  /** Texto do banco, em UTC, com microssegundos. */
  registrado: string;
  telefone: string;
  numeroDaLoja: string | null;
  abertaEm: Date | string;
  origemTipo: string;
  origemId: string;
  ctwaClid: string | null;
  origemUrl: string | null;
}

/** Uma conversa aberta por anúncio, como o contrato a descreve. */
export interface ItemDoContrato {
  id: string;
  versao: number;
  atualizado_em: string;
  numero_loja: string | null;
  telefone: string;
  aberta_em: string;
  anuncio_id: string;
  tipo_origem: string;
  ctwa_clid: string | null;
  url_origem: string | null;
}

export function itemDoContrato(l: LinhaDeAbertura): ItemDoContrato {
  return {
    id: l.id,
    // A linha não muda depois de entrar: a versão é sempre a primeira.
    versao: 1,
    atualizado_em: l.registrado,
    numero_loja: numeroEmE164(l.numeroDaLoja),
    telefone: `+${l.telefone.replace(/\D/g, '')}`,
    aberta_em: new Date(l.abertaEm).toISOString(),
    anuncio_id: l.origemId,
    tipo_origem: l.origemTipo,
    ctwa_clid: l.ctwaClid,
    url_origem: l.origemUrl,
  };
}

export interface PaginaDoContrato {
  itens: ItemDoContrato[];
  proximo_cursor: string | null;
  tem_mais: boolean;
}

/**
 * Monta a página a partir de `limite + 1` linhas lidas. O cursor devolvido é o
 * do último item — e, sem item nenhum, o mesmo que veio: quem lê guarda o
 * cursor e volta com ele na próxima consulta.
 */
export function montarPagina(linhas: LinhaDeAbertura[], limite: number, cursorRecebido: Cursor | null): PaginaDoContrato {
  const daPagina = linhas.slice(0, limite);
  const ultima = daPagina[daPagina.length - 1];
  return {
    itens: daPagina.map(itemDoContrato),
    proximo_cursor: ultima
      ? montarCursor({ t: ultima.registrado, i: ultima.id })
      : cursorRecebido
        ? montarCursor(cursorRecebido)
        : null,
    tem_mais: linhas.length > limite,
  };
}
