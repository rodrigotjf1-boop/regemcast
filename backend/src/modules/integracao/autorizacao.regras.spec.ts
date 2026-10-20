/**
 * As regras puras da autorização por clique (Hub DMS B1) e a tela montada no servidor.
 * Identificadores visivelmente fictícios: o repositório é público (V34).
 */
import {
  APLICATIVOS_DA_AUTORIZACAO,
  conferirPedido,
  ehOutraEmpresa,
  enderecoDeVolta,
  enderecoDeVoltaInvalido,
  gerarCodigo,
  gerarNumeroDoPedido,
  naoPode,
  permissoesLiberadas,
  resumoDoCodigo,
  resumoDoNumero,
  verificadorConfere,
  type CorpoDoPedido,
} from './autorizacao.regras';
import { formatarCnpj, montarTela, textoGuardado } from './autorizacao.tela';

const LIAME = APLICATIVOS_DA_AUTORIZACAO.liame!;
const CLIENTE = 'aplicativo-a-de-teste';
const VOLTA = 'https://liame.exemplo/v1/oauth/callback';
// RFC 7636, apêndice B: o verificador e o desafio S256 do exemplo da norma.
const VERIFICADOR = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const DESAFIO = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

function pedido(muda: Partial<CorpoDoPedido> = {}): CorpoDoPedido {
  return {
    response_type: 'code',
    client_id: CLIENTE,
    redirect_uri: VOLTA,
    scope: 'orcamento.ler conversas.anuncio.ler conta.ler campanhas.ler publicos.ler modelos.ler',
    state: 'estado-de-teste-0001',
    code_challenge: DESAFIO,
    code_challenge_method: 'S256',
    conta_nome: 'Hamburgueria Exemplo',
    conta_cnpj: '11.222.333/0001-00',
    conta_email: 'Dono@Exemplo.Test',
    conta_marca: 'Marca Exemplo',
    ...muda,
  };
}

describe('o número do pedido e o código de uso único', () => {
  it('o número tem a forma da RFC 9126 com o prefixo nosso, e o resumo só aceita essa forma', () => {
    const { numero, resumo } = gerarNumeroDoPedido();
    expect(numero).toMatch(/^urn:ietf:params:oauth:request_uri:rct_[A-Za-z0-9_-]{43}$/);
    expect(resumoDoNumero(numero)).toBe(resumo);
    expect(resumo).toMatch(/^[0-9a-f]{64}$/);
    expect(gerarNumeroDoPedido().numero).not.toBe(numero);
    for (const torto of [numero.replace('rct_', 'rgm_'), `${numero}x`, numero.slice(0, -1), 'urn:x', 42, undefined, null]) {
      expect(resumoDoNumero(torto)).toBeNull();
    }
  });

  it('o código tem o prefixo rct_ac_ e 43 caracteres, e o resumo só aceita essa forma', () => {
    const { codigo, resumo } = gerarCodigo();
    expect(codigo).toMatch(/^rct_ac_[A-Za-z0-9_-]{43}$/);
    expect(resumoDoCodigo(codigo)).toBe(resumo);
    for (const torto of [codigo.slice(0, -1), `${codigo}=`, codigo.replace('rct_ac_', 'rgm_ac_'), '', 7]) {
      expect(resumoDoCodigo(torto)).toBeNull();
    }
  });

  it('o verificador PKCE confere pelo S256 (o exemplo da RFC 7636) e recusa o resto', () => {
    expect(verificadorConfere(VERIFICADOR, DESAFIO)).toBe(true);
    expect(verificadorConfere(`${VERIFICADOR.slice(0, -1)}l`, DESAFIO)).toBe(false);
    expect(verificadorConfere(DESAFIO, DESAFIO)).toBe(false); // "plain" não vale
    expect(verificadorConfere('curto', DESAFIO)).toBe(false);
    expect(verificadorConfere(`${VERIFICADOR}!`, DESAFIO)).toBe(false);
    expect(verificadorConfere(undefined, DESAFIO)).toBe(false);
    expect(verificadorConfere(VERIFICADOR, `${DESAFIO}x`)).toBe(false);
  });
});

