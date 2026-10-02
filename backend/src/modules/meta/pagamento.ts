/**
 * A página de pagamento da conta do WhatsApp, na Meta.
 *
 * A Meta cobra as mensagens direto da conta do WhatsApp Business do cliente: a
 * forma de pagamento, a moeda e o fuso ficam lá, não aqui. Sem isso em ordem ela
 * aceita a mensagem e a recusa em seguida (131042).
 *
 * O endereço é o que a própria Meta manda na frase desse erro — o da conta de
 * pagamento do WhatsApp no gerenciador de negócios —, sem o parâmetro que abre o
 * assistente de moeda (`wizard_name`): ela nem sempre o manda (em 01/10/2026 a
 * primeira recusa veio com o endereço, a segunda sem), e a tela não pode
 * depender disso para ter o botão.
 *
 * Precisa dos dois identificadores: o da conta do WhatsApp (WABA) e o do
 * portfólio de negócios dono dela. Sem um deles, não há endereço — e a tela fica
 * só com a explicação, em vez de um botão que abre a página errada.
 */
export function linkDoPagamentoNaMeta(
  wabaId: string | null | undefined,
  businessId: string | null | undefined,
): string | null {
  const so = (v: string | null | undefined) => (v && /^\d{5,30}$/.test(v) ? v : null);
  const conta = so(wabaId);
  const negocio = so(businessId);
  if (!conta || !negocio) return null;
  return `https://business.facebook.com/billing_hub/accounts/details/?business_id=${negocio}&asset_id=${conta}&account_type=whatsapp-business-account`;
}

/** O rótulo do botão, em todo lugar onde ele aparece. */
export const ROTULO_DO_PAGAMENTO_NA_META = 'Abrir o pagamento na Meta';
