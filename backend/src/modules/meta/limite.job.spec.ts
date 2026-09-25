/**
 * O job do limite de envio com autorização vencida (190): espera 6 horas em
 * vez de tentar a cada 30 minutos — insistir não conserta o token, só enche o
 * log e esconde o aviso útil.
 */
jest.mock('../../config/env', () => ({ env: { meta: { tokenChave: 'k' } } }));
jest.mock('./cripto', () => ({ decifrarToken: () => 'token' }));

import { traduzirErroMeta } from './erros-meta';
import { ErroGraph } from './graph.service';
import { LimiteJob } from './limite.job';

function montar(falha: unknown) {
  const numero = { id: 'n1', phone_number_id: '1234561945', token_cifrado: 'x' };
  const db = {
    execute: jest.fn().mockResolvedValue({ rows: [numero] }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
  const ctx = { comEscopoSistema: (_m: string, fn: (d: typeof db) => unknown) => fn(db) };
  const graph = { limiteDoNumero: jest.fn().mockRejectedValue(falha) };
  const job = new LimiteJob(ctx as never, graph as never);
  return { job, graph };
}

describe('LimiteJob', () => {
  it('autorização vencida: tenta uma vez e espera 6 h, em vez de toda volta', async () => {
    const m = montar(new ErroGraph({ status: 401, codigo: 190, traduzido: traduzirErroMeta(190) }));
    await m.job.atualizarVencidos();
    await m.job.atualizarVencidos();
    await m.job.atualizarVencidos();
    expect(m.graph.limiteDoNumero).toHaveBeenCalledTimes(1);
  });

  it('falha passageira (rede): tenta de novo na volta seguinte', async () => {
    const m = montar(new Error('rede'));
    await m.job.atualizarVencidos();
    await m.job.atualizarVencidos();
    expect(m.graph.limiteDoNumero).toHaveBeenCalledTimes(2);
  });
});