describe('conferir o pedido', () => {
  it('o pedido certo sai com as permissões na ordem do catálogo, separadas em necessárias e opcionais, e a conta que pede limpa', () => {
    expect(conferirPedido(pedido(), LIAME, CLIENTE, [VOLTA])).toEqual({
      redirectUri: VOLTA,
      necessarias: ['conta.ler', 'campanhas.ler', 'publicos.ler', 'modelos.ler', 'orcamento.ler'],
      opcionais: ['conversas.anuncio.ler'],
      state: 'estado-de-teste-0001',
      desafio: DESAFIO,
      contaQuePede: { nome: 'Hamburgueria Exemplo', cnpj: '11222333000100', email: 'dono@exemplo.test', marca: 'Marca Exemplo' },
    });
  });

  it('o aplicativo pode pedir menos (só o que quer), e o client_id ausente no corpo vale pelo do token', () => {
    const r = conferirPedido(pedido({ scope: 'conta.ler', client_id: undefined, conta_cnpj: '', conta_marca: undefined }), LIAME, CLIENTE, [VOLTA]);
    expect(r).toEqual(expect.objectContaining({ necessarias: ['conta.ler'], opcionais: [], contaQuePede: expect.objectContaining({ cnpj: null, marca: null }) }));
  });

  it.each<[string, Partial<CorpoDoPedido>, RegExp]>([
    ['response_type ausente', { response_type: undefined }, /response_type/],
    ['client_id de outro aplicativo', { client_id: 'aplicativo-b-de-teste' }, /client_id/],
    ['endereço de volta fora da lista', { redirect_uri: 'https://outro.exemplo/volta' }, /redirect_uri/],
    ['endereço de volta com barra a mais', { redirect_uri: `${VOLTA}/` }, /redirect_uri/],
    ['escopo vazio', { scope: '  ' }, /scope/],
    ['escopo repetido', { scope: 'conta.ler conta.ler' }, /repetida/],
    ['escopo de gravar (fora do catálogo do aplicativo)', { scope: 'conta.ler campanhas.disparar' }, /campanhas\.disparar/],
    ['escopo que não existe', { scope: 'conta.ler tudo.ler' }, /tudo\.ler/],
    ['state curto', { state: 'curto' }, /state/],
    ['state com espaço', { state: 'estado com espaço!!' }, /state/],
    ['método plain', { code_challenge_method: 'plain' }, /S256/],
    ['desafio com tamanho errado', { code_challenge: `${DESAFIO}x` }, /code_challenge/],
    ['conta sem nome', { conta_nome: ' ' }, /conta_nome/],
    ['CNPJ com dígitos a menos', { conta_cnpj: '11.222.333/0001' }, /conta_cnpj/],
    ['e-mail torto', { conta_email: 'sem-arroba' }, /conta_email/],
    ['marca longa demais', { conta_marca: 'x'.repeat(121) }, /conta_marca/],
  ])('recusa %s', (_caso, muda, frase) => {
    const r = conferirPedido(pedido(muda), LIAME, CLIENTE, [VOLTA]);
    expect(r).toEqual({ erro: expect.stringMatching(frase) });
  });
});

describe('as decisões', () => {
  it('outra empresa: CNPJ diferente ou ausente; o mesmo CNPJ com ou sem máscara não é', () => {
    expect(ehOutraEmpresa('11222333000100', '11.222.333/0001-00')).toBe(false);
    expect(ehOutraEmpresa('44555666000100', '11222333000100')).toBe(true);
    expect(ehOutraEmpresa(null, '11222333000100')).toBe(true);
    expect(ehOutraEmpresa('11222333000100', null)).toBe(true);
  });

  it('as permissões liberadas são as necessárias e as opcionais pedidas que o dono ligou, na ordem do catálogo', () => {
    const p = { necessarias: ['orcamento.ler', 'conta.ler'], opcionais: ['conversas.anuncio.ler'] };
    expect(permissoesLiberadas(p, [])).toEqual(['conta.ler', 'orcamento.ler']);
    expect(permissoesLiberadas(p, ['conversas.anuncio.ler'])).toEqual(['conta.ler', 'orcamento.ler', 'conversas.anuncio.ler']);
    // A opcional que o aplicativo não pediu não entra, nem que a tela mande.
    expect(permissoesLiberadas({ ...p, opcionais: [] }, ['conversas.anuncio.ler'])).toEqual(['conta.ler', 'orcamento.ler']);
  });

  it('o endereço de volta leva o código, o state e o iss, e guarda o parâmetro que o endereço cadastrado já tinha', () => {
    const u = new URL(enderecoDeVolta('https://liame.exemplo/v1/oauth/callback?origem=x', { code: 'rct_ac_abc', state: 'a b&c', iss: 'https://castapi.exemplo' }));
    expect(u.origin + u.pathname).toBe('https://liame.exemplo/v1/oauth/callback');
    expect(Object.fromEntries(u.searchParams)).toEqual({ origem: 'x', code: 'rct_ac_abc', state: 'a b&c', iss: 'https://castapi.exemplo' });
  });

  it('o endereço de volta da configuração: https, sem usuário e senha, sem fragmento (LIC-119)', () => {
    expect(enderecoDeVoltaInvalido('https://liame.exemplo/v1/oauth/callback', true)).toBeNull();
    expect(enderecoDeVoltaInvalido('http://localhost:3001/v1/oauth/callback', false)).toBeNull();
    expect(enderecoDeVoltaInvalido('http://localhost:3001/v1/oauth/callback', true)).toMatch(/https/);
    expect(enderecoDeVoltaInvalido('http://liame.exemplo/volta', false)).toMatch(/https/);
    expect(enderecoDeVoltaInvalido('https://liame.exemplo@outro.exemplo/volta', true)).toMatch(/usuário/);
    expect(enderecoDeVoltaInvalido('https://liame.exemplo/volta#x', true)).toMatch(/fragmento/);
    expect(enderecoDeVoltaInvalido('liame', true)).toMatch(/não é um endereço/);
  });
});

