/**
 * O que a Meta diz sobre a cobrança de uma mensagem, lido do aviso de status.
 *
 * Cada status (`value.statuses[]`) traz, no aviso de envio e em mais um (entrega
 * ou leitura), o objeto `pricing`:
 *
 *   "pricing": { "billable": true, "pricing_model": "PMP",
 *                "type": "regular", "category": "marketing" }
 *
 * A Meta manda usar `type` e `category` juntos para saber se a mensagem é
 * cobrada — `billable` está marcado para sair numa versão futura, por isso não
 * é lido aqui. O valor em dinheiro não vem no aviso: sai da tabela de tarifas.
 *
 * Fonte: "Status messages webhook reference" da Meta, conferida em 01/10/2026.
 */

/** A cobrança por mensagem. O modelo antigo, por conversa (`CBP`), tinha outro significado. */
const MODELO_POR_MENSAGEM = 'PMP';

/**
 * Os valores são da Meta e a lista cresce sem aviso (`marketing_lite` e
 * `referral_conversion` entraram depois): valor novo é guardado como veio, e
 * quem consome trata o que não conhece. Só o FORMATO é conferido — texto curto,
 * minúsculo — para o banco não guardar lixo de um payload malformado.
 */
const VALOR_DA_META = /^[a-z][a-z0-9_-]{0,39}$/;

/**
 * A mensagem que a Meta cobra. Os outros tipos (`free_*`) saem de graça.
 *
 * A cobrança é na ENTREGA: cobrada é a mensagem com este tipo E com o status
 * `entregue` ou `lida`. Pelo status, não por `entregue_em` — o aviso de leitura
 * pode chegar sem o de entrega, e mensagem lida foi entregue.
 */
export const TARIFA_COBRADA = 'regular';

export interface TarifaDaMensagem {
  /** `pricing.type`: `regular` (cobrada), `free_customer_service`, `free_entry_point`. */
  tipo: string;
  /** `pricing.category`: `marketing`, `utility`, `authentication`… */
  categoria: string;
}

/**
 * A tarifa de um item de `statuses[]`, ou `null` quando o aviso não traz —
 * status sem `pricing` (o segundo entre entrega e leitura, e toda falha),
 * cobrança por conversa, ou campo fora do formato.
 */
export function tarifaDoStatus(status: unknown): TarifaDaMensagem | null {
  if (!status || typeof status !== 'object') return null;
  const pricing = (status as { pricing?: unknown }).pricing;
  if (!pricing || typeof pricing !== 'object') return null;

  const { pricing_model: modelo, type: tipo, category: categoria } = pricing as Record<string, unknown>;
  if (typeof modelo === 'string' && modelo !== MODELO_POR_MENSAGEM) return null;
  if (typeof tipo !== 'string' || !VALOR_DA_META.test(tipo)) return null;
  if (typeof categoria !== 'string' || !VALOR_DA_META.test(categoria)) return null;

  return { tipo, categoria };
}
