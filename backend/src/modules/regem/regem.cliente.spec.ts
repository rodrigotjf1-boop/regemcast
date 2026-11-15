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

/**
 * "Conectar pelo Regem" (migration 050): a credencial guardada é a LIGAÇÃO. A leitura vai com o token do
 * DMS ID do Regemcast e o `DMS-Ligacao`; o token do DMS ID é pedido uma vez e guardado; o 401 pede outro e
 * tenta uma vez mais. A configuração vem do ambiente (montado do zero aqui, V48).
 */
describe('RegemCliente pela ligação do clique', () => {
  const fetchOriginal = global.fetch;
  const NOMES = ['REGEM_CLIQUE', 'REGEM_API_URL', 'REGEM_APP_URL', 'APP_URL', 'DMS_ID_EMISSOR', 'HUB_APLICATIVO', 'HUB_SEGREDO'];
  const antes: Record<string, string | undefined> = {};
  const LIGACAO = `dms_lg_regem_${'a'.repeat(43)}_${'b'.repeat(6)}`;
  let tokens = 0;

  beforeEach(() => {
    for (const n of NOMES) {
      antes[n] = process.env[n];
      delete process.env[n];
    }
    Object.assign(process.env, {
      REGEM_CLIQUE: 'true',
      REGEM_API_URL: 'https://regem.exemplo/api/v1',
      DMS_ID_EMISSOR: 'https://id.exemplo/oidc',
      HUB_APLICATIVO: 'app-cast-de-teste',
      HUB_SEGREDO: 'segredo-de-teste-123456',
    });
    tokens = 0;
  });
  afterEach(() => {
    global.fetch = fetchOriginal;
    for (const n of NOMES) {
      if (antes[n] === undefined) delete process.env[n];
      else process.env[n] = antes[n];
    }
  });

  type Chamada = { url: string; metodo: string; cabecalhos: Headers; corpo: string | null };

  /** O DMS ID responde sozinho (um token novo a cada pedido); o Regem responde a fila, na ordem. */
  function servir(...doRegem: Response[]) {
    const chamadas: Chamada[] = [];
    global.fetch = jest.fn(async (url: string | URL, init?: RequestInit) => {
      const c = { url: String(url), metodo: init?.method ?? 'GET', cabecalhos: new Headers(init?.headers), corpo: (init?.body as string) ?? null };
      chamadas.push(c);
      if (c.url === 'https://id.exemplo/oidc/token') return resposta({ access_token: `token-do-dms-id-${++tokens}`, expires_in: 3600 });
      const r = doRegem.shift();
      if (!r) throw new Error('chamada a mais');
      return r;
    }) as unknown as typeof fetch;
    return chamadas;
  }

  it('lê pela ligação: o token do DMS ID (pedido uma vez, para o recurso do Regem) e o DMS-Ligacao', async () => {
    const chamadas = servir(
      resposta({ empresa_id: 'e1', empresa_nome: 'Brasa', lojas: [], escopos: ['clientes.ler'] }),
      resposta({ itens: [], proximo_cursor: 'c1', tem_mais: false }),
    );
    const cliente = new RegemCliente();
    await cliente.loja(LIGACAO);
    await cliente.clientes(LIGACAO, null);
    const doDmsId = chamadas.filter((c) => c.url.startsWith('https://id.exemplo'));
    expect(doDmsId).toHaveLength(1);
    expect(new URLSearchParams(doDmsId[0]!.corpo ?? '').get('resource')).toBe('https://regem.exemplo/api/v1/integracao');
    const doRegem = chamadas.filter((c) => c.url.startsWith('https://regem.exemplo'));
    for (const c of doRegem) {
      expect(c.cabecalhos.get('authorization')).toBe('Bearer token-do-dms-id-1');
      expect(c.cabecalhos.get('dms-ligacao')).toBe(LIGACAO);
    }
    // o segredo da ligação nunca vai na URL
    expect(doRegem.every((c) => !c.url.includes(LIGACAO))).toBe(true);
  });

  it('o 401 pede outro token ao DMS ID e tenta uma vez mais; o segundo 401 vira a frase do clique', async () => {
    const chamadas = servir(resposta({}, { status: 401 }), resposta({ empresa_nome: 'Brasa', lojas: [], escopos: [] }));
    await new RegemCliente().loja(LIGACAO);
    const doRegem = chamadas.filter((c) => c.url.startsWith('https://regem.exemplo'));
    expect(doRegem.map((c) => c.cabecalhos.get('authorization'))).toEqual(['Bearer token-do-dms-id-1', 'Bearer token-do-dms-id-2']);

    servir(resposta({}, { status: 401 }), resposta({}, { status: 401 }));
    const e = await new RegemCliente()
      .loja(LIGACAO)
      .then(() => null)
      .catch((x: unknown) => x as ErroRegem);
    expect(e).toMatchObject({ status: 401, passageiro: false });
    expect(e?.message).toContain('conecta de novo em Integrações › Regem');
  });

  it('o token rgm_it_ segue como antes: Bearer do próprio token, sem DMS ID', async () => {
    const chamadas = servir(resposta({ empresa_nome: 'Brasa', lojas: [], escopos: [] }));
    await new RegemCliente().loja(TOKEN);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.cabecalhos.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(chamadas[0]!.cabecalhos.get('dms-ligacao')).toBeNull();
  });

  it('o pedido e a troca vão à porta com o token do DMS ID e devolvem o status e o corpo', async () => {
    const chamadas = servir(resposta({ request_uri: 'urn:x' }, { status: 201 }));
    const r = await new RegemCliente().postarNaPorta('/integracao/autorizacao/pedido', { response_type: 'code' });
    expect(r).toEqual({ status: 201, corpo: { request_uri: 'urn:x' } });
    const post = chamadas.find((c) => c.url === 'https://regem.exemplo/api/v1/integracao/autorizacao/pedido');
    expect(post).toMatchObject({ metodo: 'POST', corpo: JSON.stringify({ response_type: 'code' }) });
    expect(post!.cabecalhos.get('authorization')).toBe('Bearer token-do-dms-id-1');
  });

  it('revogar a ligação no Regem: 200 ou 401 confirmam; o token rgm_it_ nunca é mandado para lá', async () => {
    servir(resposta({}, { status: 200 }));
    expect(await new RegemCliente().revogarLigacao(LIGACAO)).toBe(true);
    servir(resposta({}, { status: 401 }), resposta({}, { status: 401 }));
    expect(await new RegemCliente().revogarLigacao(LIGACAO)).toBe(true);
    const chamadas = servir();
    expect(await new RegemCliente().revogarLigacao(TOKEN)).toBe(false);
    expect(chamadas).toHaveLength(0);
  });

  it('com o clique desligado no servidor, a ligação não é lida (e o motivo é para o suporte)', async () => {
    delete process.env.REGEM_CLIQUE;
    servir();
    const e = await new RegemCliente()
      .loja(LIGACAO)
      .then(() => null)
      .catch((x: unknown) => x as ErroRegem);
    expect(e).toBeInstanceOf(ErroRegem);
    expect(e?.message).toContain('não está ligada neste servidor');
  });
});
