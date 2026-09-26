/**
 * ERR-018: as marcações da fila (quem pediu para sair, número sem WhatsApp)
 * rodam a cada rodada do envio, sobre a fila inteira. Cruzar `contato` com
 * `campanha_destinatario` por `in (telefone, gêmeo)` fazia o plano varrer
 * todos os contatos uma vez por destinatário — 7 s com 2.585, além dos 30 s
 * do limite com 13 mil. O formato que o banco planeja bem é: as formas do
 * celular dos contatos marcados numa CTE MATERIALIZED, cruzadas por igualdade,
 * só da conta da campanha. Este teste guarda esse formato; a medida de
 * verdade roda contra o Postgres no teste de ponta a ponta.
 */
jest.mock('../../config/env', () => ({ env: {} }));

import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { marcarSemWhatsappNaFila } from '../contato/sem-whatsapp';
import { marcarDescadastrados } from './campanha.service';

const CONTA = '11111111-1111-4111-8111-111111111111';

async function sqlDe(marcar: (db: { execute: (q: SQL) => Promise<{ rows: unknown[] }> }, conta: string, filtro: SQL) => Promise<void>) {
  const vistos: SQL[] = [];
  await marcar({ execute: async (q) => (vistos.push(q), { rows: [] }) }, CONTA, sql`d.campanha_id = ${'c1'}`);
  expect(vistos).toHaveLength(1);
  return new PgDialect().sqlToQuery(vistos[0]!);
}

describe.each([
  ['marcarDescadastrados', marcarDescadastrados, 'c.opt_out = true'],
  ['marcarSemWhatsappNaFila', marcarSemWhatsappNaFila, 'c.sem_whatsapp_em is not null'],
])('%s', (_nome, marcar, condicao) => {
  it('lê os contatos marcados UMA vez (CTE materialized) e cruza por igualdade', async () => {
    const q = await sqlDe(marcar);
    expect(q.sql).toMatch(/^\s*with m as materialized/);
    expect(q.sql).toContain(condicao);
    expect(q.sql).toContain('d.telefone_e164 = m.telefone');
    // O formato que varria a tabela de contatos por destinatário não volta.
    expect(q.sql).not.toMatch(/in \(d\.telefone_e164/);
  });

  it('só a conta da campanha, dos dois lados', async () => {
    const q = await sqlDe(marcar);
    expect(q.sql).toContain('c.conta_id = $');
    expect(q.sql).toContain('d.conta_id = $');
    expect(q.params.filter((p) => p === CONTA)).toHaveLength(2);
  });

  it('as duas formas do celular saem do lado do contato (o gêmeo é de mão dupla)', async () => {
    const q = await sqlDe(marcar);
    expect(q.sql).toContain('cross join lateral (values (c.telefone_e164)');
  });
});
