/**
 * As variáveis do DMS ID (Hub DMS, F2): nasce desligado e, ligado, a API não
 * sobe sem as outras três — o erro diz qual falta ou está errada, em vez de um
 * 401 misterioso na primeira chamada.
 */
const BASE = {
  DATABASE_URL: 'postgres://usuario@127.0.0.1:5432/teste',
  JWT_SECRET: 'segredo-de-teste-com-tamanho-suficiente-0123456789',
  CORS_ORIGIN: 'http://localhost:3011',
};

const ORIGINAL = process.env;

function carregar(extra: Record<string, string>) {
  process.env = { ...ORIGINAL, ...BASE, ...extra };
  let lido: typeof import('./env') | undefined;
  jest.isolateModules(() => {
    lido = require('./env') as typeof import('./env'); // eslint-disable-line @typescript-eslint/no-require-imports
  });
  return lido!.env.dmsId;
}

const LIGADO = {
  DMS_ID_LIGADO: 'true',
  DMS_ID_EMISSOR: 'https://id.exemplo.test/oidc/',
  DMS_ID_RECURSO: 'https://cast.exemplo.test/api/v1/mcp',
  DMS_ID_APLICATIVOS: '{"liame":" app-liame "}',
};

describe('env.dmsId', () => {
  afterEach(() => {
    process.env = ORIGINAL;
  });

  it('sem nada, nasce desligado', () => {
    expect(carregar({ DMS_ID_LIGADO: '', DMS_ID_EMISSOR: '', DMS_ID_RECURSO: '', DMS_ID_APLICATIVOS: '' })).toEqual({ ligado: false, emissor: '', recurso: '', aplicativos: {} });
  });

  it('ligado e completo: tira a barra do fim e os espaços do client_id', () => {
    expect(carregar(LIGADO)).toEqual({ ligado: true, emissor: 'https://id.exemplo.test/oidc', recurso: 'https://cast.exemplo.test/api/v1/mcp', aplicativos: { liame: 'app-liame' } });
  });

  it.each([
    ['falta o emissor', { DMS_ID_EMISSOR: '' }, /falta DMS_ID_EMISSOR/],
    ['falta o recurso', { DMS_ID_RECURSO: '' }, /falta DMS_ID_RECURSO/],
    ['faltam os aplicativos', { DMS_ID_APLICATIVOS: '' }, /falta DMS_ID_APLICATIVOS/],
    ['o recurso não é a porta MCP', { DMS_ID_RECURSO: 'https://cast.exemplo.test/api/v1' }, /terminando em \/api\/v1\/mcp/],
    ['o emissor não é endereço', { DMS_ID_EMISSOR: 'id.exemplo.test' }, /DMS_ID_EMISSOR precisa ser um endereço/],
    ['os aplicativos não são JSON', { DMS_ID_APLICATIVOS: 'liame=app' }, /precisa ser um JSON/],
    ['os aplicativos são uma lista', { DMS_ID_APLICATIVOS: '["app-liame"]' }, /mapear produto/],
    ['o client_id está vazio', { DMS_ID_APLICATIVOS: '{"liame":" "}' }, /mapear produto/],
  ])('ligado, a API não sobe quando %s', (_, mudanca, mensagem) => {
    expect(() => carregar({ ...LIGADO, ...mudanca })).toThrow(mensagem);
  });
});
