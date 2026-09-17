/**
 * Testes do código de duas etapas.
 *
 * O primeiro bloco usa os VETORES OFICIAIS da RFC 6238 (Apêndice B). Se a
 * implementação passar neles, ela gera os mesmos códigos que o Google
 * Authenticator — não há outra forma honesta de afirmar isso.
 */
import {
  codigoConfere,
  codigoDoPasso,
  deBase32,
  enderecoParaAplicativo,
  novoSegredo,
  paraBase32,
  PASSO_SEGUNDOS,
} from './totp';

describe('vetores oficiais da RFC 6238 (SHA-1, 8 dígitos)', () => {
  // O segredo da RFC é a string ASCII "12345678901234567890".
  const segredo = Buffer.from('12345678901234567890', 'ascii');

  const vetores: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  it.each(vetores)('T = %i segundos → %s', (segundos, esperado) => {
    const passo = Math.floor(segundos / PASSO_SEGUNDOS);
    expect(codigoDoPasso(segredo, passo, 8)).toBe(esperado);
  });
});

describe('base32', () => {
  it('ida e volta preservam os bytes', () => {
    const bytes = Buffer.from('12345678901234567890', 'ascii');
    expect(deBase32(paraBase32(bytes))).toEqual(bytes);
  });

  it('confere com a codificação conhecida', () => {
    // RFC 4648: "foobar" → "MZXW6YTBOI".
    expect(paraBase32(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('tolera espaços e minúsculas, como as pessoas digitam', () => {
    expect(deBase32('mzxw 6ytb oi')).toEqual(Buffer.from('foobar'));
  });

  it('recusa caractere fora do alfabeto', () => {
    expect(() => deBase32('MZXW1')).toThrow();
  });
});

describe('conferir o código digitado', () => {
  const segredo = novoSegredo();
  const agora = new Date('2026-09-16T15:00:15Z');
  const passo = Math.floor(agora.getTime() / 1000 / PASSO_SEGUNDOS);
  const codigo = (delta: number) => codigoDoPasso(deBase32(segredo), passo + delta);

  it('aceita o código do momento', () => {
    expect(codigoConfere(segredo, codigo(0), agora)).toBe(true);
  });

  it('aceita um passo para cada lado — o relógio do celular raramente bate', () => {
    expect(codigoConfere(segredo, codigo(-1), agora)).toBe(true);
    expect(codigoConfere(segredo, codigo(1), agora)).toBe(true);
  });

  it('RECUSA código de dois passos atrás: janela maior vira porta aberta', () => {
    expect(codigoConfere(segredo, codigo(-2), agora)).toBe(false);
  });

  it('recusa código errado', () => {
    const errado = codigo(0) === '000000' ? '111111' : '000000';
    expect(codigoConfere(segredo, errado, agora)).toBe(false);
  });

  it('aceita o código com espaço no meio, como aparece no aplicativo', () => {
    const c = codigo(0);
    expect(codigoConfere(segredo, `${c.slice(0, 3)} ${c.slice(3)}`, agora)).toBe(true);
  });

  it('recusa tamanho errado e lixo, sem estourar', () => {
    for (const lixo of ['', '12345', '1234567', 'abcdef', null, undefined]) {
      expect(codigoConfere(segredo, lixo as unknown as string, agora)).toBe(false);
    }
  });

  it('recusa quando o segredo guardado está corrompido, sem estourar', () => {
    expect(codigoConfere('!!!invalido!!!', '123456', agora)).toBe(false);
  });
});

describe('segredo e endereço do aplicativo', () => {
  it('cada segredo novo é diferente', () => {
    expect(novoSegredo()).not.toBe(novoSegredo());
  });

  it('o segredo tem 20 bytes, o recomendado para HMAC-SHA1', () => {
    expect(deBase32(novoSegredo())).toHaveLength(20);
  });

  it('monta o endereço otpauth que vira QR code', () => {
    const url = enderecoParaAplicativo('MZXW6YTBOI', 'rodrigo@dmsregem.com');
    expect(url.startsWith('otpauth://totp/')).toBe(true);
    expect(url).toContain('secret=MZXW6YTBOI');
    expect(url).toContain('digits=6');
    expect(url).toContain('period=30');
  });
});

describe('passoDoCodigo', () => {
  it('devolve o passo em que o código está e null quando não confere', () => {
    const { codigoDoPasso, deBase32, novoSegredo, passoDe, passoDoCodigo } = jest.requireActual('./totp');
    const segredo = novoSegredo();
    const agora = new Date('2026-09-17T12:00:10Z');
    const passo = passoDe(agora);
    expect(passoDoCodigo(segredo, codigoDoPasso(deBase32(segredo), passo), agora)).toBe(passo);
    expect(passoDoCodigo(segredo, codigoDoPasso(deBase32(segredo), passo - 1), agora)).toBe(passo - 1);
    expect(passoDoCodigo(segredo, codigoDoPasso(deBase32(segredo), passo + 5), agora)).toBeNull();
    expect(passoDoCodigo(segredo, '12', agora)).toBeNull();
  });
});
