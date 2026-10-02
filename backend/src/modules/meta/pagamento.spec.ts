/**
 * O endereço da página de pagamento da conta do WhatsApp na Meta.
 *
 * É um botão que leva para fora, a uma página onde se cadastra cartão: o
 * endereço só existe com os dois identificadores certos, e só com dígitos — o
 * que vem do banco ou da Meta não pode virar outro endereço.
 */
import { linkDoPagamentoNaMeta } from './pagamento';

describe('linkDoPagamentoNaMeta', () => {
  it('monta o endereço da conta de pagamento do WhatsApp, com o negócio e a conta', () => {
    expect(linkDoPagamentoNaMeta('1578000000000001', '3237000000000001')).toBe(
      'https://business.facebook.com/billing_hub/accounts/details/?business_id=3237000000000001&asset_id=1578000000000001&account_type=whatsapp-business-account',
    );
  });

  it('sem o negócio dono da conta, não há endereço — melhor sem botão que com a página errada', () => {
    expect(linkDoPagamentoNaMeta('1578000000000001', null)).toBeNull();
    expect(linkDoPagamentoNaMeta('1578000000000001', '')).toBeNull();
    expect(linkDoPagamentoNaMeta(null, '3237000000000001')).toBeNull();
    expect(linkDoPagamentoNaMeta(undefined, undefined)).toBeNull();
  });

  it('só dígitos: identificador com outra coisa não entra no endereço', () => {
    expect(linkDoPagamentoNaMeta('157859&next=https://golpe.example', '3237000000000001')).toBeNull();
    expect(linkDoPagamentoNaMeta('1578000000000001', '32370/../x')).toBeNull();
    expect(linkDoPagamentoNaMeta('WABA-E2E', '3237000000000001')).toBeNull();
  });
});
