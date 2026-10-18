/**
 * O erro que a telemetria grava vai também à lista de erros do hub da DMS (ligado só com `HUB_LIGADO`): na forma do
 * hub, sem a falha de envio de cada mensagem à Meta, com o código do pedido da porta MCP quando houver, e sem nunca
 * atrapalhar a gravação daqui.
 */
import { comChamada } from '../hub/chamada-atual';
import type { HubDosErros } from '../hub/hub.token';
import { erroParaOHub, TelemetriaService, type EventoDeErro } from './telemetria.service';

const TELEFONE = '+5521900000000';

describe('erroParaOHub', () => {
  it('o 500 da API: o tipo pelo status, o lugar pela rota sem parâmetros, a referência como código, o telefone mascarado', () => {
    expect(
      erroParaOHub({
        origem: 'api',
        status: 500,
        metodo: 'POST',
        rota: '/api/v1/campanhas/abc/disparar?pagina=2',
        referencia: 'ab12cd34',
        mensagem: `TypeError: falhou para ${TELEFONE}`,
      }),
    ).toEqual({ origem: 'backend', tipo: 'HTTP 500', mensagem: 'TypeError: falhou para ***0000', lugar: 'POST /api/v1/campanhas/abc/disparar', codigo: 'ab12cd34' });
  });

  it('o código do pedido da porta vence a referência', () => {
    expect(erroParaOHub({ origem: 'api', status: 500, referencia: 'ab12cd34', mensagem: 'x' }, 'rc_0123456789abcdef')?.codigo).toBe('rc_0123456789abcdef');
  });

  it('com a classe (Mercado Pago, e-mail): o tipo é a classe; sem rota, o lugar também', () => {
    expect(erroParaOHub({ origem: 'api', classe: 'email', status: 422, mensagem: 'Resend respondeu 422' })).toEqual({
      origem: 'backend',
      tipo: 'email',
      mensagem: 'Resend respondeu 422',
      lugar: 'email',
    });
  });

  it('a fila é rotina; sem status nem classe, o tipo diz a origem; sem mensagem, o marcador', () => {
    expect(erroParaOHub({ origem: 'fila' })).toEqual({ origem: 'rotina', tipo: 'erro de fila', mensagem: '(sem mensagem)', lugar: 'fila' });
  });

  it('a falha de envio de cada mensagem à Meta não vai (é resultado do envio, não defeito)', () => {
    expect(erroParaOHub({ origem: 'meta', classe: 'OAuthException', codigo: 131026, mensagem: 'Número sem WhatsApp' })).toBeNull();
  });
});

describe('TelemetriaService com o hub', () => {
  function montar(ligado: boolean, erro: jest.Mock = jest.fn()) {
    const gravados: unknown[] = [];
    const ctx = {
      comEscopoSistema: jest.fn(async (_nome: string, fn: (db: unknown) => Promise<unknown>) =>
        fn({ insert: () => ({ values: async (v: unknown) => void gravados.push(v) }) }),
      ),
    };
    const hub: HubDosErros = { ligado, erro };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { servico: new TelemetriaService(ctx as any, hub), gravados, erro };
  }
  const EVENTO: EventoDeErro = { origem: 'api', status: 500, metodo: 'GET', rota: '/api/v1/contas', referencia: 'ab12cd34', mensagem: 'Error: falhou' };

  it('ligado: grava aqui e anota no hub', async () => {
    const { servico, gravados, erro } = montar(true);
    await servico.registrar(EVENTO);
    expect(gravados).toHaveLength(1);
    expect(erro).toHaveBeenCalledWith({ origem: 'backend', tipo: 'HTTP 500', mensagem: 'Error: falhou', lugar: 'GET /api/v1/contas', codigo: 'ab12cd34' });
  });

  it('desligado: só grava aqui', async () => {
    const { servico, gravados, erro } = montar(false);
    await servico.registrar(EVENTO);
    expect(gravados).toHaveLength(1);
    expect(erro).not.toHaveBeenCalled();
  });

  it('dentro de uma chamada da porta MCP, o código é o do pedido', async () => {
    const { servico, erro } = montar(true);
    await comChamada({ codigo: 'rc_0123456789abcdef', inicio: Date.now() }, () => servico.registrar(EVENTO));
    expect(erro.mock.calls[0][0].codigo).toBe('rc_0123456789abcdef');
  });

  it('o hub que falha ao anotar não atrapalha a gravação daqui', async () => {
    const { servico, gravados } = montar(
      true,
      jest.fn(() => {
        throw new Error('fila do hub cheia');
      }),
    );
    await expect(servico.registrar(EVENTO)).resolves.toBeUndefined();
    expect(gravados).toHaveLength(1);
  });

  it('a falha de envio à Meta fica só aqui', async () => {
    const { servico, gravados, erro } = montar(true);
    await servico.registrar({ origem: 'meta', classe: 'OAuthException', mensagem: 'Número sem WhatsApp' });
    expect(gravados).toHaveLength(1);
    expect(erro).not.toHaveBeenCalled();
  });
});
