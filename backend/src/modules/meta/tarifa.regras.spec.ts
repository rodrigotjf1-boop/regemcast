/**
 * A tarifa que a Meta informa em cada aviso de status.
 *
 * Os avisos abaixo são os exemplos da documentação da Meta ("Status messages
 * webhook reference", conferida em 01/10/2026), com todos os níveis — o leitor
 * é testado com o aviso inteiro, não com um pedaço montado à mão (ERR-001).
 */
import { TARIFA_COBRADA, tarifaDoStatus } from './tarifa.regras';

/** O exemplo oficial: mensagem de marketing enviada, cobrada por mensagem. */
const AVISO_OFICIAL = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' },
            statuses: [
              {
                id: 'wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=',
                status: 'sent',
                timestamp: '1750030073',
                recipient_id: '16505551234',
                conversation: {
                  id: '72b14d6bd5407799e66f64d1b338e567',
                  expiration_timestamp: '1750116480',
                  origin: { type: 'marketing' },
                },
                pricing: { billable: true, pricing_model: 'PMP', type: 'regular', category: 'marketing' },
              },
            ],
          },
          field: 'messages',
        },
      ],
    },
  ],
};

const statusOficial = () => AVISO_OFICIAL.entry[0].changes[0].value.statuses[0];
const comPricing = (pricing: unknown) => ({ ...statusOficial(), pricing });

describe('tarifaDoStatus', () => {
  it('lê tipo e categoria do exemplo oficial da Meta', () => {
    expect(tarifaDoStatus(statusOficial())).toEqual({ tipo: 'regular', categoria: 'marketing' });
    expect(tarifaDoStatus(statusOficial())?.tipo).toBe(TARIFA_COBRADA);
  });

  it('lê a mensagem de graça dentro da janela de atendimento', () => {
    const gratis = comPricing({
      billable: false,
      pricing_model: 'PMP',
      type: 'free_customer_service',
      category: 'service',
    });
    expect(tarifaDoStatus(gratis)).toEqual({ tipo: 'free_customer_service', categoria: 'service' });
  });

  it.each(['utility', 'authentication', 'authentication-international', 'marketing_lite', 'referral_conversion'])(
    'guarda a categoria "%s" como veio',
    (category) => {
      expect(tarifaDoStatus(comPricing({ pricing_model: 'PMP', type: 'regular', category }))?.categoria).toBe(category);
    },
  );

  it('guarda um tipo que a Meta venha a criar, em vez de perder a informação', () => {
    const novo = comPricing({ pricing_model: 'PMP', type: 'free_tipo_novo', category: 'marketing' });
    expect(tarifaDoStatus(novo)).toEqual({ tipo: 'free_tipo_novo', categoria: 'marketing' });
  });

  it('não depende de `billable`, que a Meta vai tirar', () => {
    const semBillable = comPricing({ pricing_model: 'PMP', type: 'regular', category: 'utility' });
    expect(tarifaDoStatus(semBillable)).toEqual({ tipo: 'regular', categoria: 'utility' });
  });

  it('não lê tarifa de status sem `pricing` (o segundo aviso, ou uma falha)', () => {
    const semPricing: Record<string, unknown> = { ...statusOficial() };
    delete semPricing.pricing;
    expect(tarifaDoStatus(semPricing)).toBeNull();
    expect(tarifaDoStatus({ id: 'wamid.x', status: 'failed', errors: [{ code: 131026 }] })).toBeNull();
  });

  it('ignora a cobrança antiga por conversa: lá `regular` queria dizer outra coisa', () => {
    expect(tarifaDoStatus(comPricing({ billable: true, pricing_model: 'CBP', category: 'marketing' }))).toBeNull();
    expect(
      tarifaDoStatus(comPricing({ billable: true, pricing_model: 'CBP', type: 'regular', category: 'marketing' })),
    ).toBeNull();
  });

  it.each([
    ['tipo ausente', { pricing_model: 'PMP', category: 'marketing' }],
    ['categoria ausente', { pricing_model: 'PMP', type: 'regular' }],
    ['tipo que não é texto', { pricing_model: 'PMP', type: 1, category: 'marketing' }],
    ['categoria vazia', { pricing_model: 'PMP', type: 'regular', category: '' }],
    ['texto longo demais', { pricing_model: 'PMP', type: 'regular', category: 'a'.repeat(41) }],
    ['texto com espaço ou maiúscula', { pricing_model: 'PMP', type: 'Regular Price', category: 'marketing' }],
  ])('não grava lixo: %s', (_caso, pricing) => {
    expect(tarifaDoStatus(comPricing(pricing))).toBeNull();
  });

  it.each([null, undefined, 'texto', 7, [], { pricing: null }, { pricing: 'x' }])(
    'aguenta aviso malformado (%p) sem estourar',
    (entrada) => {
      expect(tarifaDoStatus(entrada)).toBeNull();
    },
  );
});
