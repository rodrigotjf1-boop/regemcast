import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ajustarParte,
  mesmasRegras,
  publicoDasRegras,
  regraNova,
  regrasCompletas,
  tamanhoDaParte,
  trocarCampo,
  type RegraNaTela,
} from './regras-do-publico.ts';
import type { CatalogoDasRegras } from './tipos.ts';

const NUMERICAS = [
  { valor: '=', nome: 'é igual a' },
  { valor: '!=', nome: 'não é igual a' },
  { valor: '>', nome: 'é maior que' },
  { valor: '<', nome: 'é menor que' },
  { valor: '>=', nome: 'é maior ou igual a' },
  { valor: '<=', nome: 'é menor ou igual a' },
] as const;

const CATALOGO: CatalogoDasRegras = {
  campos: [
    { id: 'total_pedidos', nome: 'Total de pedidos', grupo: 'Compras', tipo: 'numero' },
    { id: 'dias_ultimo_pedido', nome: 'Dias desde o último pedido', grupo: 'Compras', tipo: 'dias' },
    { id: 'cashback_dias', nome: 'Dias para o cashback vencer', grupo: 'Cashback', tipo: 'dias' },
    { id: 'primeiro_pedido', nome: 'Data do primeiro pedido', grupo: 'Compras', tipo: 'data' },
    { id: 'bairro', nome: 'Bairro', grupo: 'Onde', tipo: 'lista', opcoesDe: 'bairros' },
    { id: 'jeito', nome: 'Jeito de comprar', grupo: 'Onde', tipo: 'lista', opcoes: [{ valor: 'entrega', nome: 'Entrega' }] },
  ],
  comparacoes: {
    numero: [...NUMERICAS],
    reais: [...NUMERICAS],
    dias: [...NUMERICAS],
    data: [
      { valor: '=', nome: 'é no dia' },
      { valor: '>', nome: 'é depois de' },
    ],
    lista: [
      { valor: '=', nome: 'é' },
      { valor: '!=', nome: 'não é' },
    ],
  },
  maxRegras: 10,
};

const regra = (campo: string, comparacao: RegraNaTela['comparacao'], valor: string): RegraNaTela => ({
  chave: `${campo}-${valor}`,
  campo,
  comparacao,
  valor,
});

describe('regras do público na tela', () => {
  it('a regra nova nasce no primeiro campo, com "é maior ou igual a" e sem valor', () => {
    const r = regraNova(CATALOGO);
    assert.ok(r);
    assert.equal(r.campo, 'total_pedidos');
    assert.equal(r.comparacao, '>=');
    assert.equal(r.valor, '');
  });

  it('trocar para outro campo do mesmo tipo guarda a comparação e o valor', () => {
    const r = trocarCampo(CATALOGO, regra('dias_ultimo_pedido', '>', '45'), 'cashback_dias');
    assert.equal(r.campo, 'cashback_dias');
    assert.equal(r.comparacao, '>');
    assert.equal(r.valor, '45');
  });

  it('número e dias são tipos diferentes: a troca entre eles limpa o valor', () => {
    const r = trocarCampo(CATALOGO, regra('total_pedidos', '>', '3'), 'dias_ultimo_pedido');
    assert.equal(r.comparacao, '>=');
    assert.equal(r.valor, '');
  });

  it('trocar para outro tipo limpa o valor e volta a comparação à inicial do tipo novo', () => {
    const r = trocarCampo(CATALOGO, regra('total_pedidos', '>', '3'), 'primeiro_pedido');
    assert.equal(r.campo, 'primeiro_pedido');
    assert.equal(r.comparacao, '=');
    assert.equal(r.valor, '');
    const l = trocarCampo(CATALOGO, regra('total_pedidos', '<=', '3'), 'bairro');
    assert.equal(l.comparacao, '=');
    assert.equal(l.valor, '');
  });

  it('de uma lista para outra lista: a comparação fica, o valor (que era da outra lista) some', () => {
    const r = trocarCampo(CATALOGO, regra('bairro', '!=', 'Centro'), 'jeito');
    assert.equal(r.comparacao, '!=');
    assert.equal(r.valor, '');
  });

  it('só monta o público com todas as regras preenchidas', () => {
    assert.equal(regrasCompletas([]), false);
    assert.equal(publicoDasRegras([regra('total_pedidos', '>=', '3'), regra('bairro', '=', ' ')], null, null), null);
    const p = publicoDasRegras([regra('total_pedidos', '>=', ' 3 ')], null, null);
    assert.deepEqual(p, { origem: 'regras', regras: [{ campo: 'total_pedidos', comparacao: '>=', valor: '3' }] });
  });

  it('leva o público salvo e a parte só quando há', () => {
    const p = publicoDasRegras([regra('total_pedidos', '>=', '3')], 'salvo-1', { de: 1, ate: 500 });
    assert.equal(p?.publicoSalvoId, 'salvo-1');
    assert.equal(p?.parteDe, 1);
    assert.equal(p?.parteAte, 500);
  });

  it('o público salvo vale enquanto as regras são as mesmas, na mesma ordem', () => {
    const a = [regra('total_pedidos', '>=', '3'), regra('dias_ultimo_pedido', '>', '45')];
    assert.equal(mesmasRegras(a, [{ campo: 'total_pedidos', comparacao: '>=', valor: '3' }, { campo: 'dias_ultimo_pedido', comparacao: '>', valor: '45' }]), true);
    assert.equal(mesmasRegras(a, [a[1], a[0]]), false);
    assert.equal(mesmasRegras(a, [a[0], { ...a[1], valor: '46' }]), false);
    assert.equal(mesmasRegras(a, [a[0]]), false);
  });

  it('a parte fica dentro do público: de pelo menos 1, até pelo menos de, os dois até o total', () => {
    assert.deepEqual(ajustarParte(0, 500, 300), { de: 1, ate: 300 });
    assert.deepEqual(ajustarParte(400, 200, 1000), { de: 400, ate: 400 });
    assert.deepEqual(ajustarParte(900, 2000, 500), { de: 500, ate: 500 });
    assert.deepEqual(ajustarParte(Number.NaN, Number.NaN, null), { de: 1, ate: 1 });
    assert.deepEqual(ajustarParte(10, 20, null), { de: 10, ate: 20 });
    assert.equal(tamanhoDaParte({ de: 101, ate: 600 }), 500);
  });
});
