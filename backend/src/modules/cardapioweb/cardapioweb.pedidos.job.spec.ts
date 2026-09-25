/**
 * A reserva das lojas da sincronização de pedidos. O teste com o banco de
 * verdade (RLS ligada, papel da aplicação) mora fora da suíte; aqui fica a
 * FORMA da consulta, que é o que já quebrou uma vez na fila do disparo.
 */
import type { ContextoDb } from '../../db/contexto';
import { CardapiowebPedidosJob } from './cardapioweb.pedidos.job';

jest.mock('../../config/env', () => ({ env: { integracoes: { chave: 'x', cardapiowebUrl: 'http://127.0.0.1:9' } } }));
import type { PedidosCardapiowebService } from './cardapioweb.pedidos.service';

function montar(reservadas: string[] = []) {
  const db = { execute: jest.fn().mockResolvedValue({ rows: reservadas.map((conta_id) => ({ conta_id })) }) };
  const ctx = {
    comEscopoSistema: jest.fn((_motivo: string, fn: (d: typeof db) => unknown) => fn(db)),
  } as unknown as ContextoDb;
  const pedidos = { passo: jest.fn().mockResolvedValue(undefined) } as unknown as PedidosCardapiowebService & {
    passo: jest.Mock;
  };
  return { db, ctx, pedidos, job: new CardapiowebPedidosJob(ctx, pedidos) };
}

const consulta = (m: ReturnType<typeof montar>) => JSON.stringify(m.db.execute.mock.calls[0]?.[0]);

describe('CardapiowebPedidosJob', () => {
  it('reserva com a CTE MATERIALIZADA — `where id in (select … limit N)` reserva mais que N com a RLS ligada', async () => {
    const m = montar();
    await m.job.reservar();
    expect(consulta(m)).toContain('as materialized');
    expect(consulta(m)).toContain('for update skip locked');
    expect(consulta(m)).not.toMatch(/where id in \(/);
  });

  it('espera a importação de clientes da loja e respeita a trava e o próximo horário', async () => {
    const m = montar();
    await m.job.reservar();
    expect(consulta(m)).toContain("sinc_status <> 'rodando'");
    expect(consulta(m)).toContain('pedidos_trava_ate is null or pedidos_trava_ate < now()');
    expect(consulta(m)).toContain('pedidos_proximo_em is null or pedidos_proximo_em <= now()');
  });

  it('escopo de sistema só para reservar, com o motivo da tabela da RLS', async () => {
    const m = montar();
    await m.job.reservar();
    expect((m.ctx.comEscopoSistema as jest.Mock).mock.calls[0][0]).toBe('cardapioweb.pedidos.fila');
  });

  it('uma volta roda um passo por loja reservada; falha de uma não derruba as outras', async () => {
    const m = montar(['conta-a', 'conta-b']);
    m.pedidos.passo.mockRejectedValueOnce(new Error('não devia subir'));
    await expect(m.job.volta()).resolves.toBeUndefined();
    expect(m.pedidos.passo).toHaveBeenCalledWith('conta-a');
    expect(m.pedidos.passo).toHaveBeenCalledWith('conta-b');
  });
});
