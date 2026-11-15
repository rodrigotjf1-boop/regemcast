/**
 * "Conectar pelo Regem" — as regras puras (Hub DMS, F6, plano "Clique RegemCast → Regem").
 *
 * O que estes testes trancam: a configuração torta não liga; o pedido leva as três leituras e a 99 só com
 * a autorização do dono; a conta vai com o CNPJ (a mesma raiz = sem "outra empresa"); a volta só vale com
 * o `iss` do Regem e o `state` com a forma certa; e a troca só é aceita com UMA ligação, da empresa
 * inteira, com as leituras necessárias.
 */
import {
  LEITURAS_DO_REGEM,
  cnpjDaConta,
  conferirVolta,
  corpoDoPedido,
  ehLigacao,
  formatoDoNumero,
  gerarPedido,
  hashDoEstado,
  lerConfigDoClique,
  ligacaoDaTroca,
  permissoesDoPedido,
  urlDaPagina,
} from './regem-clique.regras';

const BASE = { REGEM_CLIQUE: 'true', DMS_ID_EMISSOR: 'https://id.exemplo/oidc/', HUB_APLICATIVO: 'app-cast-de-teste', HUB_SEGREDO: 'segredo-de-teste-123456' };
const LIGACAO = `dms_lg_regem_${'a'.repeat(43)}_${'b'.repeat(6)}`;

describe('a configuração do "Conectar pelo Regem"', () => {
  it('nasce desligada (sem REGEM_CLIQUE) e sem motivo no log', () => {
    expect(lerConfigDoClique({})).toEqual({ ligado: false, motivo: null });
    expect(lerConfigDoClique({ ...BASE, REGEM_CLIQUE: 'false' })).toEqual({ ligado: false, motivo: null });
  });

  it('ligada, com os padrões de produção: a porta, o recurso do DMS ID, a página do Regem e a volta do Regemcast', () => {
    expect(lerConfigDoClique(BASE)).toEqual({
      ligado: true,
      api: 'https://api.dmsregem.com',
      recurso: 'https://api.dmsregem.com/api/v1/integracao',
      pagina: 'https://app.dmsregem.com/integracoes/autorizar',
      volta: 'https://cast.dmsregem.com/integracoes/regem/volta',
      emissorDmsId: 'https://id.exemplo/oidc',
      aplicativo: 'app-cast-de-teste',
      segredo: 'segredo-de-teste-123456',
    });
  });

  it('a API do Regem vem da mesma variável da leitura (com o /api/v1); o site do Regemcast, do APP_URL', () => {
    const c = lerConfigDoClique({ ...BASE, REGEM_API_URL: 'https://api.regem.teste/api/v1', REGEM_APP_URL: 'https://app.regem.teste', APP_URL: 'https://cast.teste' });
    expect(c).toMatchObject({
      api: 'https://api.regem.teste',
      recurso: 'https://api.regem.teste/api/v1/integracao',
      pagina: 'https://app.regem.teste/integracoes/autorizar',
      volta: 'https://cast.teste/integracoes/regem/volta',
    });
  });

  it('configuração torta não liga e diz o motivo (para a distribuição)', () => {
    expect(lerConfigDoClique({ ...BASE, HUB_SEGREDO: '' })).toEqual({ ligado: false, motivo: 'falta HUB_SEGREDO (o aplicativo do Regemcast no DMS ID)' });
    expect(lerConfigDoClique({ ...BASE, REGEM_APP_URL: 'http://app.regem.teste' })).toMatchObject({ ligado: false });
    expect(lerConfigDoClique({ ...BASE, REGEM_APP_URL: 'https://app.regem.teste/caminho' })).toMatchObject({ ligado: false });
    expect(lerConfigDoClique({ ...BASE, REGEM_API_URL: 'nada' })).toMatchObject({ ligado: false });
    // a máquina local, em teste, vale com http
    expect(lerConfigDoClique({ ...BASE, REGEM_API_URL: 'http://127.0.0.1:9999/api/v1', APP_URL: 'http://localhost:3011' })).toMatchObject({
      ligado: true,
      api: 'http://127.0.0.1:9999',
      volta: 'http://localhost:3011/integracoes/regem/volta',
    });
  });
});

