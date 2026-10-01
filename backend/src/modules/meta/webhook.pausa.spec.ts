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

import { campanha, campanhaDestinatario } from '../../db/schema';
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
  const service = new WebhookService(ctx as never, {} as never, avisos as never, {} as never, {} as never);

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
