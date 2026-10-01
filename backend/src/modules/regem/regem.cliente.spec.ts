/**
 * O cliente HTTP da API de integração do Regem — o `fetch` é dublê.
 *
 * O que estes testes trancam: o token vai no cabeçalho (nunca na URL), cada
 * erro vira a frase certa e a decisão certa (passageiro = tentar de novo;
 * recusa = parar), e o cursor nunca volta para o começo por engano.
 */
jest.mock('../../config/env', () => ({ env: { integracoes: { regemUrl: 'https://regem.exemplo/api/v1/' } } }));

import { ErroRegem, RegemCliente } from './regem.cliente';

const TOKEN = 'rgm_it_teste_0123456789';

function resposta(corpo: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(init.headers ?? { 'content-type': 'application/json' }),
    json: async () => corpo,
  } as unknown as Response;
}

describe('RegemCliente', () => {
  const fetchOriginal = global.fetch;
  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  function responder(...respostas: Response[]) {
    const chamadas: { url: string; auth: string | null }[] = [];
    global.fetch = jest.fn(async (url: string | URL, init?: RequestInit) => {
      chamadas.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
      const r = respostas.shift();
      if (!r) throw new Error('chamada a mais');
      return r;
    }) as unknown as typeof fetch;
    return chamadas;
  }

  async function erroDe(p: Promise<unknown>): Promise<ErroRegem> {
    try {
      await p;
    } catch (e) {
      if (e instanceof ErroRegem) return e;
      throw e;
    }
    throw new Error('não falhou');
  }

  it('a página vai com o token no cabeçalho, 500 por vez, e continua do cursor', async () => {
    const chamadas = responder(resposta({ itens: [{ id: 'c1' }], proximo_cursor: 'k2', tem_mais: true }));
    const p = await new RegemCliente().clientes(TOKEN, 'k1');
    expect(chamadas).toEqual([{ url: 'https://regem.exemplo/api/v1/integracao/clientes?limite=500&cursor=k1', auth: `Bearer ${TOKEN}` }]);
    expect(p).toEqual({ itens: [{ id: 'c1' }], proximo_cursor: 'k2', tem_mais: true });
  });

  it('sem cursor, começa do começo; resposta sem cursor mantém o que já estava (nunca volta ao começo)', async () => {
    const chamadas = responder(resposta({ itens: [{ id: 'v1' }], tem_mais: false }), resposta({ itens: [], proximo_cursor: '' }));
    expect(await new RegemCliente().pedidos(TOKEN, null)).toEqual({ itens: [{ id: 'v1' }], proximo_cursor: null, tem_mais: false });
    expect(await new RegemCliente().pedidos(TOKEN, 'k7')).toEqual({ itens: [], proximo_cursor: 'k7', tem_mais: false });
    expect(chamadas[0]!.url).toBe('https://regem.exemplo/api/v1/integracao/pedidos?limite=500');
  });

  it('"tem mais" com a página vazia não prende o laço', async () => {
    responder(resposta({ itens: [], proximo_cursor: 'k3', tem_mais: true }));
    expect((await new RegemCliente().clientes(TOKEN, 'k2')).tem_mais).toBe(false);
  });

  it('a empresa do token: `GET /integracao/loja`', async () => {
    const chamadas = responder(resposta({ empresa_id: 'e1', empresa_nome: 'Grupo Sabor', lojas: [{ id: 'l1', nome: 'Centro' }], escopos: ['clientes.ler'] }));
    const loja = await new RegemCliente().loja(TOKEN);
    expect(chamadas[0]!.url).toBe('https://regem.exemplo/api/v1/integracao/loja');
    expect(loja).toMatchObject({ empresaId: 'e1', empresaNome: 'Grupo Sabor', escopos: ['clientes.ler'] });
  });

  it('401: o acesso foi revogado — para (não é passageiro), com o caminho para voltar', async () => {
    responder(resposta({ detail: 'token revogado' }, { status: 401 }));
    const e = await erroDe(new RegemCliente().clientes(TOKEN, null));
    expect(e).toMatchObject({ status: 401, passageiro: false });
    expect(e.message).toContain('Fale com o suporte do RegemCast');
  });

  it('403: diz o que o Regem não liberou, com a frase de lá (problem+json)', async () => {
    responder(resposta({ title: 'Proibido', detail: 'Escopo  clientes.ler\n ausente' }, { status: 403 }));
    const e = await erroDe(new RegemCliente().clientes(TOKEN, null));
    expect(e).toMatchObject({ status: 403, passageiro: false });
    expect(e.message).toBe('O Regem não liberou os clientes para esta conexão. (Escopo clientes.ler ausente)');
  });

  it('429: passageiro, esperando o Retry-After (60 s se não vier; no máximo 10 min)', async () => {
    responder(
      resposta({}, { status: 429, headers: { 'retry-after': '30' } }),
      resposta({}, { status: 429 }),
      resposta({}, { status: 429, headers: { 'retry-after': '99999' } }),
    );
    const c = new RegemCliente();
    expect(await erroDe(c.pedidos(TOKEN, null))).toMatchObject({ passageiro: true, esperarSeg: 30 });
    expect(await erroDe(c.pedidos(TOKEN, null))).toMatchObject({ passageiro: true, esperarSeg: 60 });
    expect(await erroDe(c.pedidos(TOKEN, null))).toMatchObject({ passageiro: true, esperarSeg: 600 });
  });

  it('5xx e rede: passageiros', async () => {
    responder(resposta({}, { status: 503 }));
    expect(await erroDe(new RegemCliente().pedidos(TOKEN, null))).toMatchObject({ status: 503, passageiro: true });
    global.fetch = jest.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await erroDe(new RegemCliente().pedidos(TOKEN, null))).toMatchObject({ status: null, passageiro: true });
  });

  it('outro 4xx: para, com a frase do Regem', async () => {
    responder(resposta({ detail: 'cursor inválido' }, { status: 400 }));
    const e = await erroDe(new RegemCliente().pedidos(TOKEN, 'lixo'));
    expect(e).toMatchObject({ status: 400, passageiro: false });
    expect(e.message).toContain('cursor inválido');
  });
});
