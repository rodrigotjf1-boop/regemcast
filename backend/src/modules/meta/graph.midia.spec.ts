/**
 * Download de mídia e envio de texto pela Graph — o `fetch` é dublê.
 *
 * O que estes testes trancam é o que protege o servidor: o endereço devolvido
 * pela Meta só é seguido se for da Meta, e arquivo acima do teto não entra na
 * memória.
 */
jest.mock('../../config/env', () => ({
  env: { meta: { appId: '123', appSecret: 'segredo', graphVersao: 'v26.0' } },
}));

import { ErroMidia, GraphService } from './graph.service';

const TOKEN = 'token-do-cliente';

function resposta(corpo: unknown, init: { status?: number; headers?: Record<string, string>; binario?: Buffer } = {}) {
  const status = init.status ?? 200;
  const headers = new Headers(init.headers ?? { 'content-type': 'application/json' });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => corpo,
    text: async () => JSON.stringify(corpo),
    arrayBuffer: async () => {
      const b = init.binario ?? Buffer.alloc(0);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
  } as unknown as Response;
}

describe('GraphService.baixarMidia', () => {
  const fetchOriginal = global.fetch;
  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  it('segue o endereço da Meta com o token no cabeçalho e devolve os bytes', async () => {
    const chamadas: Array<{ url: string; auth: string | null }> = [];
    global.fetch = jest.fn(async (url: string | URL, init?: RequestInit) => {
      chamadas.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
      if (String(url).includes('graph.facebook.com')) {
        return resposta({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'image/jpeg', file_size: 3 });
      }
      return resposta(null, { headers: { 'content-type': 'image/jpeg', 'content-length': '3' }, binario: Buffer.from('abc') });
    }) as unknown as typeof fetch;

    const r = await new GraphService().baixarMidia('MIDIA1', TOKEN, 1024);

    expect(r.tipoMime).toBe('image/jpeg');
    expect(r.conteudo.toString()).toBe('abc');
    expect(chamadas[1]).toEqual({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', auth: `Bearer ${TOKEN}` });
  });

  it('recusa endereço que não é da Meta — nada de seguir para onde a resposta mandar', async () => {
    const fetchMock = jest.fn(async () => resposta({ url: 'https://atacante.exemplo/roubar', mime_type: 'image/jpeg' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(new GraphService().baixarMidia('MIDIA1', TOKEN, 1024)).rejects.toBeInstanceOf(ErroMidia);
    // Só a consulta à Graph: o endereço estranho nunca é chamado (e o token não vaza para ele).
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recusa domínio parecido com o da Meta', async () => {
    global.fetch = jest.fn(async () => resposta({ url: 'https://fbsbx.com.atacante.exemplo/x' })) as unknown as typeof fetch;
    await expect(new GraphService().baixarMidia('MIDIA1', TOKEN, 1024)).rejects.toBeInstanceOf(ErroMidia);
  });

  it('arquivo acima do teto é recusado antes de baixar', async () => {
    const fetchMock = jest.fn(async () =>
      resposta({ url: 'https://lookaside.fbsbx.com/x', mime_type: 'video/mp4', file_size: 50_000_000 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(new GraphService().baixarMidia('MIDIA1', TOKEN, 1024)).rejects.toThrow(/grande demais/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mídia que saiu da Meta (404) diz isso', async () => {
    global.fetch = jest.fn(async (url: string | URL) =>
      String(url).includes('graph.facebook.com')
        ? resposta({ url: 'https://lookaside.fbsbx.com/x', mime_type: 'image/jpeg' })
        : resposta(null, { status: 404 }),
    ) as unknown as typeof fetch;

    await expect(new GraphService().baixarMidia('MIDIA1', TOKEN, 1024)).rejects.toThrow(/não está mais disponível/);
  });
});

describe('GraphService.enviarTexto', () => {
  const fetchOriginal = global.fetch;
  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  it('manda texto sem prévia de link e devolve o wamid', async () => {
    let corpo: Record<string, unknown> = {};
    global.fetch = jest.fn(async (_url: string | URL, init?: RequestInit) => {
      corpo = JSON.parse(String(init?.body));
      return resposta({ messages: [{ id: 'wamid.X' }] });
    }) as unknown as typeof fetch;

    const wamid = await new GraphService().enviarTexto('PN1', { para: '5521989751705', texto: 'Já saiu!' }, TOKEN);

    expect(wamid).toBe('wamid.X');
    expect(corpo).toMatchObject({
      messaging_product: 'whatsapp',
      to: '5521989751705',
      type: 'text',
      text: { body: 'Já saiu!', preview_url: false },
    });
  });
});
