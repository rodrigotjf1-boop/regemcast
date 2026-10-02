/**
 * A recusa que chega DEPOIS do envio, pelo aviso de entrega da Meta.
 *
 * Foi assim que o 131042 (pagamento da conta não configurado) apareceu no teste
 * do dono, em 01/10/2026: a Meta aceitou a mensagem e recusou depois. Erro da
 * conta ou do modelo teria a mesma resposta na mensagem seguinte — a campanha
 * tem de parar, e não continuar sendo aceita e recusada até a fila acabar.
 */
// O serviço de avisos lê o ambiente no import; aqui o banco e os avisos são simulados.
jest.mock('../../config/env', () => ({ env: { push: { contaServico: '' } } }));

import { campanha, campanhaDestinatario, waConta } from '../../db/schema';
import { WebhookService } from './webhook.service';

const FRASE =
  'Message failed to send because your WhatsApp Business account currency is not configured. Visit https://business.facebook.com/billing_hub/accounts/details/?business_id=111 to resolve this issue.';

function montar(campanhasAtivas: Array<{ id: string; contaId: string; nome: string }> = [{ id: 'camp1', contaId: 'c1', nome: 'Sexta do Smash' }]) {
  const gravados: Array<{ tabela: unknown; valores: Record<string, unknown> }> = [];

  const db = {
    update: (tabela: unknown) => {
      const cadeia: Record<string, unknown> = {};
      cadeia.set = (valores: Record<string, unknown>) => {
        gravados.push({ tabela, valores });
        return cadeia;
      };
      cadeia.where = () => cadeia;
      cadeia.returning = async () =>
        tabela === campanhaDestinatario
          ? [{ contaId: 'c1', telefone: '5521999998888', campanhaId: 'camp1' }]
          : campanhasAtivas;
      return cadeia;
    },
    execute: jest.fn().mockResolvedValue({ rows: [] }),
  };

  const ctx = { comEscopoSistema: <T>(_motivo: string, fn: (d: typeof db) => Promise<T>) => fn(db) };
  const avisos = { avisar: jest.fn().mockResolvedValue(undefined) };
  const service = new WebhookService(ctx as never, {} as never, avisos as never, {} as never, {} as never, {} as never, {} as never);

  const falhar = (codigo: number, detalhes: string) =>
    (service as unknown as { mensagens(m: unknown): Promise<void> }).mensagens({
      value: {
        statuses: [{ id: 'wamid.X', status: 'failed', errors: [{ code: codigo, title: 't', error_data: { details: detalhes } }] }],
      },
    });

  const doDestinatario = () => gravados.find((g) => g.tabela === campanhaDestinatario)?.valores;
  const daCampanha = () => gravados.find((g) => g.tabela === campanha)?.valores;
  return { falhar, doDestinatario, daCampanha, avisos };
}

describe('recusa que chega pelo aviso da Meta', () => {
  it('131042 (pagamento): grava a falha com a frase da Meta à parte e pausa a campanha pela conta', async () => {
    const m = montar();
    await m.falhar(131042, FRASE);

    expect(m.doDestinatario()).toMatchObject({
      status: 'falhou',
      erroCodigo: 131042,
      erroTitulo: 'Falta acertar o pagamento na Meta',
      erroMeta: FRASE,
    });
    // A explicação gravada é a nossa, em português — nunca a frase da Meta.
    expect(String(m.doDestinatario()?.erroDetalhe)).not.toMatch(/Message failed|https?:/);

    expect(m.daCampanha()).toEqual({
      status: 'pausada',
      pausaMotivo: 'conta_meta',
      pausaErroCodigo: 131042,
      pausaErroMeta: FRASE,
    });
  });

  it('avisa o dono com o título e o que fazer', async () => {
    const m = montar();
    await m.falhar(131042, FRASE);

    expect(m.avisos.avisar).toHaveBeenCalledWith(
      'c1',
      'campanhas',
      expect.objectContaining({
        titulo: 'Campanha pausada: Sexta do Smash',
        corpo: expect.stringMatching(/^Falta acertar o pagamento na Meta\. Acerte o pagamento/),
        dados: { campanhaId: 'camp1' },
      }),
    );
  });

  it('campanha que já terminou não muda: nenhuma pausa, nenhum aviso', async () => {
    const m = montar([]);
    await m.falhar(131042, FRASE);

    expect(m.doDestinatario()).toMatchObject({ status: 'falhou', erroCodigo: 131042 });
    expect(m.avisos.avisar).not.toHaveBeenCalled();
  });

  it('modelo pausado pela Meta (132015) pausa pelo modelo', async () => {
    const m = montar();
    await m.falhar(132015, 'Template is paused');
    expect(m.daCampanha()).toMatchObject({ pausaMotivo: 'modelo', pausaErroCodigo: 132015 });
  });

  it.each([131026, 131049, 131050])('%d é da pessoa: a campanha segue', async (codigo) => {
    const m = montar();
    await m.falhar(codigo, 'x');

    expect(m.doDestinatario()).toMatchObject({ status: 'falhou', erroCodigo: codigo });
    expect(m.daCampanha()).toBeUndefined();
    expect(m.avisos.avisar).not.toHaveBeenCalled();
  });
});

