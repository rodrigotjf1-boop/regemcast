/**
 * As regras puras da ligação do Hub DMS: o que decide se o segredo do
 * cabeçalho vale, quais permissões valem na chamada, quem pode trocar o
 * `rct_it_` pela ligação e o desafio de cada recusa.
 */
import { ErroPermissaoFaltando, ErroProblema, ErroTokenDmsId, gerarChave } from '../../dms/integracao-dms';
import {
  bearerDoCabecalho,
  desafioDaRecusa,
  enderecoDosMetadados,
  LIGACAO_INVALIDA,
  ligacaoDoCabecalho,
  ligacaoVale,
  PERMISSOES_DO_RECURSO,
  permissoesDaLigacao,
  permissoesDoCatalogo,
  podeTrocar,
} from './ligacao.regras';

const APLICATIVOS = { liame: 'app-liame' };
const METADADOS = 'https://cast.exemplo.test/.well-known/oauth-protected-resource/api/v1/mcp';

describe('ligacaoDoCabecalho', () => {
  it('aceita a ligação do RegemCast com os dígitos de conferência certos', () => {
    const { chave } = gerarChave('lg', 'regemcast');
    expect(ligacaoDoCabecalho(chave)).toBe(chave);
    expect(ligacaoDoCabecalho(`  ${chave}  `)).toBe(chave);
  });

  it('recusa a chave de outro tipo, de outro produto, com um caractere trocado, repetida ou ausente', () => {
    const { chave } = gerarChave('lg', 'regemcast');
    const trocada = chave.replace(/_([A-Za-z0-9_-])([A-Za-z0-9_-]{42})_/, (_, a: string, resto: string) => `_${a === 'A' ? 'B' : 'A'}${resto}_`);
    expect(trocada).not.toBe(chave);
    expect(ligacaoDoCabecalho(trocada)).toBeNull();
    expect(ligacaoDoCabecalho(gerarChave('ap', 'regemcast').chave)).toBeNull();
    expect(ligacaoDoCabecalho(gerarChave('lg', 'liame').chave)).toBeNull();
    expect(ligacaoDoCabecalho([chave, chave])).toBeNull();
    expect(ligacaoDoCabecalho(undefined)).toBeNull();
    expect(ligacaoDoCabecalho('')).toBeNull();
  });
});

describe('bearerDoCabecalho', () => {
  it('devolve o texto do Bearer, qualquer que seja a forma, e nulo sem Bearer', () => {
    expect(bearerDoCabecalho('Bearer a.b.c')).toBe('a.b.c');
    expect(bearerDoCabecalho('bearer   a.b.')).toBe('a.b.');
    expect(bearerDoCabecalho('Basic abc')).toBeNull();
    expect(bearerDoCabecalho('Bearer a b')).toBeNull();
    expect(bearerDoCabecalho(undefined)).toBeNull();
  });
});

describe('ligacaoVale', () => {
  const boa = { aplicativo: 'app-liame', classe: 'dms', escopos: ['orcamento.ler'], revogadoEm: null };

  it('vale a ligação ativa, da classe dms, do aplicativo do token, com o aplicativo na lista da distribuição', () => {
    expect(ligacaoVale(boa, 'app-liame', APLICATIVOS)).toBe(true);
  });

  it.each([
    ['inexistente', undefined, 'app-liame', APLICATIVOS],
    ['revogada', { ...boa, revogadoEm: new Date('2026-10-01T00:00:00Z') }, 'app-liame', APLICATIVOS],
    ['de cliente de fora', { ...boa, classe: 'externo' }, 'app-liame', APLICATIVOS],
    ['usada com o token de outro aplicativo', boa, 'app-outro', { ...APLICATIVOS, outro: 'app-outro' }],
    ['de aplicativo que saiu da lista da distribuição', boa, 'app-liame', {}],
  ])('não vale a ligação %s', (_, ligacao, aplicativo, aplicativos) => {
    expect(ligacaoVale(ligacao, aplicativo, aplicativos)).toBe(false);
  });
});

