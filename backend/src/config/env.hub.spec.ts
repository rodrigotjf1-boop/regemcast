/**
 * As variáveis do hub da DMS (Hub DMS, F2, etapa 2 da A4): nasce desligado e aceitando integrações; ligado, a API não
 * sobe sem o endereço, o recurso, o emissor, o aplicativo e o segredo — e o segredo nunca aparece na mensagem.
 */
export {}; // módulo, não script: os nomes daqui não colidem com os de env.dmsid.spec.ts

const BASE = {
  DATABASE_URL: 'postgres://usuario@127.0.0.1:5432/teste',
  JWT_SECRET: 'segredo-de-teste-com-tamanho-suficiente-0123456789',
  CORS_ORIGIN: 'http://localhost:3011',
};

const ORIGINAL = process.env;
const SEGREDO = 'segredo-do-aplicativo-de-teste-0123456789';

/**
 * O ambiente de cada teste é só o que ele define (mais o NODE_ENV do jest), como no CI. Nada herdado do processo: fora
 * de produção o `env.ts` carrega o `backend/.env` com `process.loadEnvFile`, que escreve no ambiente REAL — e o arquivo
 * de teste seguinte no mesmo processo nasce com essas variáveis. Herdadas, um `DIST_TOKEN` curto do `.env` local
 * estourava o teste de produção antes da conferência do HUB_URL (só local, com mais de um arquivo por processo).
 */
function carregar(extra: Record<string, string>) {
  process.env = { NODE_ENV: ORIGINAL.NODE_ENV, ...BASE, ...extra };
  let lido: typeof import('./env') | undefined;
  jest.isolateModules(() => {
    lido = require('./env') as typeof import('./env'); // eslint-disable-line @typescript-eslint/no-require-imports
  });
  return lido!.env.hub;
}

const VAZIO = { HUB_LIGADO: '', HUB_URL: '', HUB_RECURSO: '', DMS_ID_EMISSOR: '', HUB_APLICATIVO: '', HUB_SEGREDO: '', ACEITAR_INTEGRACOES: '' };
const LIGADO = {
  HUB_LIGADO: 'true',
  HUB_URL: 'https://hub.exemplo.test/',
  HUB_RECURSO: 'https://hub.exemplo.test/api/',
  DMS_ID_EMISSOR: 'https://id.exemplo.test/oidc/',
  HUB_APLICATIVO: ' app-regemcast-de-teste ',
  HUB_SEGREDO: SEGREDO,
};

describe('env.hub', () => {
  afterEach(() => {
    process.env = ORIGINAL;
  });

  it('sem nada, nasce desligado e aceitando integrações', () => {
    expect(carregar(VAZIO)).toEqual({ ligado: false, url: '', recurso: '', emissor: '', aplicativo: '', segredo: '', aceitaIntegracoes: true });
  });

  it('a chave própria ACEITAR_INTEGRACOES=false vale mesmo com o hub desligado', () => {
    expect(carregar({ ...VAZIO, ACEITAR_INTEGRACOES: 'false' })).toMatchObject({ ligado: false, aceitaIntegracoes: false });
  });

  it('ligado e completo: tira a barra do fim e os espaços', () => {
    expect(carregar({ ...VAZIO, ...LIGADO })).toEqual({
      ligado: true,
      url: 'https://hub.exemplo.test',
      recurso: 'https://hub.exemplo.test/api',
      emissor: 'https://id.exemplo.test/oidc',
      aplicativo: 'app-regemcast-de-teste',
      segredo: SEGREDO,
      aceitaIntegracoes: true,
    });
  });

  it.each([
    ['falta o endereço do hub', { HUB_URL: '' }, /falta HUB_URL/],
    ['falta o recurso', { HUB_RECURSO: '' }, /falta HUB_RECURSO/],
    ['falta o emissor do DMS ID', { DMS_ID_EMISSOR: '' }, /falta DMS_ID_EMISSOR/],
    ['o endereço do hub não é endereço', { HUB_URL: 'hub.exemplo.test' }, /HUB_URL precisa ser um endereço/],
    ['falta o aplicativo', { HUB_APLICATIVO: ' ' }, /falta HUB_APLICATIVO/],
    ['falta o segredo', { HUB_SEGREDO: '' }, /HUB_SEGREDO falta ou está curto/],
  ])('ligado, a API não sobe quando %s', (_, mudanca, mensagem) => {
    expect(() => carregar({ ...VAZIO, ...LIGADO, ...mudanca })).toThrow(mensagem);
  });

  it('o segredo curto derruba o boot sem aparecer na mensagem', () => {
    const curto = 'curto-demais';
    let mensagem = '';
    try {
      carregar({ ...VAZIO, ...LIGADO, HUB_SEGREDO: curto });
    } catch (erro) {
      mensagem = (erro as Error).message;
    }
    expect(mensagem).toMatch(/HUB_SEGREDO falta ou está curto/);
    expect(mensagem).not.toContain(curto);
  });

  it('em produção, o endereço do hub precisa ser https', () => {
    const producao = { NODE_ENV: 'production', APP_URL: 'https://app.exemplo.test', RASTREIO_BASE_URL: 'https://api.exemplo.test/r' };
    expect(() => carregar({ ...VAZIO, ...LIGADO, ...producao, HUB_URL: 'http://hub.exemplo.test' })).toThrow(/HUB_URL precisa ser um endereço https/);
    expect(carregar({ ...VAZIO, ...LIGADO, ...producao }).ligado).toBe(true);
  });
});
