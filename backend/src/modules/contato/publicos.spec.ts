/**
 * As regras puras dos públicos prontos. A consulta de cada público roda contra
 * o Postgres de verdade no teste de ponta a ponta — aqui fica o que não
 * precisa de banco: validação, arredondamento dos limites e o texto da tela.
 */
import { PgDialect } from 'drizzle-orm/pg-core';

import {
  PUBLICOS,
  PUBLICOS_FIXOS,
  descreverPublico,
  emReais,
  expressaoPublico,
  validarPublico,
  type LimitesDosPublicos,
} from './publicos';

const L: LimitesDosPublicos = {
  vipCentavos: 48000,
  ticketBaixoAteCentavos: 3500,
  ticketAltoAcimaCentavos: 6000,
  ativoDias: 90,
};

const SEM_VALOR: LimitesDosPublicos = {
  vipCentavos: null,
  ticketBaixoAteCentavos: null,
  ticketAltoAcimaCentavos: null,
  ativoDias: 90,
};

const texto = (q: ReturnType<typeof expressaoPublico>) => new PgDialect().sqlToQuery(q);
/** O formatador de moeda põe um espaço que não quebra entre "R$" e o número. */
const regra = (...a: Parameters<typeof descreverPublico>) => descreverPublico(...a).regra.replace(/\u00a0/g, ' ');

describe('validarPublico', () => {
  it('aceita os fixos sem valor', () => {
    for (const p of PUBLICOS_FIXOS) expect(validarPublico(p, 'ignorado')).toEqual({ publico: p, valor: null });
  });

  it('bairro: exige o nome, arruma os espaços e recusa texto comprido', () => {
    expect(validarPublico('bairro', '  Vila   Isabel ')).toEqual({ publico: 'bairro', valor: 'Vila Isabel' });
    expect(validarPublico('bairro', '   ')).toEqual({ erro: 'Escolha o bairro.' });
    expect(validarPublico('bairro', 'x'.repeat(81))).toEqual({ erro: 'Escolha o bairro.' });
  });

  it('aniversário: mês de 1 a 12', () => {
    expect(validarPublico('aniversario', '10')).toEqual({ publico: 'aniversario', valor: '10' });
    for (const ruim of ['0', '13', '2.5', 'outubro', undefined]) {
      expect(validarPublico('aniversario', ruim)).toEqual({ erro: 'Escolha o mês do aniversário.' });
    }
  });

  it('público que não existe é recusado', () => {
    expect(validarPublico('todos', null)).toEqual({ erro: 'Público desconhecido.' });
    expect(validarPublico(undefined, null)).toEqual({ erro: 'Público desconhecido.' });
  });
});

describe('emReais', () => {
  it('o corte do VIP arredonda para baixo (inclui quem está no limite); os do ticket, para o mais perto', () => {
    expect(emReais(48735, 'baixo')).toBe(48700);
    expect(emReais(3549, 'perto')).toBe(3500);
    expect(emReais(3550, 'perto')).toBe(3600);
    expect(emReais(null, 'perto')).toBeNull();
    expect(emReais(Number.NaN, 'baixo')).toBeNull();
  });
});

describe('expressaoPublico', () => {
  it('sem valor gasto na base, VIP e faixas de ticket não pegam ninguém', () => {
    for (const p of ['vip', 'ticket_alto', 'ticket_medio', 'ticket_baixo'] as const) {
      expect(texto(expressaoPublico(p, null, SEM_VALOR)).sql).toBe('false');
    }
  });

  it('o limite entra como parâmetro, nunca colado no texto', () => {
    const q = texto(expressaoPublico('vip', null, L));
    expect(q.sql).toContain('contato.total_gasto_centavos >= $1');
    expect(q.params).toEqual([48000]);
    const b = texto(expressaoPublico('bairro', "Tijuca'; drop table contato; --", L));
    expect(b.sql).toBe('(lower(contato.bairro) = lower($1))');
  });

  it('as três faixas de ticket não se sobrepõem', () => {
    expect(texto(expressaoPublico('ticket_baixo', null, L)).sql).toContain('<= $');
    expect(texto(expressaoPublico('ticket_medio', null, L)).params).toEqual([3500, 6000]);
    expect(texto(expressaoPublico('ticket_alto', null, L)).sql).toContain('> $1');
  });

  it('toda definição de público tem uma expressão', () => {
    for (const p of PUBLICOS) expect(() => expressaoPublico(p, p === 'aniversario' ? '5' : 'X', L)).not.toThrow();
  });
});

describe('descreverPublico', () => {
  it('a regra traz os números da loja, em reais inteiros', () => {
    expect(regra('vip', null, L)).toBe('Os 10% que mais gastam: R$ 480 ou mais no total.');
    expect(regra('ticket_baixo', null, L)).toBe('Até R$ 35 por pedido, em média.');
    expect(regra('ticket_medio', null, L)).toBe('Mais de R$ 35 e até R$ 60 por pedido, em média.');
    expect(regra('ticket_alto', null, L)).toBe('Gastam, em média, mais de R$ 60 por pedido.');
    expect(descreverPublico('um_pedido', null, L).regra).toContain('últimos 90 dias');
  });

  it('bairro e aniversário levam o valor no nome', () => {
    expect(descreverPublico('bairro', 'Tijuca', L).nome).toBe('Bairro Tijuca');
    expect(descreverPublico('aniversario', '3', L).nome).toBe('Aniversariantes de março');
  });

  it('tickets todos parecidos: a faixa do meio diz que não existe, em vez de "de R$ 30 a R$ 30"', () => {
    const iguais = { ...L, ticketBaixoAteCentavos: 3000, ticketAltoAcimaCentavos: 3000 };
    expect(descreverPublico('ticket_medio', null, iguais).regra).toBe(
      'Sem faixa do meio: os tickets da loja são muito parecidos.',
    );
  });
});