/**
 * O aviso `account_update`. Até 01/10/2026 só ia para o log: a Meta restringia
 * a conta e a tela continuava dizendo "Conectada".
 */
describe('mudança na conta (account_update)', () => {
  function montarConta() {
    const gravados: Array<{ tabela: unknown; valores: Record<string, unknown> }> = [];
    const db = {
      update: (tabela: unknown) => {
        const cadeia: Record<string, unknown> = {};
        cadeia.set = (valores: Record<string, unknown>) => {
          gravados.push({ tabela, valores });
          return cadeia;
        };
        cadeia.where = () => cadeia;
        cadeia.then = (r: (v: unknown[]) => void) => r([]);
        return cadeia;
      },
    };
    const ctx = { comEscopoSistema: <T>(_m: string, fn: (d: typeof db) => Promise<T>) => fn(db) };
    const saude = { atualizarDoSistema: jest.fn().mockResolvedValue({ leu: true, credencial: false }) };
    const service = new WebhookService(ctx as never, {} as never, {} as never, {} as never, {} as never, saude as never, {} as never);
    const avisar = (value: Record<string, unknown>, entrada: string | undefined = '1578000000000001') =>
      (service as unknown as { contaAtualizada(m: unknown): Promise<void> }).contaAtualizada({ field: 'account_update', value, entrada });
    return { avisar, saude, gravados };
  }

  it.each(['ACCOUNT_RESTRICTION', 'ACCOUNT_VIOLATION', 'DISABLED_UPDATE', 'ACCOUNT_DELETED', 'PARTNER_REMOVED', 'PARTNER_APP_UNINSTALLED'])(
    '%s: relê a saúde da conta na hora — é ela que diz se dá para enviar',
    async (event) => {
      const m = montarConta();
      await m.avisar({ event });
      expect(m.saude.atualizarDoSistema).toHaveBeenCalledWith({ wabaId: '1578000000000001' });
    },
  );

  it('a decisão da revisão da conta (account_review_update) também relê', async () => {
    const m = montarConta();
    await m.avisar({ decision: 'REJECTED' });
    expect(m.saude.atualizarDoSistema).toHaveBeenCalledTimes(1);
  });

  it.each(['VOLUME_BASED_PRICING_TIER_UPDATE', 'BUSINESS_PRIMARY_LOCATION_COUNTRY_UPDATE', 'PARTNER_ADDED', 'AUTH_INTL_PRICE_ELIGIBILITY_UPDATE'])(
    '%s é só informativo: não gasta uma leitura',
    async (event) => {
      const m = montarConta();
      await m.avisar({ event });
      expect(m.saude.atualizarDoSistema).not.toHaveBeenCalled();
    },
  );

  it('guarda o negócio dono da conta quando o aviso o traz (é com ele que se monta o link do pagamento)', async () => {
    const m = montarConta();
    await m.avisar({ event: 'PARTNER_APP_INSTALLED', waba_info: { waba_id: '1578000000000001', owner_business_id: '3237000000000001' } });

    expect(m.gravados).toEqual([{ tabela: waConta, valores: { businessId: '3237000000000001' } }]);
    // E, sendo informativo, não relê a saúde.
    expect(m.saude.atualizarDoSistema).not.toHaveBeenCalled();
  });

  it('identificador de negócio que não é número não entra', async () => {
    const m = montarConta();
    await m.avisar({ event: 'PARTNER_APP_INSTALLED', waba_info: { owner_business_id: '123/../x' } });
    expect(m.gravados).toHaveLength(0);
  });

  it('sem saber de qual conta é, não faz nada', async () => {
    const m = montarConta();
    await m.avisar({ event: 'ACCOUNT_RESTRICTION' }, '');
    expect(m.saude.atualizarDoSistema).not.toHaveBeenCalled();
  });
});