describe('a tela montada no servidor', () => {
  const entrada = {
    app: LIAME,
    empresa: { razaoSocial: 'Empresa Exemplo Ltda', cnpj: '33444555000100' },
    redirectUri: VOLTA,
    pedido: { necessarias: ['conta.ler', 'orcamento.ler'], opcionais: ['conversas.anuncio.ler'], contaQuePede: { nome: 'Agência Exemplo', cnpj: '44555666000100', email: 'ana@agencia.exemplo', marca: 'Marca Exemplo' } },
    conta: { nome: 'Hamburgueria Exemplo', cnpj: '11222333000100' },
    outraEmpresa: true,
    ligacaoAtiva: null,
  };

  it('mostra o aplicativo, a empresa com o CNPJ, a conta que pede, as permissões com o motivo e o que não pode', () => {
    const t = montarTela(entrada);
    expect(t.titulo).toBe('O Liame quer acessar a sua conta do Regemcast');
    expect(t.abertura).toBe(LIAME.faz);
    expect(t.aplicativo).toEqual(expect.objectContaining({ nome: 'Liame', selo: 'L', empresa: 'Empresa Exemplo Ltda', cnpj: '33.444.555/0001-00', inicio: LIAME.inicio }));
    expect(t.aplicativo.detalhes).toContain('(liame.exemplo)');
    expect(t.contaQuePede).toEqual({ nome: 'Agência Exemplo', cnpj: '44.555.666/0001-00', email: 'ana@agencia.exemplo', marca: 'Marca Exemplo', outraEmpresa: true });
    expect(t.conta).toEqual({ nome: 'Hamburgueria Exemplo', cnpj: '11.222.333/0001-00' });
    expect(t.necessarias.map((p) => p.id)).toEqual(['conta.ler', 'orcamento.ler']);
    expect(t.necessarias[0]).toEqual(expect.objectContaining({ rotulo: 'Situação da conta', motivo: LIAME.motivos['conta.ler'], dadoPessoal: false, semEla: null }));
    expect(t.opcionais).toEqual([expect.objectContaining({ id: 'conversas.anuncio.ler', dadoPessoal: true, semEla: LIAME.semAOpcional['conversas.anuncio.ler'] })]);
    expect(t.naoPode).toEqual(naoPode('Liame'));
    expect(t.naoPode.map((n) => n.frase).join(' ')).toContain('O Liame não recebe a sua senha');
    expect(t.jaLigada).toBeNull();
    expect(t.rodape).toContain('versão 1, de 20/10/2026');
  });

  it('com a conta já ligada, o pedido de mais permissões diz o que é novo; sem nada novo, é renovar', () => {
    const mais = montarTela({ ...entrada, ligacaoAtiva: { criadoEm: new Date('2026-10-02T15:00:00Z'), escopos: ['conta.ler', 'orcamento.ler'] } });
    expect(mais.titulo).toBe('O Liame pede mais uma permissão');
    expect(mais.jaLigada).toEqual({ desde: '2026-10-02T15:00:00.000Z', escopos: [{ id: 'conta.ler', rotulo: 'Situação da conta' }, { id: 'orcamento.ler', rotulo: 'Orçamento de disparos' }], novas: ['conversas.anuncio.ler'] });
    expect(mais.abertura).toContain('desde 02/10/2026');
    expect(mais.abertura).toContain('conversas abertas por anúncio');

    const renovar = montarTela({ ...entrada, ligacaoAtiva: { criadoEm: new Date('2026-10-02T15:00:00Z'), escopos: ['conta.ler', 'orcamento.ler', 'conversas.anuncio.ler'] } });
    expect(renovar.titulo).toBe('O Liame pede para renovar o acesso à sua conta');
    expect(renovar.jaLigada?.novas).toEqual([]);
  });

  it('o texto guardado é a tela com a decisão: cada opcional ligada ou não, e a confirmação só quando era outra empresa', () => {
    const t = montarTela(entrada);
    const guardado = textoGuardado(t, { opcionaisLigadas: ['conversas.anuncio.ler'], confirmouOutraEmpresa: true });
    expect(guardado).toEqual(expect.objectContaining({ titulo: t.titulo, versao: 1, confirmouOutraEmpresa: true }));
    expect((guardado.opcionais as { ligada: boolean }[])[0]!.ligada).toBe(true);

    const mesma = montarTela({ ...entrada, outraEmpresa: false });
    expect(textoGuardado(mesma, { opcionaisLigadas: [], confirmouOutraEmpresa: false })).toEqual(expect.objectContaining({ confirmouOutraEmpresa: null }));
  });

  it('o CNPJ sai com a máscara; o que não tem 14 dígitos sai como veio', () => {
    expect(formatarCnpj('11222333000100')).toBe('11.222.333/0001-00');
    expect(formatarCnpj('123')).toBe('123');
    expect(formatarCnpj(null)).toBe('');
  });
});
