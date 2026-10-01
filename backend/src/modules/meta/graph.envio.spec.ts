/**
 * O envio de um modelo com mais que o corpo, e a entrega da mídia à Meta para
 * envio — o `fetch` é dublê.
 *
 * O que estes testes trancam: a mídia do envio sobe em multipart, com o token
 * do CLIENTE e para o número dele (não é o upload da criação do modelo, que usa
 * o token do app e devolve outro identificador); e o `components` montado em
 * `envio.regras.ts` chega à Meta sem ser mexido.
 */
jest.mock('../../config/env', () => ({
  env: { meta: { appId: '123', appSecret: 'segredo', graphVersao: 'v26.0' } },
}));

import { ErroGraph, GraphService } from './graph.service';

const TOKEN = 'token-do-cliente';

function resposta(corpo: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json', 'x-fb-trace-id': 'TRACE1' }),
    json: async () => corpo,
    text: async () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)),
  } as unknown as Response;
}

const fetchOriginal = global.fetch;
afterEach(() => {
  global.fetch = fetchOriginal;
});

describe('GraphService.subirMidiaParaEnvio', () => {
  const ARQUIVO = { conteudo: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), tipoMime: 'image/jpeg', nome: 'promo.jpg' };

  it('sobe em multipart para o NÚMERO do cliente, com o token dele, e devolve o id', async () => {
    let pedido: { url: string; init?: RequestInit } | undefined;
    global.fetch = jest.fn(async (url: string | URL, init?: RequestInit) => {
      pedido = { url: String(url), init };
      return resposta({ id: '1339522734477770' });
    }) as unknown as typeof fetch;

    const id = await new GraphService().subirMidiaParaEnvio('PN1', ARQUIVO, TOKEN);

    expect(id).toBe('1339522734477770');
    expect(pedido?.url).toContain('/v26.0/PN1/media');
    expect(pedido?.init?.method).toBe('POST');
    const cabecalhos = new Headers(pedido?.init?.headers);
    expect(cabecalhos.get('authorization')).toBe(`Bearer ${TOKEN}`);
    // Sem Content-Type nosso: o do multipart, com a fronteira, é o fetch que põe.
    expect(cabecalhos.has('content-type')).toBe(false);

    const formulario = pedido?.init?.body as FormData;
    expect(formulario).toBeInstanceOf(FormData);
    expect(formulario.get('messaging_product')).toBe('whatsapp');
    expect(formulario.get('type')).toBe('image/jpeg');
    const arquivo = formulario.get('file') as File;
    expect(arquivo.name).toBe('promo.jpg');
    expect(arquivo.type).toBe('image/jpeg');
    expect(arquivo.size).toBe(4);
  });

  it('recusa da Meta vira ErroGraph com o código dela — nunca um erro mudo', async () => {
    global.fetch = jest.fn(async () =>
      resposta({ error: { message: 'Invalid OAuth access token', code: 190, type: 'OAuthException' } }, 401),
    ) as unknown as typeof fetch;

    const erro = await new GraphService().subirMidiaParaEnvio('PN1', ARQUIVO, TOKEN).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroGraph);
    expect((erro as ErroGraph).codigo).toBe(190);
    expect((erro as ErroGraph).status).toBe(401);
    expect((erro as ErroGraph).traceId).toBe('TRACE1');
  });

  it('200 sem id não serve: sem ele não há o que mandar no cabeçalho', async () => {
    global.fetch = jest.fn(async () => resposta({})) as unknown as typeof fetch;
    await expect(new GraphService().subirMidiaParaEnvio('PN1', ARQUIVO, TOKEN)).rejects.toBeInstanceOf(ErroGraph);
  });

  it('rede caída é erro transitório (status 0): quem chama tenta de novo depois, sem pausar a campanha', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    const erro = (await new GraphService().subirMidiaParaEnvio('PN1', ARQUIVO, TOKEN).catch((e: unknown) => e)) as ErroGraph;

    expect(erro).toBeInstanceOf(ErroGraph);
    expect(erro.status).toBe(0);
    expect(erro.classe).toBe('transitorio');
  });
});

describe('GraphService.enviarModelo — o `components` que sai', () => {
  const corpoEnviado = async (dados: Parameters<GraphService['enviarModelo']>[1]) => {
    let corpo: { template: { components?: unknown } } | undefined;
    global.fetch = jest.fn(async (_url: string | URL, init?: RequestInit) => {
      corpo = JSON.parse(String(init?.body));
      return resposta({ messages: [{ id: 'wamid.X' }] });
    }) as unknown as typeof fetch;
    await new GraphService().enviarModelo('PN1', dados, TOKEN);
    return corpo!;
  };
  const base = { para: '5521999998888', modelo: 'promo', idioma: 'pt_BR' };

  it('com `componentes`, eles vão como vieram (cabeçalho, corpo, botão)', async () => {
    const componentes = [
      { type: 'header', parameters: [{ type: 'image', image: { id: '1339522734477770' } }] },
      { type: 'body', parameters: [{ type: 'text', text: 'Ana' }] },
      { type: 'button', sub_type: 'copy_code', index: 1, parameters: [{ type: 'coupon_code', coupon_code: 'WINTER25' }] },
    ];
    const corpo = await corpoEnviado({ ...base, variaveis: ['não é lido'], componentes });
    expect(corpo.template.components).toEqual(componentes);
  });

  it('sem `componentes`, o corpo sai das variáveis, como sempre', async () => {
    const corpo = await corpoEnviado({ ...base, variaveis: ['Ana'] });
    expect(corpo.template.components).toEqual([{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }] }]);
  });

  it('nada a mandar: sem a chave `components` (vazia, a Meta recusa com 132000)', async () => {
    expect((await corpoEnviado({ ...base, variaveis: [] })).template).not.toHaveProperty('components');
    expect((await corpoEnviado({ ...base, variaveis: [], componentes: [] })).template).not.toHaveProperty('components');
  });
});