describe('o pedido', () => {
  it('o state e o PKCE: o resumo do state confere, o desafio é o SHA-256 do verificador em base64url', () => {
    const p = gerarPedido();
    expect(p.estado).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.estadoHash).toBe(hashDoEstado(p.estado));
    expect(p.desafio).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(gerarPedido().estado).not.toBe(p.estado);
  });

  it('as três leituras sempre; a 99 só com a autorização do dono; o token do DMS ID pede as quatro', () => {
    expect(permissoesDoPedido(false)).toEqual(['clientes.ler', 'pedidos.ler', 'clientes.telefone.ler']);
    expect(permissoesDoPedido(true)).toEqual(['clientes.ler', 'pedidos.ler', 'clientes.telefone.ler', 'vendas.99food.ler']);
    expect([...LEITURAS_DO_REGEM]).toEqual(['clientes.ler', 'pedidos.ler', 'clientes.telefone.ler', 'vendas.99food.ler']);
  });

  it('o corpo: a volta, o PKCE e a conta com o CNPJ (14 dígitos) e o e-mail; sem CNPJ, o campo não vai', () => {
    const corpo = corpoDoPedido({
      volta: 'https://cast.dmsregem.com/integracoes/regem/volta',
      estado: 'e'.repeat(43),
      desafio: 'd'.repeat(43),
      incluir99: false,
      contaNome: '  Brasa Burger ',
      contaCnpj: cnpjDaConta('11.222.333/0001-00'),
      contaEmail: ' Dono@Brasa.Exemplo ',
    });
    expect(corpo).toEqual({
      response_type: 'code',
      redirect_uri: 'https://cast.dmsregem.com/integracoes/regem/volta',
      scope: 'clientes.ler pedidos.ler clientes.telefone.ler',
      state: 'e'.repeat(43),
      code_challenge: 'd'.repeat(43),
      code_challenge_method: 'S256',
      conta_nome: 'Brasa Burger',
      conta_cnpj: '11222333000100',
      conta_email: 'dono@brasa.exemplo',
    });
    const semCnpj = corpoDoPedido({ volta: 'x', estado: 'e', desafio: 'd', incluir99: true, contaNome: '', contaCnpj: cnpjDaConta('123'), contaEmail: 'a@b.c' });
    expect(semCnpj).not.toHaveProperty('conta_cnpj');
    expect(semCnpj.conta_nome).toBe('Conta do Regemcast');
    expect(semCnpj.scope).toContain('vendas.99food.ler');
  });

  it('o número do Regem e a página: só o formato do Regem; a página leva o client_id e o número', () => {
    const numero = `urn:ietf:params:oauth:request_uri:rgm_${'x'.repeat(43)}`;
    expect(formatoDoNumero(numero)).toBe(true);
    expect(formatoDoNumero('urn:ietf:params:oauth:request_uri:outro')).toBe(false);
    const u = new URL(urlDaPagina('https://app.dmsregem.com/integracoes/autorizar', 'app-cast', numero));
    expect(u.origin + u.pathname).toBe('https://app.dmsregem.com/integracoes/autorizar');
    expect(u.searchParams.get('client_id')).toBe('app-cast');
    expect(u.searchParams.get('request_uri')).toBe(numero);
  });
});

describe('a volta', () => {
  const ISS = 'https://api.dmsregem.com';
  const estado = 's'.repeat(43);

  it('com o código, o state e o iss do Regem: vale', () => {
    expect(conferirVolta({ code: 'c'.repeat(43), state: estado, iss: ISS }, ISS)).toEqual({ tipo: 'codigo', estado, codigo: 'c'.repeat(43) });
  });

  it('sem o iss do Regem (ou com outro), não vale — mesmo com o state certo (RFC 9207)', () => {
    expect(conferirVolta({ code: 'c'.repeat(43), state: estado }, ISS)).toMatchObject({ tipo: 'invalida' });
    expect(conferirVolta({ code: 'c'.repeat(43), state: estado, iss: 'https://ataque.exemplo' }, ISS)).toMatchObject({ tipo: 'invalida' });
  });

  it('state torto ou código sem cara de código: não vale', () => {
    expect(conferirVolta({ code: 'c'.repeat(43), state: 'curto', iss: ISS }, ISS)).toMatchObject({ tipo: 'invalida' });
    expect(conferirVolta({ code: 'curto', state: estado, iss: ISS }, ISS)).toMatchObject({ tipo: 'invalida' });
    expect(conferirVolta({ code: `${'c'.repeat(30)} x`, state: estado, iss: ISS }, ISS)).toMatchObject({ tipo: 'invalida' });
  });

  it('o presidente recusou (access_denied) ou o pedido não valeu', () => {
    expect(conferirVolta({ error: 'access_denied', state: estado, iss: ISS }, ISS)).toEqual({ tipo: 'recusa', estado, motivo: 'recusado' });
    expect(conferirVolta({ error: 'invalid_request', state: estado, iss: ISS }, ISS)).toEqual({ tipo: 'recusa', estado, motivo: 'pedido_invalido' });
  });
});

describe('a troca', () => {
  const item = (mudar: Record<string, unknown> = {}) => ({
    loja_id: null,
    empresa_id: 'empresa-1',
    ligacao: LIGACAO,
    prefixo: 'dms_lg_regem_aaaa',
    permissoes: ['pedidos.ler', 'clientes.telefone.ler', 'clientes.ler'],
    segredo_em: '2026-11-15T10:00:00.000Z',
    ...mudar,
  });

  it('UMA ligação da empresa inteira, com as leituras necessárias: aceita', () => {
    expect(ligacaoDaTroca({ lojas: [item()] })).toEqual({ ligacao: LIGACAO, prefixo: 'dms_lg_regem_aaaa', permissoes: ['pedidos.ler', 'clientes.telefone.ler', 'clientes.ler'] });
    expect(ehLigacao(LIGACAO)).toBe(true);
    expect(ehLigacao('rgm_it_qualquer')).toBe(false);
  });

  it('ligação por loja, mais de uma, segredo torto ou leitura faltando: nada é guardado', () => {
    expect(ligacaoDaTroca({ lojas: [item({ loja_id: 'loja-1' })] })).toBeNull();
    expect(ligacaoDaTroca({ lojas: [item(), item()] })).toBeNull();
    expect(ligacaoDaTroca({ lojas: [] })).toBeNull();
    expect(ligacaoDaTroca({ lojas: [item({ ligacao: 'rgm_it_token' })] })).toBeNull();
    expect(ligacaoDaTroca({ lojas: [item({ permissoes: ['pedidos.ler', 'clientes.telefone.ler'] })] })).toBeNull();
    expect(ligacaoDaTroca(null)).toBeNull();
  });
});
