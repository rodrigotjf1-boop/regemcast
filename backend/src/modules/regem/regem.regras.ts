/**
 * As regras da integração com o Regem — sem rede e sem banco.
 *
 * O Regem é o ponto central da loja: por ele chegam os clientes e as vendas do
 * cardápio próprio, do Anota Aí, do delivery direto e — só com a autorização
 * do dono, sob a responsabilidade dele — da 99Food (decisões do dono,
 * 30/09/2026). Marketplace (iFood, Keeta, Rappi, Uber Eats, Open Delivery)
 * nunca: o número é mascarado e os termos do marketplace não deixam.
 *
 * O contrato é o da API de integração do Regem (`/api/v1/integracao/…`,
 * `docs/prompt-regem-integracao.md` → `docs/integracao-regemcast.md` do lado
 * de lá): campos em snake_case, dinheiro em centavos, datas ISO, telefone
 * E.164 com `+55` (ou `null` quando o Regem não tem certeza).
 */
import { paraCloudApi } from '../../common/telefone';
import type { CompraParaGravar } from '../contato/compras';

// ------------------------------------------------------------ o contrato

export interface ClienteRegem {
  id: string;
  nome?: string | null;
  telefone?: string | null;
  criado_em?: string | null;
  atualizado_em?: string | null;
  /** Os canais em que o cliente tem venda válida (`cardapio`, `anotaai`, `99food`…). */
  canais?: string[] | null;
  bairro?: string | null;
  cidade?: string | null;
  opt_out?: { ativo?: boolean | null; em?: string | null; origem?: string | null } | null;
  aceite_marketing?: { aceito?: boolean | null; em?: string | null; origem?: string | null; texto?: string | null } | null;
  /** Lápide: o cliente foi esquecido/anonimizado no Regem. */
  removido?: boolean | null;
}

export interface ItemVendaRegem {
  id?: string | null;
  produto_id?: string | null;
  nome?: string | null;
  /** Em texto, até 3 casas decimais. */
  quantidade?: string | number | null;
  /** Quantidade × preço cheio, em centavos. */
  receita_centavos?: number | null;
}

export interface VendaRegem {
  id: string;
  versao?: number | null;
  atualizado_em?: string | null;
  canal?: string | null;
  grupo_canal?: string | null;
  /** confirmado | cancelado | removido */
  situacao?: string | null;
  /** O faturamento pela definição única do Regem (o do Painel). */
  receita_centavos?: number | null;
  cliente?: { id?: string | null; telefone?: string | null } | null;
  criado_em?: string | null;
  confirmado_em?: string | null;
  faturado_em?: string | null;
  cancelado_em?: string | null;
  itens?: ItemVendaRegem[] | null;
  unidade_id?: string | null;
  unidade_nome?: string | null;
  /** entrega | retirada | balcao | mesa */
  tipo?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  taxa_entrega_centavos?: number | null;
}

export interface PaginaRegem<T> {
  itens: T[];
  /** O ponto de onde a próxima leitura continua — guardado mesmo quando não há mais. */
  proximo_cursor: string | null;
  tem_mais: boolean;
}

export interface LojaDoRegem {
  empresaId: string | null;
  empresaNome: string;
  lojas: { id: string; nome: string }[];
  escopos: string[];
}

// ------------------------------------------------------------ canais

/** Marketplace: nunca entra — a 99 só com a autorização do dono. */
export const CANAIS_DE_MARKETPLACE: ReadonlySet<string> = new Set([
  'ifood',
  '99food',
  'ubereats',
  'rappi',
  'keeta',
  'aiqfome',
  'open_delivery',
]);

export const CANAL_99 = '99food';

/** O escopo do token que libera os clientes e as vendas da 99 no Regem. */
export const ESCOPO_99 = 'vendas.99food.ler';

/** Os escopos sem os quais a conexão não serve. */
export const ESCOPOS_NECESSARIOS = ['clientes.ler', 'pedidos.ler', 'clientes.telefone.ler'] as const;

/** A venda do Cardápio Web que o Regem também recebe: descartada quando a loja liga o Cardápio Web direto aqui. */
export const CANAL_CARDAPIO_WEB = 'cardapio_web';

export function canalNormalizado(bruto: unknown): string {
  return String(bruto ?? '')
    .trim()
    .toLowerCase();
}

// ------------------------------------------------------------ campos

function texto(bruto: unknown, maximo: number): string | null {
  const t = typeof bruto === 'string' ? bruto.replace(/\s+/g, ' ').trim() : '';
  return t ? t.slice(0, maximo) : null;
}

