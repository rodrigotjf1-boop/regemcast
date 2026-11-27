/**
 * As regras do público (migration 053), sem banco: a conferência de cada tipo
 * de valor, as frases da tela e o catálogo. A condição em SQL de cada campo é
 * provada contra o Postgres em `regras-do-publico.pg.spec.ts`.
 */
import { PgDialect } from 'drizzle-orm/pg-core';

import {
  CAMPOS,
  COMPARACOES,
  IDS_DOS_CAMPOS,
  MAX_REGRAS,
  NOMES_DAS_COMPARACOES,
  centavosDe,
  descreverRegra,
  expressaoDaRegra,
  expressaoDasRegras,
  resumoDasRegras,
  validarParte,
  validarRegras,
  type RegraDoPublico,
} from './regras-do-publico';
import { PARAMETROS_PADRAO } from './segmentacao';

const CTX = { fuso: 'America/Sao_Paulo', parametros: PARAMETROS_PADRAO };
const dialeto = new PgDialect();
const emTexto = (r: RegraDoPublico) => dialeto.sqlToQuery(expressaoDaRegra(r, CTX));

/** Um valor válido de cada tipo, para passar por todos os campos. */
function valorDeExemplo(id: string): string {
  const c = CAMPOS.find((x) => x.id === id)!;
  if (c.opcoes) return c.opcoes[0]!.valor;
  switch (c.tipo) {
    case 'numero':
    case 'dias':
      return '3';
    case 'reais':
      return '80';
    case 'data':
      return '2026-11-01';
    case 'lista':
      return 'Centro';
  }
}

describe('validarRegras', () => {
  it('normaliza cada tipo: inteiro, reais com duas casas, data e opção', () => {
    const v = validarRegras([
      { campo: 'total_pedidos', comparacao: '>=', valor: ' 3 ' },
      { campo: 'ticket_medio', comparacao: '>', valor: '80,5' },
      { campo: 'primeiro_pedido', comparacao: '>=', valor: '2026-11-01' },
      { campo: 'perfil', comparacao: '=', valor: 'campeoes' },
      { campo: 'bairro', comparacao: '!=', valor: '  Jardim   América ' },
      { campo: 'dias_ultimo_pedido', comparacao: '<', valor: 45 },
    ]);
    expect(v).toEqual({
      regras: [
        { campo: 'total_pedidos', comparacao: '>=', valor: '3' },
        { campo: 'ticket_medio', comparacao: '>', valor: '80.50' },
        { campo: 'primeiro_pedido', comparacao: '>=', valor: '2026-11-01' },
        { campo: 'perfil', comparacao: '=', valor: 'campeoes' },
        { campo: 'bairro', comparacao: '!=', valor: 'Jardim América' },
        { campo: 'dias_ultimo_pedido', comparacao: '<', valor: '45' },
      ],
    });
  });

  it.each([
    [[], 'Monte ao menos uma regra.'],
    [null, 'Monte ao menos uma regra.'],
    [Array.from({ length: MAX_REGRAS + 1 }, () => ({ campo: 'total_pedidos', comparacao: '=', valor: '1' })), 'São no máximo 10 regras.'],
    [[{ campo: 'senha', comparacao: '=', valor: '1' }], 'Regra 1: escolha um campo da lista.'],
    [[{ campo: 'contato.id; drop table contato', comparacao: '=', valor: '1' }], 'Regra 1: escolha um campo da lista.'],
    [[{ campo: 'total_pedidos', comparacao: 'like', valor: '1' }], 'Regra 1: escolha a comparação.'],
    [[{ campo: 'total_pedidos', comparacao: '=', valor: '' }], 'Regra 1: informe o valor de "Total de pedidos".'],
    [[{ campo: 'total_pedidos', comparacao: '=', valor: '2.5' }], 'Regra 1: "Total de pedidos" pede um número inteiro, de 0 a 1.000.000.'],
    [[{ campo: 'total_pedidos', comparacao: '=', valor: '-1' }], 'Regra 1: "Total de pedidos" pede um número inteiro, de 0 a 1.000.000.'],
    [[{ campo: 'dias_ultimo_pedido', comparacao: '=', valor: '40000' }], 'Regra 1: "Dias desde o último pedido" pede um número inteiro de dias, de 0 a 36.500.'],
    [[{ campo: 'total_gasto', comparacao: '>', valor: '80,555' }], 'Regra 1: "Total gasto em pedidos" pede um valor em reais, como 80 ou 80,50.'],
    [[{ campo: 'ultimo_pedido', comparacao: '=', valor: '2026-02-31' }], 'Regra 1: escolha uma data válida em "Data do último pedido".'],
    [[{ campo: 'perfil', comparacao: '>', valor: 'campeoes' }], 'Regra 1: em "Perfil (classificação RFV)" a comparação é "é" ou "não é".'],
    [[{ campo: 'perfil', comparacao: '=', valor: 'vip' }], 'Regra 1: escolha uma das opções de "Perfil (classificação RFV)".'],
    [[{ campo: 'bairro', comparacao: '=', valor: 'x'.repeat(81) }], 'Regra 1: "Bairro" tem até 80 letras.'],
  ])('recusa %j com a frase da tela', (entrada, erro) => {
    expect(validarRegras(entrada)).toEqual({ erro });
  });

  it('diz em qual regra está o problema', () => {
    expect(
      validarRegras([
        { campo: 'total_pedidos', comparacao: '>=', valor: '3' },
        { campo: 'cashback_dias', comparacao: '<=', valor: 'muitos' },
      ]),
    ).toEqual({ erro: 'Regra 2: "Dias para o cashback vencer" pede um número inteiro de dias, de 0 a 36.500.' });
  });
});

