/** Hub DMS F5 parte E: a escrita que sai do token antigo do produto, com a chave ligada. */
import { escritaForaDoToken, escritaSoPelaLigacaoLigada, tokenAindaTem } from './escrita-pela-ligacao';

const TODAS = ['conta.ler', 'campanhas.ler', 'modelos.rascunhar', 'campanhas.rascunhar', 'campanhas.disparar'];

describe('a escrita que sai do token antigo (F5 parte E)', () => {
  it('desligada, nada muda; ligada, o token do Liame perde a escrita e segue lendo', () => {
    expect(escritaForaDoToken('liame', TODAS, false)).toEqual(TODAS);
    expect(escritaForaDoToken('liame', TODAS, true)).toEqual(['conta.ler', 'campanhas.ler']);
  });

  it('o produto que não está na lista não perde nada, nem com a chave ligada', () => {
    expect(escritaForaDoToken('gogem', TODAS, true)).toEqual(TODAS);
    expect(tokenAindaTem('gogem', 'campanhas.disparar', true)).toBe(true);
  });

  it('o token do Liame deixa de valer como credencial que dispara só com a chave ligada', () => {
    expect(tokenAindaTem('liame', 'campanhas.disparar', false)).toBe(true);
    expect(tokenAindaTem('liame', 'campanhas.disparar', true)).toBe(false);
    expect(tokenAindaTem('liame', 'conta.ler', true)).toBe(true);
  });

  it('só `true` liga a chave', () => {
    for (const v of [false, 'true', 1, undefined, null]) expect(escritaSoPelaLigacaoLigada(v)).toBe(false);
    expect(escritaSoPelaLigacaoLigada(true)).toBe(true);
  });
});
