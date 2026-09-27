/**
 * As variáveis da campanha: o que ela guarda para a conferência na hora do
 * envio e o que o DTO aceita. O valor de cada variável (o SQL de "R$ 1.234,50"
 * e "30/09") roda contra o Postgres no teste de ponta a ponta.
 */
// A cadeia do DTO passa pelo `config/env`, que é fail-fast no import: aqui
// nada toca banco, então o env vira objeto vazio (como no teste da conta).
jest.mock('../../config/env', () => ({ env: {} }));

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { VariavelDeListaDto } from './dto/criar-campanha.dto';
import { PreviaDoPublicoDto } from './dto/publico-da-campanha.dto';
import { ehDeCashback, lerVariaveis, normalizarVariaveis, usaCashback } from './variaveis';

const mensagens = async <T extends object>(classe: new () => T, corpo: object) => {
  const erros = await validate(plainToInstance(classe, corpo));
  return erros.flatMap((e) => Object.values(e.constraints ?? {}));
};

describe('variáveis da campanha', () => {
  it('reconhece as de cashback', () => {
    expect(ehDeCashback({ origem: 'cashback_saldo' })).toBe(true);
    expect(ehDeCashback({ origem: 'cashback_validade' })).toBe(true);
    expect(ehDeCashback({ origem: 'nome' })).toBe(false);
    expect(usaCashback([{ origem: 'fixo' }, { origem: 'cashback_validade' }])).toBe(true);
    expect(usaCashback([{ origem: 'fixo' }, { origem: 'primeiro_nome' }])).toBe(false);
    expect(usaCashback(null)).toBe(false);
  });

  it('o saldo não guarda texto reserva: quem recebe sempre tem saldo', () => {
    expect(
      normalizarVariaveis([
        { origem: 'cashback_saldo', valor: 'qualquer coisa' },
        { origem: 'cashback_validade', valor: 'sem prazo' },
        { origem: 'primeiro_nome', valor: 'cliente' },
      ]),
    ).toEqual([
      { origem: 'cashback_saldo', valor: '' },
      { origem: 'cashback_validade', valor: 'sem prazo' },
      { origem: 'primeiro_nome', valor: 'cliente' },
    ]);
    expect(normalizarVariaveis(undefined)).toEqual([]);
  });

  it('lê o que a campanha guardou; lista estranha vira null (a conferência do envio não roda às cegas)', () => {
    const guardada = [
      { origem: 'primeiro_nome', valor: 'cliente' },
      { origem: 'cashback_saldo', valor: '' },
    ];
    expect(lerVariaveis(guardada)).toEqual(guardada);
    expect(lerVariaveis([])).toEqual([]);
    expect(lerVariaveis(null)).toBeNull();
    expect(lerVariaveis({ origem: 'fixo', valor: 'x' })).toBeNull();
    expect(lerVariaveis([{ origem: 'pontos', valor: 'x' }])).toBeNull();
    expect(lerVariaveis([{ origem: 'fixo' }])).toBeNull();
  });
});

describe('VariavelDeListaDto', () => {
  it('o saldo do cashback dispensa o texto reserva', async () => {
    expect(await mensagens(VariavelDeListaDto, { origem: 'cashback_saldo' })).toEqual([]);
  });

  it('a validade pede o texto para quem não tem data para vencer', async () => {
    expect(await mensagens(VariavelDeListaDto, { origem: 'cashback_validade' })).toContain('Preencha o valor da variável.');
    expect(await mensagens(VariavelDeListaDto, { origem: 'cashback_validade', valor: 'sem prazo' })).toEqual([]);
  });

  it('nome e texto fixo continuam exigindo o valor', async () => {
    expect(await mensagens(VariavelDeListaDto, { origem: 'nome', valor: '' })).toContain('Preencha o valor da variável.');
    expect(await mensagens(VariavelDeListaDto, { origem: 'fixo', valor: 'Oi' })).toEqual([]);
  });

  it('origem desconhecida é recusada', async () => {
    expect(await mensagens(VariavelDeListaDto, { origem: 'pontos', valor: 'x' })).toContain('Origem da variável inválida.');
  });
});

describe('PreviaDoPublicoDto', () => {
  it('aceita o público com ou sem "só com cashback"', async () => {
    expect(await mensagens(PreviaDoPublicoDto, { origem: 'base' })).toEqual([]);
    expect(await mensagens(PreviaDoPublicoDto, { origem: 'base', soComCashback: true })).toEqual([]);
  });

  it('"só com cashback" é sim ou não', async () => {
    expect(await mensagens(PreviaDoPublicoDto, { origem: 'base', soComCashback: 'sim' })).toContain(
      'soComCashback precisa ser verdadeiro ou falso.',
    );
  });
});
