/**
 * A reserva das contas da sincronização com o Regem. O teste com o banco de
 * verdade (RLS ligada, papel da aplicação) mora fora da suíte; aqui fica a
 * FORMA da consulta, que é o que já quebrou uma vez na fila do disparo.
 */
import type { ContextoDb } from '../../db/contexto';
import { RegemJob } from './regem.job';

jest.mock('../../config/env', () => ({ env: { integracoes: { chave: 'x', regemUrl: 'http://127.0.0.1:9' } } }));
import type { RegemService } from './regem.service';

function montar(reservadas: string[] = []) {
  const db = { execute: jest.fn().mockResolvedValue({ rows: reservadas.map((conta_id) => ({ conta_id })) }) };
  const ctx = {
    comEscopoSistema: jest.fn((_motivo: string, fn: (d: typeof db) => unknown) => fn(db)),
  } as unknown as ContextoDb;
  const regem = { passo: jest.fn().mockResolvedValue(undefined) } as unknown as RegemService & { passo: jest.Mock };
  return { db, ctx, regem, job: new RegemJob(ctx, regem) };
}

const consulta = (m: ReturnType<typeof montar>) => JSON.stringify(m.db.execute.mock.calls[0]?.[0]);

/** O SQL como texto corrido (parâmetros no lugar), para conferir o aninhamento. */
const sqlCorrido = (m: ReturnType<typeof montar>) =>
  (m.db.execute.mock.calls[0]?.[0] as { queryChunks: unknown[] }).queryChunks
    .map((c) => (c && typeof c === 'object' && 'value' in c ? (c as { value: string[] }).value.join('') : String(c)))
    .join('')
    .replace(/\s+/g, ' ');

describe('RegemJob', () => {
  it('reserva com a CTE MATERIALIZADA — `where id in (select … limit N)` reserva mais que N com a RLS ligada', async () => {
    const m = montar();
    await m.job.reservar();
    expect(consulta(m)).toContain('as materialized');
    expect(consulta(m)).toContain('for update skip locked');
    expect(consulta(m)).not.toMatch(/where id in \(/);
  });

  it('só conta ligada e com a declaração do dono; respeita a trava e o próximo horário', async () => {
    const m = montar();
    await m.job.reservar();
    expect(consulta(m)).toContain('credencial_cifrada is not null');
    expect(consulta(m)).toContain('consentimento_em is not null');
    expect(consulta(m)).toContain('trava_ate is null or trava_ate < now()');
    expect(consulta(m)).toContain('proximo_em is null or proximo_em <= now()');
  });

  it('as vendas só andam com os clientes em dia', async () => {
    const m = montar();
    await m.job.reservar();
    expect(sqlCorrido(m)).toContain(
      "or (clientes_status = 'em_dia' and (clientes_ultima_consulta is null " +
        'or clientes_ultima_consulta < now() - make_interval(mins => 30) ' +
        "or pedidos_status = 'carga' or (pedidos_status = 'em_dia'",
    );
  });

  it('escopo de sistema só para reservar, com o motivo da tabela da RLS', async () => {
    const m = montar();
    await m.job.reservar();
    expect((m.ctx.comEscopoSistema as jest.Mock).mock.calls[0][0]).toBe('regem.fila');
  });

  it('uma volta roda um passo por conta reservada; falha de uma não derruba as outras', async () => {
    const m = montar(['conta-a', 'conta-b']);
    m.regem.passo.mockRejectedValueOnce(new Error('não devia subir'));
    await expect(m.job.volta()).resolves.toBeUndefined();
    expect(m.regem.passo).toHaveBeenCalledWith('conta-a');
    expect(m.regem.passo).toHaveBeenCalledWith('conta-b');
  });
});
