/**
 * A lista de modelos segue o cursor da Graph até o fim — o `fetch` é dublê.
 *
 * A campanha confere o modelo escolhido contra esta lista: parar na primeira
 * página faria o modelo nº 201 de uma conta grande "não existir", e a campanha
 * dele seria recusada sem motivo.
 */
jest.mock('../../config/env', () => ({
  env: { meta: { appId: '123', appSecret: 'segredo', graphVersao: 'v26.0' } },
}));

import { Logger } from '@nestjs/common';

import { GraphService } from './graph.service';

const TOKEN = 'token-do-cliente';

function resposta(corpo: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => corpo,
    text: async () => JSON.stringify(corpo),
  } as unknown as Response;
}

const modelo = (n: number) => ({ id: String(n), name: `modelo_${n}`, language: 'pt_BR', status: 'APPROVED' });

describe('GraphService.modelosDaWaba', () => {
  const fetchOriginal = global.fetch;
  afterEach(() => {
    global.fetch = fetchOriginal;
    jest.restoreAllMocks();
  });

  it('uma página só: uma chamada, sem cursor', async () => {
    const urls: URL[] = [];
    global.fetch = jest.fn(async (url: string | URL) => {
      urls.push(new URL(String(url)));
      // O cursor `after` vem sempre; é o `next` que diz se há mais.
      return resposta({ data: [modelo(1), modelo(2)], paging: { cursors: { before: 'a', after: 'b' } } });
    }) as unknown as typeof fetch;

    const r = await new GraphService().modelosDaWaba('WABA1', TOKEN);

    expect(r.data.map((m) => m.id)).toEqual(['1', '2']);
    expect(urls).toHaveLength(1);
    expect(urls[0].pathname).toContain('/WABA1/message_templates');
    expect(urls[0].searchParams.get('limit')).toBe('200');
    expect(urls[0].searchParams.has('after')).toBe(false);
  });

  it('segue o cursor enquanto a Meta disser que há mais, e junta tudo na ordem', async () => {
    const cursores: Array<string | null> = [];
    const paginas: Record<string, unknown> = {
      inicio: { data: [modelo(1), modelo(2)], paging: { cursors: { after: 'c1' }, next: 'https://graph.facebook.com/proxima' } },
      c1: { data: [modelo(3)], paging: { cursors: { after: 'c2' }, next: 'https://graph.facebook.com/proxima' } },
      c2: { data: [modelo(4)], paging: { cursors: { after: 'c3' } } },
    };
    global.fetch = jest.fn(async (url: string | URL) => {
      const after = new URL(String(url)).searchParams.get('after');
      cursores.push(after);
      return resposta(paginas[after ?? 'inicio']);
    }) as unknown as typeof fetch;

    const r = await new GraphService().modelosDaWaba('WABA1', TOKEN);

    expect(r.data.map((m) => m.id)).toEqual(['1', '2', '3', '4']);
    expect(cursores).toEqual([null, 'c1', 'c2']);
  });

  it('conta sem modelo nenhum devolve lista vazia', async () => {
    global.fetch = jest.fn(async () => resposta({ data: [] })) as unknown as typeof fetch;
    expect((await new GraphService().modelosDaWaba('WABA1', TOKEN)).data).toEqual([]);
  });

  it('cursor que não acaba: para no teto de páginas e registra, em vez de girar para sempre', async () => {
    const aviso = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const chamada = jest.fn(async () =>
      resposta({ data: [modelo(1)], paging: { cursors: { after: 'de-novo' }, next: 'https://graph.facebook.com/proxima' } }),
    );
    global.fetch = chamada as unknown as typeof fetch;

    const r = await new GraphService().modelosDaWaba('WABA1', TOKEN);

    expect(chamada).toHaveBeenCalledTimes(30);
    expect(r.data).toHaveLength(30);
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('30 páginas'));
  });
});