describe('as permissões', () => {
  it('do token, só as do catálogo do RegemCast, na ordem do catálogo', () => {
    expect(permissoesDoCatalogo(['outro.recurso', 'orcamento.ler', 'conta.ler'])).toEqual(['conta.ler', 'orcamento.ler']);
    expect(permissoesDoCatalogo([])).toEqual([]);
  });

  it('da chamada, a menor das duas: a ligação E o token', () => {
    const ligacao = { classe: 'dms', escopos: ['conta.ler', 'orcamento.ler', 'campanhas.disparar'] };
    expect(permissoesDaLigacao(ligacao, ['orcamento.ler', 'campanhas.ler', 'campanhas.disparar'])).toEqual(['orcamento.ler', 'campanhas.disparar']);
    expect(permissoesDaLigacao(ligacao, ['campanhas.ler'])).toEqual([]);
  });

  it('o disparo guardado numa ligação de cliente de fora não vira permissão, nem com o token pedindo', () => {
    expect(permissoesDaLigacao({ classe: 'externo', escopos: ['campanhas.disparar', 'conta.ler'] }, PERMISSOES_DO_RECURSO)).toEqual(['conta.ler']);
  });

  it('o 401 e o 403 anunciam as 9 permissões do catálogo', () => {
    expect(PERMISSOES_DO_RECURSO).toHaveLength(9);
  });
});

describe('podeTrocar', () => {
  const token = { classe: 'dms', produto: 'liame', revogadoEm: null };

  it('troca o token ativo de produto da DMS pelo aplicativo cadastrado para o produto', () => {
    expect(podeTrocar(token, 'app-liame', APLICATIVOS)).toBe(true);
  });

  it.each([
    ['revogado', { ...token, revogadoEm: new Date('2026-10-01T00:00:00Z') }, 'app-liame'],
    ['de cliente de fora', { ...token, classe: 'externo' }, 'app-liame'],
    ['de outro produto', { ...token, produto: 'gogem' }, 'app-liame'],
    ['pedido por outro aplicativo', token, 'app-outro'],
    ['de produto com nome de propriedade de objeto', { ...token, produto: 'constructor' }, 'app-liame'],
  ])('não troca o token %s', (_, t, aplicativo) => {
    expect(podeTrocar(t, aplicativo, APLICATIVOS)).toBe(false);
  });
});

describe('desafioDaRecusa', () => {
  it('sem token: o desafio sem código de erro, com os metadados e as permissões', () => {
    const d = desafioDaRecusa(new ErroTokenDmsId('ausente'), false, METADADOS);
    expect(d).toBe(`Bearer resource_metadata="${METADADOS}", scope="${PERMISSOES_DO_RECURSO.join(' ')}"`);
  });

  it('token que não vale: invalid_token', () => {
    expect(desafioDaRecusa(new ErroTokenDmsId('vencido'), true, METADADOS)).toContain('error="invalid_token"');
  });

  it('ligação que não vale (401): o desafio com os metadados, sem dizer que o token é inválido', () => {
    const d = desafioDaRecusa(new ErroProblema('ligacao-invalida', LIGACAO_INVALIDA), true, METADADOS);
    expect(d).toContain(`resource_metadata="${METADADOS}"`);
    expect(d).not.toContain('error=');
  });

  it('falta permissão: insufficient_scope com TODAS as que faltam', () => {
    const d = desafioDaRecusa(new ErroPermissaoFaltando(['conta.ler', 'orcamento.ler']), true, METADADOS);
    expect(d).toBe(`Bearer resource_metadata="${METADADOS}", error="insufficient_scope", scope="conta.ler orcamento.ler"`);
  });

  it('conta bloqueada, limite e erro que não é do Padrão: sem desafio', () => {
    expect(desafioDaRecusa(new ErroProblema('conta-bloqueada', 'x'), true, METADADOS)).toBeNull();
    expect(desafioDaRecusa(new ErroProblema('limite-de-chamadas', 'x', { retryAfterSeg: 3 }), true, METADADOS)).toBeNull();
    expect(desafioDaRecusa(new Error('x'), true, METADADOS)).toBeNull();
  });
});

describe('enderecoDosMetadados', () => {
  it('põe o .well-known entre a origem e o caminho da porta (RFC 9728 §3.1)', () => {
    expect(enderecoDosMetadados('https://cast.exemplo.test/api/v1/mcp')).toBe(METADADOS);
    expect(enderecoDosMetadados('https://cast.exemplo.test/api/v1/mcp/')).toBe(METADADOS);
    expect(enderecoDosMetadados('http://127.0.0.1:4000/api/v1/mcp')).toBe('http://127.0.0.1:4000/.well-known/oauth-protected-resource/api/v1/mcp');
  });
});
