/**
 * O job do fim do grátis e quem usa o Regem. O teste com o banco de verdade
 * mora fora da suíte; aqui fica a FORMA: as duas consultas deixam de fora a
 * conta ligada ao Regem, e o aviso de quem desligou a integração sai com a
 * frase própria.
 */
jest.mock('../../config/env', () => ({
  env: { rede: { appUrl: 'https://cast.exemplo/' }, mercadoPago: { carenciaDias: 5 } },
}));

import type { ContextoDb } from '../../db/contexto';
import type { EmailParaEnviar, EmailService } from '../email/email.service';
import { emailFimDoGratis } from '../email/modelos-email';
import { CobrancaJob } from './cobranca.job';

function montar(avisos: Record<string, unknown>[] = []) {
  const consultas: string[] = [];
  const db = {
    execute: jest.fn(async (q: unknown) => {
      const texto = JSON.stringify(q);
      consultas.push(texto);
      if (texto.includes('array_append')) return { rows: consultas.filter((c) => c.includes('array_append')).length === 1 ? avisos : [] };
      if (texto.includes('from usuario')) return { rows: avisos.map((a) => ({ conta_id: a.conta_id, email: 'dona@loja.com' })) };
      return { rows: [] };
    }),
  };
  const ctx = { comEscopoSistema: jest.fn((_m: string, fn: (d: typeof db) => unknown) => fn(db)) } as unknown as ContextoDb;
  const enviados: EmailParaEnviar[] = [];
  const email = { enviar: jest.fn(async (m: EmailParaEnviar) => void enviados.push(m)) } as unknown as EmailService;
  return { job: new CobrancaJob(ctx, email), consultas, enviados };
}

describe('CobrancaJob × gratuidade do Regem', () => {
  it('os avisos de fim do grátis não saem para a conta ligada ao Regem', async () => {
    const m = montar();
    await m.job.avisarFimDoGratis();
    const avisos = m.consultas.filter((c) => c.includes('array_append'));
    expect(avisos).toHaveLength(3);
    for (const c of avisos) {
      expect(c).toContain('and not ');
      expect(c).toContain('from integracao_regem ir');
      expect(c).toContain('ir.credencial_cifrada is not null');
    }
  });

  it('a conta ligada ao Regem não vira inadimplente', async () => {
    const m = montar();
    await m.job.marcarInadimplentes();
    expect(m.consultas[0]).toContain("set status = 'inadimplente'");
    expect(m.consultas[0]).toContain('from integracao_regem ir');
  });

  it('quem desligou a integração recebe o aviso com a frase do Regem', async () => {
    const m = montar([{ conta_id: 'c1', gratis_ate: new Date().toISOString(), conta_nome: 'Loja', regem_desligado: true }]);
    await m.job.avisarFimDoGratis();
    expect(m.enviados).toHaveLength(1);
    expect(m.enviados[0]!.assunto).toBe('A gratuidade do Regem terminou');
  });
});

describe('emailFimDoGratis', () => {
  const ontem = new Date(Date.now() - 86_400_000);
  const corte = new Date(Date.now() + 4 * 86_400_000);

  it('o aviso comum conta que quem usa o Regem não paga', () => {
    const e = emailFimDoGratis('a@b.com', 'Loja', ontem, corte, 'https://x/plano');
    expect(e.assunto).toBe('Seu mês grátis terminou');
    expect(e.texto).toContain('Quem usa o Regem não paga o RegemCast');
  });

  it('desligou do Regem: diz o motivo e não repete o convite', () => {
    const e = emailFimDoGratis('a@b.com', 'Loja', ontem, corte, 'https://x/plano', { regemDesligado: true });
    expect(e.assunto).toBe('A gratuidade do Regem terminou');
    expect(e.texto).toContain('A integração de Loja com o Regem foi desligada');
    expect(e.texto).not.toContain('Quem usa o Regem não paga');
    expect(e.texto).toContain('os disparos param em');
  });
});
