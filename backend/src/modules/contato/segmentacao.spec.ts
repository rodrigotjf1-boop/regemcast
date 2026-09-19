/**
 * A classificação da base. Os limites de cada faixa são onde o erro mora: um
 * dia a mais transforma "Campeão" em "Fiel" e muda quem recebe a campanha.
 */
import { PARAMETROS_PADRAO as P, SEGMENTOS, classificar, descreverSegmentos, problemaNosParametros } from './segmentacao';

describe('classificar (30/90/180 dias, 5 pedidos)', () => {
  it.each([
    [null, 10, 'sem_historico'],
    [0, 5, 'campeoes'],
    [30, 12, 'campeoes'],
    [30, 1, 'novos'],
    [10, null, 'novos'], // comprou e não sabemos quantas vezes: ao menos uma
    [30, 4, 'promissores'],
    [31, 5, 'fieis'],
    [90, 9, 'fieis'],
    [60, 2, 'promissores'],
    [90, 1, 'atencao'],
    [91, 5, 'nao_posso_perder'],
    [180, 20, 'nao_posso_perder'],
    [120, 3, 'em_risco'],
    [120, 1, 'perdidos'],
    [181, 50, 'perdidos'],
  ] as const)('%s dias, %s pedidos → %s', (dias, pedidos, esperado) => {
    expect(classificar(dias, pedidos, P)).toBe(esperado);
  });

  it('respeita os números que o dono ajusta', () => {
    const p = { recenteDias: 7, ativoDias: 30, riscoDias: 60, fielPedidos: 10 };
    expect(classificar(8, 10, p)).toBe('fieis');
    expect(classificar(8, 9, p)).toBe('promissores');
    expect(classificar(61, 10, p)).toBe('perdidos');
  });
});

describe('descreverSegmentos', () => {
  it('tem nome e regra para todos os perfis, com os números da conta', () => {
    const d = descreverSegmentos(P);
    for (const s of SEGMENTOS) expect(d[s].nome.length).toBeGreaterThan(0);
    expect(d.campeoes.regra).toBe('Comprou nos últimos 30 dias e tem 5+ pedidos.');
    expect(d.em_risco.regra).toBe('2 a 4 pedidos, sumiu há 91 a 180 dias.');
    // Promissores nunca têm mais pedidos que os Campeões: é sempre 2 a (frequente − 1).
    expect(d.promissores.regra).toBe('2 a 4 pedidos, última compra em até 90 dias.');
  });
});

describe('problemaNosParametros', () => {
  it('exige recente < ativo < em risco', () => {
    expect(problemaNosParametros(P)).toBeNull();
    expect(problemaNosParametros({ ...P, recenteDias: 90 })).toMatch(/crescer/);
    expect(problemaNosParametros({ ...P, riscoDias: 90 })).toMatch(/crescer/);
  });
});
