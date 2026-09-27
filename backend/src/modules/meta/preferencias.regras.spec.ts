/**
 * O aviso `user_preferences` com o payload COMPLETO do exemplo oficial (V1 do
 * livro de erros: testar o leitor com todos os níveis, como a Meta manda).
 */
import { preferenciasDoAviso } from './preferencias.regras';

/** O exemplo da documentação oficial (webhooks/reference/user_preferences), conferido em 26/09/2026. */
const EXEMPLO_OFICIAL = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' },
            contacts: [{ wa_id: '16505551234' }],
            user_preferences: [
              {
                wa_id: '16505551234',
                detail: 'User requested to resume marketing messages',
                category: 'marketing_messages',
                value: 'resume',
                timestamp: 1731705721,
              },
            ],
          },
          field: 'user_preferences',
        },
      ],
    },
  ],
};

const valorDe = (aviso: typeof EXEMPLO_OFICIAL) => aviso.entry[0]!.changes[0]!.value as unknown as Record<string, unknown>;

describe('preferenciasDoAviso', () => {
  it('lê o exemplo oficial: voltou a aceitar marketing', () => {
    expect(preferenciasDoAviso(valorDe(EXEMPLO_OFICIAL))).toEqual([{ telefone: '16505551234', acao: 'voltar' }]);
  });

  it('stop vira "parar"', () => {
    const v = { user_preferences: [{ wa_id: '5521988887777', category: 'marketing_messages', value: 'stop', timestamp: 10 }] };
    expect(preferenciasDoAviso(v)).toEqual([{ telefone: '5521988887777', acao: 'parar' }]);
  });

  it('parou e voltou no mesmo aviso: vale a ordem do horário, não a da lista', () => {
    const v = {
      user_preferences: [
        { wa_id: '5521988887777', category: 'marketing_messages', value: 'resume', timestamp: 20 },
        { wa_id: '5521988887777', category: 'marketing_messages', value: 'stop', timestamp: 10 },
      ],
    };
    expect(preferenciasDoAviso(v).map((p) => p.acao)).toEqual(['parar', 'voltar']);
  });

  it('categoria, ação ou telefone desconhecidos ficam de fora — nunca viram bloqueio', () => {
    const v = {
      user_preferences: [
        { wa_id: '5521988887777', category: 'offers', value: 'stop' },
        { wa_id: '5521988887777', category: 'marketing_messages', value: 'interested' },
        { wa_id: '', category: 'marketing_messages', value: 'stop' },
        null,
        'lixo',
      ],
    };
    expect(preferenciasDoAviso(v)).toEqual([]);
  });

  it('sem a lista, nada', () => {
    expect(preferenciasDoAviso({})).toEqual([]);
    expect(preferenciasDoAviso({ user_preferences: 'x' })).toEqual([]);
  });
});
