import { randomBytes } from 'node:crypto';

import {
  CriptoIndisponivelError,
  TokenCorrompidoError,
  cifrarToken,
  decifrarToken,
  mascararToken,
  segredosIguais,
} from './cripto';

const CHAVE = randomBytes(32).toString('base64');
const OUTRA_CHAVE = randomBytes(32).toString('base64');
const TOKEN = 'EAAJx1ZBexemploDeTokenLongoDaMeta0123456789abcdef';

describe('cripto do token da Meta', () => {
  it('cifra e decifra de volta ao original', () => {
    const guardado = cifrarToken(TOKEN, CHAVE);
    expect(decifrarToken(guardado, CHAVE)).toBe(TOKEN);
  });

  it('não guarda o token em claro no campo cifrado', () => {
    const guardado = cifrarToken(TOKEN, CHAVE);
    expect(guardado).not.toContain(TOKEN);
    // Nem um pedaço reconhecível: se um trecho de 12 caracteres aparecer, algo
    // está errado no modo de operação.
    expect(guardado).not.toContain(TOKEN.slice(0, 12));
  });

  it('gera saída diferente a cada chamada (IV novo)', () => {
    // Reusar IV em GCM quebra a confidencialidade, não só a integridade.
    const a = cifrarToken(TOKEN, CHAVE);
    const b = cifrarToken(TOKEN, CHAVE);
    expect(a).not.toBe(b);
    expect(decifrarToken(a, CHAVE)).toBe(decifrarToken(b, CHAVE));
  });

  it('marca a versão do formato, para permitir rotação de chave depois', () => {
    expect(cifrarToken(TOKEN, CHAVE).startsWith('v1.')).toBe(true);
  });

  it('recusa decifrar com a chave errada', () => {
    const guardado = cifrarToken(TOKEN, CHAVE);
    expect(() => decifrarToken(guardado, OUTRA_CHAVE)).toThrow(TokenCorrompidoError);
  });

  it('recusa conteúdo adulterado em vez de devolver lixo', () => {
    // É o motivo de usar GCM e não CBC: aqui a decifragem FALHA.
    const guardado = cifrarToken(TOKEN, CHAVE);
    const [v, iv, tag, cifra] = guardado.split('.');
    const bytes = Buffer.from(cifra!, 'base64url');
    bytes[0] = bytes[0]! ^ 0xff;
    const adulterado = [v, iv, tag, bytes.toString('base64url')].join('.');
    expect(() => decifrarToken(adulterado, CHAVE)).toThrow(TokenCorrompidoError);
  });

  it('recusa formato que não seja v1.iv.tag.cifra', () => {
    expect(() => decifrarToken('sou-um-token-em-claro', CHAVE)).toThrow(TokenCorrompidoError);
    expect(() => decifrarToken('', CHAVE)).toThrow(TokenCorrompidoError);
  });

  it('explica o que fazer quando a chave está ausente ou tem tamanho errado', () => {
    expect(() => cifrarToken(TOKEN, '')).toThrow(CriptoIndisponivelError);
    expect(() => cifrarToken(TOKEN, Buffer.alloc(16).toString('base64'))).toThrow(
      /32/,
    );
    // A mensagem precisa dizer como gerar — erro de configuração sem saída é
    // erro que custa uma hora de quem está fazendo o deploy.
    expect(() => cifrarToken(TOKEN, '')).toThrow(/openssl rand -base64 32/);
  });

  it('nunca coloca o conteúdo do token na mensagem de erro', () => {
    const guardado = cifrarToken(TOKEN, CHAVE);
    try {
      decifrarToken(guardado, OUTRA_CHAVE);
      fail('deveria ter lançado');
    } catch (erro) {
      expect((erro as Error).message).not.toContain(guardado);
      expect((erro as Error).message).not.toContain(TOKEN);
    }
  });
});

describe('mascararToken', () => {
  it('mostra só os quatro últimos caracteres', () => {
    expect(mascararToken('abcdefghijklmno')).toBe('••••lmno');
  });

  it('não vaza nada de token curto', () => {
    expect(mascararToken('abc')).toBe('••••');
    expect(mascararToken('')).toBe('');
  });
});

describe('segredosIguais', () => {
  it('aceita iguais e recusa diferentes', () => {
    expect(segredosIguais('token-secreto', 'token-secreto')).toBe(true);
    expect(segredosIguais('token-secreto', 'token-secretX')).toBe(false);
  });

  it('recusa tamanhos diferentes sem estourar', () => {
    expect(segredosIguais('curto', 'bem mais longo')).toBe(false);
  });

  it('trata ausência como não-igual', () => {
    expect(segredosIguais('', '')).toBe(true);
    expect(segredosIguais('algo', '')).toBe(false);
  });
});