describe('centavosDe', () => {
  it.each([
    ['80', 8000],
    ['80.5', 8050],
    ['80,50', 8050],
    ['0', 0],
    ['10000000', 1_000_000_000],
  ])('%s → %d centavos', (texto, centavos) => expect(centavosDe(texto)).toBe(centavos));

  it.each(['', 'abc', '1e3', '80.555', '-5', '100000000'])('%s não é dinheiro', (texto) => expect(centavosDe(texto)).toBeNull());
});

describe('validarParte', () => {
  it('sem as duas pontas, não há parte', () => expect(validarParte(undefined, null)).toEqual({ parte: null }));
  it('do 1 ao 500', () => expect(validarParte(1, 500)).toEqual({ parte: { de: 1, ate: 500 } }));
  it('o primeiro vem antes do último', () =>
    expect(validarParte(10, 2)).toEqual({ erro: 'Na parte, o primeiro contato vem antes do último.' }));
  it.each([
    [0, 10],
    [1.5, 10],
    [1, undefined],
  ])('recusa %p a %p', (de, ate) => expect('erro' in validarParte(de, ate)).toBe(true));
});

describe('as frases da tela', () => {
  it.each([
    [{ campo: 'total_pedidos', comparacao: '>=', valor: '3' }, 'Total de pedidos ≥ 3'],
    [{ campo: 'dias_ultimo_pedido', comparacao: '>', valor: '45' }, 'Dias desde o último pedido > 45 dias'],
    [{ campo: 'aniversario_dias', comparacao: '<=', valor: '1' }, 'Dias para o próximo aniversário ≤ 1 dia'],
    [{ campo: 'ticket_medio', comparacao: '>=', valor: '80.00' }, 'Ticket médio ≥ R$ 80,00'],
    [{ campo: 'primeiro_pedido', comparacao: '>=', valor: '2026-11-01' }, 'Data do primeiro pedido é no dia ou depois 01/11/2026'],
    [{ campo: 'perfil', comparacao: '=', valor: 'campeoes' }, 'Perfil (classificação RFV) é Campeões'],
    [{ campo: 'periodo', comparacao: '!=', valor: 'noite' }, 'Período do dia não é Noite'],
    [{ campo: 'estado', comparacao: '=', valor: 'RJ' }, 'Estado (pelo DDD) é Rio de Janeiro'],
    [{ campo: 'produto', comparacao: '=', valor: 'Pizza calabresa' }, 'Já comprou o produto é Pizza calabresa'],
  ] as Array<[RegraDoPublico, string]>)('%j → %s', (r, frase) => expect(descreverRegra(r).replace(/ /g, ' ')).toBe(frase));

  it('o resumo junta com "e" e corta no tamanho', () => {
    const regras: RegraDoPublico[] = [
      { campo: 'total_pedidos', comparacao: '>=', valor: '3' },
      { campo: 'dias_ultimo_pedido', comparacao: '>', valor: '45' },
    ];
    expect(resumoDasRegras(regras)).toBe('Total de pedidos ≥ 3 e Dias desde o último pedido > 45 dias');
    const curto = resumoDasRegras(regras, 20);
    // Corta no tamanho e tira o espaço que sobrar antes das reticências.
    expect(curto.length).toBeLessThanOrEqual(20);
    expect(curto).toBe('Total de pedidos ≥…');
  });
});

