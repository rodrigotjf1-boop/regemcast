/**
 * "Quem recebe → Da base": o nome que o cartão da campanha mostra e o que o
 * DTO aceita. A montagem de verdade (a foto dos contatos, a prévia batendo com
 * ela) roda contra o Postgres no teste de ponta a ponta.
 */
// A cadeia do DTO passa pelo `config/env`, que é fail-fast no import: aqui
// nada toca banco, então o env vira objeto vazio (como no teste da conta).
jest.mock('../../config/env', () => ({ env: {} }));

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PublicoDaCampanhaDto } from './dto/publico-da-campanha.dto';
import { rotuloDoPublico } from './rotulo-do-publico';

const mensagens = async (corpo: object) => {
  const erros = await validate(plainToInstance(PublicoDaCampanhaDto, corpo));
  return erros.flatMap((e) => Object.values(e.constraints ?? {}));
};

describe('rotuloDoPublico', () => {
  it('diz de onde veio o público, com o nome que a tela usa', () => {
    expect(rotuloDoPublico('base', 'Base inteira')).toBe('Toda a base');
    expect(rotuloDoPublico('importacao', 'clientes.xlsx')).toBe('Importação: clientes.xlsx');
    expect(rotuloDoPublico('perfil', 'Em risco')).toBe('Perfil: Em risco');
    expect(rotuloDoPublico('regiao', 'Rio de Janeiro')).toBe('Estado: Rio de Janeiro');
    expect(rotuloDoPublico('publico', 'Pedem à noite')).toBe('Pedem à noite');
  });

  it('lista e números não ganham rótulo: o cartão já mostra a lista (ou nada)', () => {
    expect(rotuloDoPublico('lista', 'Clientes')).toBeNull();
    expect(rotuloDoPublico('numeros', '')).toBeNull();
  });
});

describe('PublicoDaCampanhaDto', () => {
  it('aceita cada origem com o que ela pede', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    for (const corpo of [
      { origem: 'base' },
      { origem: 'lista', origemId: id },
      { origem: 'importacao', origemId: id },
      { origem: 'perfil', segmento: 'em_risco' },
      { origem: 'regiao', uf: 'RJ' },
      { origem: 'publico', publico: 'vip' },
      { origem: 'publico', publico: 'produto', publicoValor: 'Pizza Calabresa' },
    ]) {
      expect(await mensagens(corpo)).toEqual([]);
    }
  });

  it('recusa com a frase para a tela quando falta o que a origem pede', async () => {
    expect(await mensagens({ origem: 'importacao' })).toEqual(['Escolha a lista ou a importação.']);
    expect(await mensagens({ origem: 'perfil', segmento: 'qualquer' })).toEqual(['Escolha o perfil.']);
    expect(await mensagens({ origem: 'publico' })).toEqual(['Escolha o público.']);
    expect(await mensagens({ origem: 'regiao', uf: 'RJX' })).toEqual(['Escolha o estado.']);
    expect(await mensagens({ origem: 'toda' })).toEqual(['Escolha de onde sai o público.']);
  });

  it('o valor do público tem o mesmo teto dos públicos (80 letras)', async () => {
    expect(await mensagens({ origem: 'publico', publico: 'produto', publicoValor: 'x'.repeat(81) })).toHaveLength(1);
  });
});
