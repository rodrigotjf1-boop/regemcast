/**
 * As regras puras dos hábitos de compra: o período de cada hora, o SQL que o
 * banco usa para o mesmo corte e a sugestão de horário da campanha. O cálculo
 * sobre as compras de verdade (fuso da conta, empate, produtos) roda contra o
 * Postgres no teste de ponta a ponta.
 */
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
  JANELA_SUGERIDA,
  MINIMO_PARA_SUGERIR,
  PERIODOS,
  periodoDaHora,
  periodoDaHoraSql,
  sugerirHorario,
} from './habitos';
import { termoDoLike } from './publicos';

describe('periodoDaHora', () => {
  it('corta nas bordas certas: o fim de cada período já é o próximo', () => {
    const esperado: [number, string][] = [
      [0, 'madrugada'],
      [5, 'madrugada'],
      [6, 'cafe'],
      [10, 'cafe'],
      [11, 'almoco'],
      [14, 'almoco'],
      [15, 'tarde'],
      [17, 'tarde'],
      [18, 'noite'],
      [23, 'noite'],
    ];
    for (const [hora, periodo] of esperado) expect(periodoDaHora(hora)).toBe(periodo);
  });

  it('toda hora do dia cai em um período', () => {
    for (let h = 0; h < 24; h++) expect(PERIODOS).toContain(periodoDaHora(h));
  });
});

describe('periodoDaHoraSql', () => {
  it('é o mesmo corte, com as constantes no texto e nenhum parâmetro', () => {
    const q = new PgDialect().sqlToQuery(periodoDaHoraSql(sql`h`));
    expect(q.params).toEqual([]);
    expect(q.sql).toBe(
      "(case when h < 6 then 'madrugada' when h < 11 then 'cafe' when h < 15 then 'almoco' when h < 18 then 'tarde' else 'noite' end)",
    );
  });
});

describe('sugerirHorario', () => {
  it('com um período que reúne a maior parte de quem tem compra, sugere a janela dele', () => {
    const r = sugerirHorario(500, { noite: 62, almoco: 25, tarde: 13 });
    expect(r.comHabito).toBe(100);
    expect(r.periodos.map((p) => p.periodo)).toEqual(['noite', 'almoco', 'tarde']);
    expect(r.sugestao).toEqual({ periodo: 'noite', percentual: 62, inicio: '17:00', fim: '19:00' });
  });

  it('com pouca gente com compra, não sugere — uma porcentagem de meia dúzia engana', () => {
    const r = sugerirHorario(300, { noite: MINIMO_PARA_SUGERIR - 1 });
    expect(r.comHabito).toBe(MINIMO_PARA_SUGERIR - 1);
    expect(r.sugestao).toBeNull();
    expect(sugerirHorario(300, { noite: MINIMO_PARA_SUGERIR }).sugestao?.periodo).toBe('noite');
  });

  it('sem um período que se destaque (menos de 40%), não sugere, mas mostra como se divide', () => {
    const r = sugerirHorario(100, { noite: 39, almoco: 31, tarde: 30 });
    expect(r.sugestao).toBeNull();
    expect(r.periodos[0]).toEqual({ periodo: 'noite', total: 39 });
    expect(sugerirHorario(100, { noite: 40, almoco: 30, tarde: 30 }).sugestao?.percentual).toBe(40);
  });

  it('a porcentagem arredonda para baixo (66,6% → 66%), e o corte usa a conta exata (39,6% não sugere)', () => {
    expect(sugerirHorario(1000, { noite: 666, almoco: 334 }).sugestao?.percentual).toBe(66);
    expect(sugerirHorario(1000, { noite: 396, almoco: 304, tarde: 300 }).sugestao).toBeNull();
  });

  it('empate: vence o que vem antes no dia', () => {
    expect(sugerirHorario(100, { noite: 50, almoco: 50 }).sugestao?.periodo).toBe('almoco');
  });

  it('lista sem ninguém com compra: sem períodos e sem sugestão', () => {
    expect(sugerirHorario(40, {})).toEqual({ total: 40, comHabito: 0, minimo: MINIMO_PARA_SUGERIR, periodos: [], sugestao: null });
  });

  it('a janela sugerida nunca começa antes das 8h nem termina depois das 21h', () => {
    for (const p of PERIODOS) {
      expect(JANELA_SUGERIDA[p].inicio >= '08:00').toBe(true);
      expect(JANELA_SUGERIDA[p].fim <= '21:00').toBe(true);
      expect(JANELA_SUGERIDA[p].inicio < JANELA_SUGERIDA[p].fim).toBe(true);
    }
  });
});

describe('termoDoLike', () => {
  it('%, _ e a barra valem como letra na busca de produto', () => {
    expect(termoDoLike('100% suco')).toBe('100\\% suco');
    expect(termoDoLike('x_burguer')).toBe('x\\_burguer');
    expect(termoDoLike('a\\b')).toBe('a\\\\b');
    expect(termoDoLike('Pizza')).toBe('Pizza');
  });
});