describe('o catálogo', () => {
  it('tem os campos do Cardápio Web que a API entrega, e não tem o último acesso ao site', () => {
    expect(IDS_DOS_CAMPOS).toEqual(
      expect.arrayContaining([
        'total_pedidos',
        'total_gasto',
        'ticket_medio',
        'dias_ultima_campanha',
        'cadastro_cw',
        'dias_cadastro_cw',
        'primeiro_pedido',
        'ultimo_pedido',
        'dias_ultimo_pedido',
        'aniversario_data',
        'aniversario_dias',
        'perfil',
      ]),
    );
    expect(IDS_DOS_CAMPOS.some((id) => /acesso/.test(id))).toBe(false);
    expect(new Set(IDS_DOS_CAMPOS).size).toBe(IDS_DOS_CAMPOS.length);
  });

  it('cada tipo tem as comparações da tela; a lista só "é" e "não é"', () => {
    for (const tipo of ['numero', 'reais', 'dias', 'data'] as const) {
      expect(NOMES_DAS_COMPARACOES[tipo].map((c) => c.valor)).toEqual([...COMPARACOES]);
    }
    expect(NOMES_DAS_COMPARACOES.lista.map((c) => c.valor)).toEqual(['=', '!=']);
    expect(NOMES_DAS_COMPARACOES.numero.map((c) => c.nome)).toEqual([
      'é igual a',
      'não é igual a',
      'é maior que',
      'é menor que',
      'é maior ou igual a',
      'é menor ou igual a',
    ]);
  });

  it('todo campo vira uma condição de verdade (nenhum cai no "false" de campo desconhecido)', () => {
    for (const id of IDS_DOS_CAMPOS) {
      const v = validarRegras([{ campo: id, comparacao: '=', valor: valorDeExemplo(id) }]);
      expect('regras' in v).toBe(true);
      const q = emTexto((v as { regras: RegraDoPublico[] }).regras[0]!);
      expect(q.sql).not.toBe('false');
      expect(q.sql).toContain('contato');
    }
  });

  it('o valor vai sempre como parâmetro, nunca no texto do SQL', () => {
    const q = emTexto({ campo: 'bairro', comparacao: '=', valor: "x') or true --" });
    expect(q.sql).not.toContain('or true');
    expect(q.params).toContain("x') or true --");
  });

  it('as regras se juntam com "and"; nenhuma regra não casa ninguém', () => {
    const q = dialeto.sqlToQuery(
      expressaoDasRegras(
        [
          { campo: 'total_pedidos', comparacao: '>=', valor: '3' },
          { campo: 'jeito', comparacao: '=', valor: 'entrega' },
        ],
        CTX,
      ),
    );
    expect(q.sql).toMatch(/\) and \(/);
    expect(dialeto.sqlToQuery(expressaoDasRegras([], CTX)).sql).toBe('false');
  });
});
