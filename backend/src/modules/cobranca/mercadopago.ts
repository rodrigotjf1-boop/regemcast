/**
 * O que é regra do Mercado Pago, sem rede e sem banco — testável sozinho.
 *
 * - **Assinatura do aviso (webhook).** O Mercado Pago assina cada aviso com
 *   HMAC-SHA256 da chave secreta sobre um "manifesto" montado com o id do
 *   recurso, o `x-request-id` e o `ts` do cabeçalho `x-signature`. Campo que não
 *   veio sai do manifesto. Aviso sem assinatura conferida não mexe em nada.
 * - **Tradução dos estados.** O Mercado Pago tem os seus nomes (authorized,
 *   recycling, rejected…); o sistema fala os nossos. A tradução fica num lugar só.
 *
 * Fonte: developers do Mercado Pago — Webhooks (validação da origem) e API de
 * assinaturas (preapproval e authorized_payments).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface CabecalhoAssinatura {
  ts: string;
  v1: string;
}

/** `ts=1704908010,v1=618c85...` → { ts, v1 }. Formato estranho vira null. */
export function lerXSignature(bruto: string | undefined | null): CabecalhoAssinatura | null {
  if (!bruto) return null;
  let ts = '';
  let v1 = '';
  for (const parte of bruto.split(',')) {
    const [chave, ...resto] = parte.split('=');
    const valor = resto.join('=').trim();
    if (chave?.trim() === 'ts') ts = valor;
    if (chave?.trim() === 'v1') v1 = valor;
  }
  return ts && v1 ? { ts, v1 } : null;
}

/** O manifesto que o Mercado Pago assina. Campos ausentes saem do texto. */
export function manifestoDoAviso(dataId: string | undefined, requestId: string | undefined, ts: string): string {
  let m = '';
  // Id alfanumérico vai em minúsculas, como a documentação manda.
  if (dataId) m += `id:${/[a-z]/i.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (requestId) m += `request-id:${requestId};`;
  m += `ts:${ts};`;
  return m;
}

/** A assinatura do aviso confere com o segredo? Comparação em tempo constante. */
export function avisoAutentico(dados: {
  xSignature: string | undefined;
  xRequestId: string | undefined;
  dataId: string | undefined;
  segredo: string;
}): boolean {
  if (!dados.segredo) return false;
  const cab = lerXSignature(dados.xSignature);
  if (!cab) return false;

  const esperado = createHmac('sha256', dados.segredo)
    .update(manifestoDoAviso(dados.dataId, dados.xRequestId, cab.ts))
    .digest('hex');

  const a = Buffer.from(esperado, 'utf8');
  const b = Buffer.from(cab.v1.toLowerCase(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export type StatusCobranca = 'pendente' | 'aprovada' | 'recusada' | 'cancelada' | 'estornada';

/**
 * O estado de uma fatura (authorized_payment) em linguagem nossa.
 *
 * Quem manda é o PAGAMENTO dentro da fatura, quando existe: a fatura pode estar
 * "processed" com o pagamento recusado. Sem pagamento, vale o estado da fatura.
 */
export function statusDaFatura(fatura: {
  status?: string | null;
  payment?: { status?: string | null } | null;
}): StatusCobranca {
  const pagamento = fatura.payment?.status ?? null;
  if (pagamento) {
    if (pagamento === 'approved' || pagamento === 'authorized') return 'aprovada';
    if (pagamento === 'refunded' || pagamento === 'charged_back') return 'estornada';
    if (pagamento === 'rejected') return 'recusada';
    if (pagamento === 'cancelled') return fatura.status === 'recycling' ? 'recusada' : 'cancelada';
    return 'pendente';
  }
  if (fatura.status === 'cancelled') return 'cancelada';
  if (fatura.status === 'recycling') return 'recusada';
  return 'pendente';
}

/** Motivo da recusa em texto que o cliente entende. O detalhe técnico vai para o log. */
export function motivoDaRecusa(statusDetail: string | null | undefined): string {
  switch (statusDetail) {
    case 'cc_rejected_insufficient_amount':
      return 'Saldo ou limite insuficiente.';
    case 'cc_rejected_card_disabled':
      return 'O cartão está desativado. Fale com o banco ou troque o cartão.';
    case 'cc_rejected_bad_filled_security_code':
    case 'cc_rejected_bad_filled_date':
    case 'cc_rejected_bad_filled_other':
      return 'Algum dado do cartão está errado. Atualize o meio de pagamento.';
    case 'cc_rejected_call_for_authorize':
      return 'O banco pediu autorização. Fale com o banco e tente de novo.';
    case 'cc_rejected_high_risk':
      return 'O pagamento foi recusado pela análise de segurança. Tente outro meio.';
    default:
      return 'O pagamento não foi aprovado. Confira o meio de pagamento no Mercado Pago.';
  }
}

/** R$ 99,00 → 9900. O Mercado Pago trabalha com valor decimal em reais. */
export function paraReais(centavos: number): number {
  return Math.round(centavos) / 100;
}

export function paraCentavos(reais: number | string | null | undefined): number {
  const n = Number(reais ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
