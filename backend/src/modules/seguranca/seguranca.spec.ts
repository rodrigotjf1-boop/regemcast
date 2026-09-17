/**
 * Testes das peças puras da segurança da conta: código por e-mail, leitura da
 * resposta da Receita e o conteúdo dos e-mails.
 *
 * A conferência de código contra o banco (validade, 5 erros, uso único) é
 * provada de ponta a ponta no Postgres — mock de banco ali provaria só o mock.
 */
jest.mock('../../config/env', () => ({
  env: { producao: false, sessao: { segredo: 'segredo-de-teste' }, email: { resendChave: '' } },
}));

import { emailDeCodigo, emailDeConvite } from '../email/modelos-email';
import { mascararEmail } from '../email/email.service';
import { lerRespostaReceita } from './cnpj-receita.service';
import { hashDoCodigo, limparCodigo, novoCodigo } from './codigo-verificacao.service';

describe('código de verificação', () => {
  it('sempre tem 6 dígitos, inclusive com zero à esquerda', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(novoCodigo()).toMatch(/^\d{6}$/);
    }
  });

  it('não se repete em sequência (fonte aleatória de verdade)', () => {
    const vistos = new Set(Array.from({ length: 200 }, () => novoCodigo()));
    // 200 sorteios em um milhão: repetição é possível, mas não em massa.
    expect(vistos.size).toBeGreaterThan(190);
  });

  it('o hash depende do id: o mesmo código em duas linhas não se entrega', () => {
    expect(hashDoCodigo('id-a', '123456')).not.toBe(hashDoCodigo('id-b', '123456'));
    expect(hashDoCodigo('id-a', '123456')).toBe(hashDoCodigo('id-a', '123456'));
  });

  it('o hash não é o sha256 cru do código (senão um milhão de tentativas o acharia)', () => {
    const { createHash } = jest.requireActual<typeof import('node:crypto')>('node:crypto');
    const cru = createHash('sha256').update('123456').digest('hex');
    expect(hashDoCodigo('id-a', '123456')).not.toBe(cru);
  });

  it('aceita o código como aparece no e-mail, com espaço', () => {
    expect(limparCodigo('123 456')).toBe('123456');
    expect(limparCodigo('123-456')).toBe('123456');
    expect(limparCodigo(undefined as unknown as string)).toBe('');
  });
});

describe('resposta da Receita', () => {
  it('ATIVA libera', () => {
    const r = lerRespostaReceita('00000000000191', {
      razao_social: 'BANCO DO BRASIL SA',
      nome_fantasia: 'DIRECAO GERAL',
      descricao_situacao_cadastral: 'ATIVA',
    });
    expect(r.ativa).toBe(true);
    expect(r.razaoSocial).toBe('BANCO DO BRASIL SA');
  });

  it('BAIXADA não libera, e a situação vem escrita como a Receita escreve', () => {
    const r = lerRespostaReceita('11222333000181', {
      razao_social: 'EMPRESA ENCERRADA LTDA',
      descricao_situacao_cadastral: 'Baixada',
    });
    expect(r.ativa).toBe(false);
    expect(r.situacao).toBe('BAIXADA');
    expect(r.nomeFantasia).toBeNull();
  });

  it('resposta sem situação não vira "ativa" por padrão — recusa', () => {
    expect(() => lerRespostaReceita('11222333000181', { razao_social: 'X' })).toThrow();
  });
});

describe('e-mails', () => {
  it('o código aparece no texto e no HTML, e o assunto não entrega o código', () => {
    const e = emailDeCodigo('ana@empresa.com.br', 'login', '042917', 10);
    expect(e.texto).toContain('042 917');
    expect(e.html).toContain('042 917');
    expect(e.assunto).not.toContain('042');
    expect(e.texto).toContain('troque a sua senha');
  });

  it('o convite escapa HTML do nome (nome vem do formulário público)', () => {
    const e = emailDeConvite(
      'x@y.com',
      '<script>alert(1)</script>',
      'https://cast.dmsregem.com/convite/abc',
      new Date('2026-09-25T12:00:00Z'),
    );
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('https://cast.dmsregem.com/convite/abc');
  });

  it('mascara o e-mail para log', () => {
    expect(mascararEmail('maria@empresa.com')).toBe('ma***@empresa.com');
    expect(mascararEmail('sem-arroba')).toBe('***');
  });
});
