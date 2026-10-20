import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { destinoSeguro, voltaParaAutorizacao } from './destino-seguro.ts';

// Para onde o navegador iria com o destino devolvido, a partir da página de login.
const SITE = 'https://app.regemcast.exemplo/entrar?de=x';
const origemDe = (destino: string) => new URL(destino, SITE).origin;
const ORIGEM_DO_SITE = new URL(SITE).origin;

describe('destinoSeguro (o destino depois de entrar)', () => {
  it('mantém o caminho interno como veio, com a busca e a âncora', () => {
    const autorizacao = '/integracoes/autorizar?client_id=liame&request_uri=urn%3Aietf%3Aparams%3Aoauth%3Arequest_uri%3Arct_x';
    assert.equal(destinoSeguro(autorizacao), autorizacao);
    assert.equal(destinoSeguro('/disparos?pagina=2#lista'), '/disparos?pagina=2#lista');
    assert.equal(destinoSeguro('/painel'), '/painel');
  });

  it('sem destino, ou com endereço de outro site, vai para o padrão', () => {
    assert.equal(destinoSeguro(null), '/painel');
    assert.equal(destinoSeguro(''), '/painel');
    assert.equal(destinoSeguro('https://outro.exemplo/entrar'), '/painel');
    assert.equal(destinoSeguro('javascript:alert(1)'), '/painel');
    assert.equal(destinoSeguro('painel'), '/painel');
    assert.equal(destinoSeguro(null, '/integracoes'), '/integracoes');
  });

  // Os truques que já passaram por uma conferência de texto (ERR-050): barra invertida, tab e quebra de linha (o
  // navegador lê a barra invertida como barra e descarta os dois), e o segmento de ponto que, remontado, vira "//".
  const truques = [
    '//outro.exemplo',
    '//outro.exemplo//x',
    '/\\outro.exemplo/x',
    '/\\/outro.exemplo',
    '/\t/outro.exemplo',
    '/\n/outro.exemplo',
    '/\r/outro.exemplo',
    '/.//outro.exemplo',
    '/..//outro.exemplo',
    '/a/..//outro.exemplo',
    '/%2e//outro.exemplo',
    '/.//outro.exemplo/x?y=1#z',
  ];
  for (const truque of truques) {
    it(`${JSON.stringify(truque)} não sai do site`, () => {
      const destino = destinoSeguro(truque);
      assert.equal(origemDe(destino), ORIGEM_DO_SITE, `devolveu ${JSON.stringify(destino)}`);
    });
  }

  it('a barra invertida e o caractere de controle são recusados mesmo quando não sairiam do site', () => {
    assert.equal(destinoSeguro('/painel\\x'), '/painel');
    assert.equal(destinoSeguro('/painel\u0000'), '/painel');
    assert.equal(destinoSeguro('/painel\u007f'), '/painel');
  });
});

describe('voltaParaAutorizacao (o aviso do login)', () => {
  it('só a página da autorização por clique, com ou sem a busca', () => {
    assert.equal(voltaParaAutorizacao('/integracoes/autorizar'), true);
    assert.equal(voltaParaAutorizacao('/integracoes/autorizar?client_id=liame'), true);
    assert.equal(voltaParaAutorizacao('/integracoes/autorizarx'), false);
    assert.equal(voltaParaAutorizacao('/integracoes'), false);
    assert.equal(voltaParaAutorizacao('/painel'), false);
  });
});
