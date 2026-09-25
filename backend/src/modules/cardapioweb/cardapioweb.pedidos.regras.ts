/**
 * Pedidos do Cardápio Web → compras do Regemcast. Regras puras, sem banco nem
 * rede.
 *
 * Formatos conferidos na documentação oficial em 25/09/2026
 * (docs.cardapioweb.com — histórico, detalhe e consulta de pedidos):
 *
 * - `GET /orders/history` — só fechados e cancelados, início até 3 anos atrás,
 *   janela de até 6 meses, 100 por página, 5 consultas por minuto, SEM o
 *   cliente;
 * - `GET /orders/{id}` — o pedido inteiro: cliente, total (reais, decimal),
 *   tipo, bairro, itens;
 * - `GET /orders?updated_since=` — os alterados nas últimas 8 HORAS, seja qual
 *   for o `updated_since` (que aceita até 24 h), sem paginação.
 *
 * O que vira compra: pedido FECHADO, de canal próprio da loja (marketplace
 * fica fora — o cliente é do marketplace e o telefone vem mascarado), com
 * telefone utilizável. O resto é ignorado e contado.
 */
import { telefoneDoCliente } from './cardapioweb.regras';

/** Pedido como o histórico e a consulta periódica devolvem. */
export interface PedidoResumo {
  id: number | string;
  status?: string | null;
  order_type?: string | null;
  sales_channel?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PaginaPedidos {
  orders: PedidoResumo[];
  pagination: { current_page: number; total_pages: number; total_orders: number };
}

/** O pedido inteiro, `GET /orders/{id}` — só os campos que usamos. */
export interface PedidoDetalhe extends PedidoResumo {
  total?: number | string | null;
  customer?: { id?: number | string | null; name?: string | null; phone?: string | null; ddi?: string | null } | null;
  delivery_address?: { neighborhood?: string | null } | null;
  items?: Array<{ name?: string | null; quantity?: number | string | null; total_price?: number | string | null }> | null;
}

/** Canais cujo cliente é do marketplace (telefone mascarado, termos do marketplace). */
export const CANAIS_DE_MARKETPLACE = new Set(['ifood', 'food99', '99food', 'keeta', 'aiqfome']);

export type TipoDaCompra = 'entrega' | 'retirada' | 'salao' | 'outro';

export interface ItemDaCompra {
  /** nome */
  n: string;
  /** quantidade */
  q: number;
  /** valor em centavos */
  v: number;
}

export interface CompraNormalizada {
  idExterno: string;
  telefone: string;
  clienteId: string | null;
  nome: string | null;
  feitaEm: Date;
  valorCentavos: number;
  tipo: TipoDaCompra;
  canal: string | null;
  bairro: string | null;
  itens: ItemDaCompra[];
  atualizadaNaFonte: Date | null;
}

export type MotivoIgnorado = 'nao_fechado' | 'marketplace' | 'sem_telefone' | 'sem_data';

/** Reais (decimal, número ou texto) → centavos inteiros. `103.8` vira 10380, nunca 10379. */
export function centavos(valor: unknown): number {
  const n = typeof valor === 'string' ? Number(valor.replace(',', '.')) : Number(valor);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export function tipoDaCompra(orderType: unknown): TipoDaCompra {
  switch (orderType) {
    case 'delivery':
      return 'entrega';
    case 'takeout':
      return 'retirada';
    case 'onsite':
    case 'closed_table':
      return 'salao';
    default:
      return 'outro';
  }
}

function data(bruto: unknown): Date | null {
  if (typeof bruto !== 'string' || !bruto) return null;
  const d = new Date(bruto);
  return Number.isNaN(d.getTime()) ? null : d;
}

function texto(bruto: unknown, maximo: number): string | null {
  const t = typeof bruto === 'string' ? bruto.replace(/\s+/g, ' ').trim() : '';
  return t ? t.slice(0, maximo) : null;
}

export function ehMarketplace(p: Pick<PedidoResumo, 'sales_channel'>): boolean {
  return CANAIS_DE_MARKETPLACE.has(String(p.sales_channel ?? '').toLowerCase());
}

/** O pedido vira compra — ou o motivo de ficar de fora. */
export function compraDoPedido(p: PedidoDetalhe): CompraNormalizada | { ignorado: MotivoIgnorado } {
  if (p.status !== 'closed') return { ignorado: 'nao_fechado' };
  if (ehMarketplace(p)) return { ignorado: 'marketplace' };
  const telefone = p.customer ? telefoneDoCliente({ phone_number: p.customer.phone, ddi: p.customer.ddi }) : '';
  if (!telefone) return { ignorado: 'sem_telefone' };
  const feitaEm = data(p.created_at);
  if (!feitaEm) return { ignorado: 'sem_data' };

  const itens = (Array.isArray(p.items) ? p.items : [])
    .map((i) => ({ n: texto(i.name, 80) ?? '', q: Math.max(0, Number(i.quantity) || 0), v: centavos(i.total_price) }))
    .filter((i) => i.n && i.q > 0)
    .slice(0, 30);

  const clienteId = p.customer?.id;
  return {
    idExterno: String(p.id),
    telefone,
    clienteId: clienteId === null || clienteId === undefined ? null : String(clienteId),
    nome: texto(p.customer?.name, 120),
    feitaEm,
    valorCentavos: centavos(p.total),
    tipo: tipoDaCompra(p.order_type),
    canal: texto(p.sales_channel, 40),
    bairro: texto(p.delivery_address?.neighborhood, 80),
    itens,
    atualizadaNaFonte: data(p.updated_at),
  };
}

/** Quantos anos de histórico a carga pede. O Cardápio Web aceita 3 (medido: 35 meses sim, 37 não). */
export const ANOS_DE_HISTORICO = 3;
/** Folga no limite de 3 anos: a carga de loja grande leva horas, e o limite conta de hoje. */
const DIAS_DE_FOLGA_NO_LIMITE = 2;

/** O início mais antigo que o Cardápio Web aceita hoje, com folga. */
export function inicioMaisAntigo(agora: Date): Date {
  const d = new Date(agora);
  d.setFullYear(d.getFullYear() - ANOS_DE_HISTORICO);
  return new Date(d.getTime() + DIAS_DE_FOLGA_NO_LIMITE * 86_400_000);
}

/**
 * A consulta de alterados só devolve as últimas 8 h. Consulta parada há mais
 * que isso (com 1 h de folga) perde pedidos: o buraco vai para a carga.
 */
export const HORAS_MAXIMAS_DE_CONSULTA = 7;
/** A janela da consulta de histórico: a API aceita até 6 meses; 180 dias fica dentro com folga. */
export const DIAS_POR_JANELA = 180;

/** O fim da janela que começa em `de`, sem passar do fim da carga. */
export function fimDaJanela(de: Date, fimDaCarga: Date): Date {
  const fim = new Date(de.getTime() + DIAS_POR_JANELA * 86_400_000);
  return fim < fimDaCarga ? fim : fimDaCarga;
}

/** Quanto da carga já foi (0 a 100), pela posição da janela no período. */
export function progressoDaCarga(de: Date, ate: Date, janelaDe: Date, pagina: number, totalPaginas: number | null): number {
  const total = ate.getTime() - de.getTime();
  if (total <= 0) return 100;
  const janela = Math.min(DIAS_POR_JANELA * 86_400_000, ate.getTime() - janelaDe.getTime());
  const dentro = totalPaginas && totalPaginas > 0 ? Math.min(1, pagina / totalPaginas) : 0;
  const andado = janelaDe.getTime() - de.getTime() + janela * dentro;
  return Math.max(0, Math.min(100, Math.floor((andado / total) * 100)));
}