function data(bruto: unknown): Date | null {
  if (typeof bruto !== 'string' || !bruto) return null;
  const d = new Date(bruto);
  return Number.isNaN(d.getTime()) ? null : d;
}

function centavos(bruto: unknown): number {
  const n = Number(bruto);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/**
 * Telefone do Regem → E.164 sem '+' (o formato de `contato.telefone_e164`), ou
 * '' quando não serve. O Regem já manda E.164; o 0800 é o número mascarado
 * do marketplace e nunca é WhatsApp.
 */
export function telefoneDoRegem(bruto: unknown): string {
  const t = String(bruto ?? '').trim();
  const digitos = t.replace(/\D/g, '');
  if (!digitos) return '';
  if (digitos.startsWith('0800') || digitos.startsWith('800') || digitos.startsWith('550800')) return '';
  return paraCloudApi(t.startsWith('+') ? t : `+${digitos}`).e164;
}

/** "~3.2 km" é a distância que a loja que cobra por quilômetro guarda no lugar do bairro. */
export function bairroDoRegem(bruto: unknown): string | null {
  const b = texto(bruto, 80);
  if (!b) return null;
  if (/^~?\s*\d+([.,]\d+)?\s*km$/i.test(b)) return null;
  return b;
}

/** O jeito de comprar, no vocabulário do RegemCast (`compra.tipo`, que não aceita vazio). */
export function tipoDaVenda(bruto: unknown): 'entrega' | 'retirada' | 'salao' | 'outro' {
  const t = canalNormalizado(bruto);
  if (t === 'entrega' || t === 'delivery') return 'entrega';
  if (t === 'retirada' || t === 'takeout') return 'retirada';
  if (t === 'balcao' || t === 'mesa' || t === 'salao') return 'salao';
  return 'outro';
}

// ------------------------------------------------------------ a loja

/** `GET /integracao/loja` → quem é a empresa, as lojas e os escopos (aceita o formato por loja e o por empresa). */
export function lojaDaResposta(j: Record<string, unknown> | null | undefined): LojaDoRegem {
  const r = j ?? {};
  const lojasBrutas = Array.isArray(r.lojas) ? (r.lojas as Record<string, unknown>[]) : [];
  const lojas = lojasBrutas
    .map((l) => ({ id: String(l?.id ?? '').trim(), nome: texto(l?.nome, 120) ?? '' }))
    .filter((l) => l.id);
  if (!lojas.length && r.loja_id) {
    lojas.push({ id: String(r.loja_id), nome: texto(r.loja_nome, 120) ?? 'Loja' });
  }
  const escopos = Array.isArray(r.escopos) ? (r.escopos as unknown[]).map((e) => String(e)) : [];
  return {
    empresaId: r.empresa_id ? String(r.empresa_id) : null,
    empresaNome: texto(r.empresa_nome, 120) ?? lojas[0]?.nome ?? 'Empresa no Regem',
    lojas,
    escopos,
  };
}

/** Os escopos que faltam para a conexão servir. */
export function escoposQueFaltam(escopos: readonly string[]): string[] {
  return ESCOPOS_NECESSARIOS.filter((e) => !escopos.includes(e));
}

// ------------------------------------------------------------ o cliente

export type DecisaoDoCliente =
  | { tipo: 'removido'; regemId: string }
  | { tipo: 'invalido'; regemId: string }
  | { tipo: 'ignorado'; regemId: string; motivo: 'so_99' | 'marketplace' }
  | { tipo: 'bloqueado'; regemId: string; telefone: string; nome: string | null; canais: string[] }
  | {
      tipo: 'contato';
      regemId: string;
      telefone: string;
      nome: string | null;
      canais: string[];
      /** Só comprou pela 99 (entra com a autorização do dono). */
      so99: boolean;
      /** O aceite que o próprio cliente deu no Regem — prova mais forte que a declaração do dono. */
      aceite: { em: Date | null; origem: string | null; texto: string | null } | null;
    };

/**
 * O cliente do Regem vira contato, bloqueio ou fica de fora.
 *
 * - Lápide (`removido`): quem foi esquecido no Regem é anonimizado aqui.
 * - Pediu para sair no Regem (`opt_out.ativo`) ou recusou o aceite: bloqueado.
 * - Nenhum canal próprio, mas comprou pela 99 (mesmo que também em outro
 *   marketplace): só entra com a autorização do dono (`incluir99`).
 * - Só marketplace, sem a 99: nunca — o Regem nem deveria mandar.
 */
export function decidirCliente(c: ClienteRegem, opcoes: { incluir99: boolean }): DecisaoDoCliente {
  const regemId = String(c.id ?? '').trim();
  if (c.removido === true) return { tipo: 'removido', regemId };
  const telefone = telefoneDoRegem(c.telefone);
  if (!telefone) return { tipo: 'invalido', regemId };

  // Sem canal nenhum (cadastrou no cardápio e ainda não pediu): é da loja.
  // Só marketplace: a relação que resta é a da 99 — e só se autorizada.
  const canais = [...new Set((Array.isArray(c.canais) ? c.canais : []).map(canalNormalizado).filter(Boolean))];
  const proprios = canais.filter((x) => !CANAIS_DE_MARKETPLACE.has(x));
  const so99 = canais.length > 0 && !proprios.length && canais.includes(CANAL_99);
  if (so99 && !opcoes.incluir99) return { tipo: 'ignorado', regemId, motivo: 'so_99' };
  if (canais.length > 0 && !proprios.length && !so99) return { tipo: 'ignorado', regemId, motivo: 'marketplace' };

  const nome = texto(c.nome, 120);
  if (c.opt_out?.ativo === true || c.aceite_marketing?.aceito === false) {
    return { tipo: 'bloqueado', regemId, telefone, nome, canais };
  }
  const a = c.aceite_marketing;
  return {
    tipo: 'contato',
    regemId,
    telefone,
    nome,
    canais,
    so99,
    aceite: a?.aceito === true ? { em: data(a.em), origem: texto(a.origem, 60), texto: texto(a.texto, 500) } : null,
  };
}

// ------------------------------------------------------------ a venda

export type MotivoIgnorado =
  | 'nao_confirmado'
  | 'marketplace'
  | 'cardapio_web_duplicado'
  | 'sem_cliente'
  | 'sem_data';

export interface CompraDoRegem extends CompraParaGravar {
  /** O contato da compra é achado pelo telefone (nas duas formas do celular). */
  telefone: string;
}

/**
 * A venda vira compra, desfaz a compra (cancelada ou removida depois de
 * confirmada) ou fica de fora, com o motivo.
 */
export function compraDaVenda(
  v: VendaRegem,
  opcoes: { incluir99: boolean; cardapioWebDireto: boolean },
): CompraDoRegem | { desfazer: string } | { ignorado: MotivoIgnorado } {
  const id = String(v.id ?? '').trim();
  const situacao = canalNormalizado(v.situacao);
  if (situacao === 'cancelado' || situacao === 'removido') return { desfazer: id };
  if (situacao !== 'confirmado') return { ignorado: 'nao_confirmado' };

  const canal = canalNormalizado(v.canal);
  if (canal === CANAL_CARDAPIO_WEB && opcoes.cardapioWebDireto) return { ignorado: 'cardapio_web_duplicado' };
  if (CANAIS_DE_MARKETPLACE.has(canal) && !(canal === CANAL_99 && opcoes.incluir99)) return { ignorado: 'marketplace' };

  const telefone = telefoneDoRegem(v.cliente?.telefone);
  if (!telefone) return { ignorado: 'sem_cliente' };
  const feitaEm = data(v.faturado_em) ?? data(v.confirmado_em) ?? data(v.criado_em);
  if (!feitaEm) return { ignorado: 'sem_data' };

  const itens = (Array.isArray(v.itens) ? v.itens : [])
    .map((i) => ({ n: texto(i?.nome, 80) ?? '', q: Math.max(0, Number(i?.quantidade) || 0), v: centavos(i?.receita_centavos) }))
    .filter((i) => i.n && i.q > 0)
    .slice(0, 30);

  return {
    idExterno: id,
    telefone,
    feitaEm,
    valorCentavos: centavos(v.receita_centavos),
    tipo: tipoDaVenda(v.tipo),
    canal: texto(canal, 40),
    bairro: bairroDoRegem(v.bairro),
    itens,
    atualizadaNaFonte: data(v.atualizado_em),
  };
}

// ------------------------------------------------------------ ritmo

/** Itens por página pedidos ao Regem (o máximo do contrato). */
export const LIMITE_POR_PAGINA = 500;
/** Páginas por passo de uma conta — o token aceita 60 consultas por minuto. */
export const PAGINAS_POR_PASSO = 5;
/** Entre duas páginas do mesmo passo. */
export const PAUSA_ENTRE_PAGINAS_MS = 1_200;
/** Em dia: a consulta das mudanças sai a cada tantos minutos. */
export const MINUTOS_ENTRE_CONSULTAS = 30;
