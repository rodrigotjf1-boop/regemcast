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

function recusa(status: number, codigo: number, mensagem: string) {
  const corpo = { error: { code: codigo, message: mensagem, type: 'OAuthException' } };
  return {
    ok: false,
    status,
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

  it('pede junto os sinais do modelo: a qualidade e a categoria que a Meta considera certa', async () => {
    const urls: URL[] = [];
    global.fetch = jest.fn(async (url: string | URL) => {
      urls.push(new URL(String(url)));
      return resposta({ data: [{ ...modelo(1), quality_score: { score: 'YELLOW', date: 1746082800 }, correct_category: 'MARKETING' }] });
    }) as unknown as typeof fetch;

    const r = await new GraphService().modelosDaWaba('WABA1', TOKEN);

    expect(urls[0].searchParams.get('fields')).toBe(
      'id,name,language,status,category,components,rejected_reason,quality_score,correct_category,previous_category',
    );
    expect(r.data[0].quality_score).toEqual({ score: 'YELLOW', date: 1746082800 });
  });

  it('a Meta recusa os campos dos sinais (#100): a lista vem sem eles, em vez de cair', async () => {
    // A lista é o que deixa montar campanha: um campo a mais não pode derrubá-la.
    const aviso = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const campos: Array<string | null> = [];
    global.fetch = jest.fn(async (url: string | URL) => {
      const pedidos = new URL(String(url)).searchParams.get('fields');
      campos.push(pedidos);
      return pedidos?.includes('quality_score')
        ? recusa(400, 100, '(#100) Tried accessing nonexisting field (quality_score)')
        : resposta({ data: [modelo(1), modelo(2)] });
    }) as unknown as typeof fetch;

    const r = await new GraphService().modelosDaWaba('WABA1', TOKEN);

    expect(r.data.map((m) => m.id)).toEqual(['1', '2']);
    expect(campos).toEqual([
      'id,name,language,status,category,components,rejected_reason,quality_score,correct_category,previous_category',
      'id,name,language,status,category,components,rejected_reason',
    ]);
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('recusou os campos dos sinais'));
  });

  it('recusados uma vez, as páginas seguintes já pedem sem os sinais', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const campos: Array<string | null> = [];
    global.fetch = jest.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      const pedidos = u.searchParams.get('fields');
      campos.push(pedidos);
      if (pedidos?.includes('quality_score')) return recusa(400, 100, '(#100) Tried accessing nonexisting field');
      return u.searchParams.get('after')
        ? resposta({ data: [modelo(2)] })
        : resposta({ data: [modelo(1)], paging: { cursors: { after: 'c1' }, next: 'https://graph.facebook.com/proxima' } });
    }) as unknown as typeof fetch;

    const r = await new GraphService().modelosDaWaba('WABA1', TOKEN);

    expect(r.data.map((m) => m.id)).toEqual(['1', '2']);
    expect(campos.filter((c) => c?.includes('quality_score'))).toHaveLength(1);
    expect(campos).toHaveLength(3);
  });

  it('outro erro da Meta não é engolido: sobe como antes', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const chamada = jest.fn(async () => recusa(401, 190, 'Error validating access token'));
    global.fetch = chamada as unknown as typeof fetch;

    await expect(new GraphService().modelosDaWaba('WABA1', TOKEN)).rejects.toMatchObject({ codigo: 190 });
    expect(chamada).toHaveBeenCalledTimes(1);
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
