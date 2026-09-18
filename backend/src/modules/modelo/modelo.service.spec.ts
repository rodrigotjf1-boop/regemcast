/**
 * Editar e excluir modelo que JÁ está na Meta.
 *
 * O que estes testes protegem é o que a Meta cobra caro:
 *
 * - modelo aprovado aceita UMA edição por dia — descobrir isso pelo erro dela,
 *   depois de reescrever o modelo, é o atrito que o produto existe para evitar;
 * - a exclusão tem de acontecer LÁ antes de sumir daqui, senão fica um modelo
 *   órfão na Meta ocupando o nome por 30 dias, sem tela nenhuma onde apareça;
 * - a categoria nunca vai junto na edição: mandá-la faz a Meta recusar tudo.
 */
import { BadRequestException } from '@nestjs/common';

// O serviço lê env na importação; o teste não precisa de banco nenhum.
jest.mock('../../config/env', () => ({ env: { meta: { graphVersao: 'v21.0' } } }));

import { ModeloService } from './modelo.service';

const MODELO_BASE = {
  id: 'm1',
  contaId: 'c1',
  nome: 'promo_sexta',
  idioma: 'pt_BR',
  tipo: 'simples',
  categoria: 'MARKETING',
  categoriaMeta: null,
  status: 'aprovado',
  motivo: null,
  corpo: 'Olá! Temos novidades para você nesta sexta.',
  corpoExemplos: [],
  cabecalhoFormato: null,
  cabecalhoTexto: null,
  cabecalhoExemplo: null,
  cabecalhoMidia: null,
  rodape: null,
  botoes: [],
  cartoes: [],
  ltoAtivo: false,
  ltoTexto: null,
  metaTemplateId: '999' as string | null,
  editadoMetaEm: null as Date | null,
};

const DTO = {
  nome: MODELO_BASE.nome,
  idioma: 'pt_BR',
  categoria: 'MARKETING' as const,
  corpo: 'Olá! Temos novidades para você nesta sexta, com frete grátis.',
};

function montar(parcial: Partial<typeof MODELO_BASE> = {}) {
  const linha = { ...MODELO_BASE, ...parcial };
  const gravado: Record<string, unknown>[] = [];

  const cadeia = () => {
    const c: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'limit', 'returning']) c[m] = () => c;
    c.set = (v: Record<string, unknown>) => {
      gravado.push(v);
      return c;
    };
    c.then = (r: (v: unknown[]) => void) => r([linha]);
    return c;
  };

  const db = {
    select: () => cadeia(),
    update: () => cadeia(),
    delete: () => cadeia(),
  };

  const ctx = { comConta: <T>(_c: string, fn: (d: typeof db) => Promise<T>) => fn(db), db };
  const meta = { tokenDaConta: jest.fn().mockResolvedValue({ token: 'tok', wabaId: 'waba1' }) };
  const graph = {
    editarModelo: jest.fn().mockResolvedValue({ success: true }),
    lerModelo: jest.fn().mockResolvedValue({ id: '999', status: 'PENDING' }),
    excluirModelo: jest.fn().mockResolvedValue(undefined),
  };
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const midia = { handleParaModelo: jest.fn() };

  const service = new ModeloService(
    ctx as never,
    meta as never,
    graph as never,
    auditoria as never,
    midia as never,
  );

  return { service, graph, meta, auditoria, gravado, linha };
}

describe('editar modelo que está na Meta', () => {
  it('manda só os componentes — categoria nunca vai junto', async () => {
    const m = montar();
    await m.service.editarNaMeta('c1', 'u1', 'm1', DTO);

    expect(m.graph.editarModelo).toHaveBeenCalledTimes(1);
    const [templateId, token, componentes] = m.graph.editarModelo.mock.calls[0];
    expect(templateId).toBe('999');
    expect(token).toBe('tok');
    expect(Array.isArray(componentes)).toBe(true);
    expect(JSON.stringify(componentes)).not.toContain('MARKETING');
  });

  it('recusa a segunda edição no mesmo dia, dizendo quando dá para tentar', async () => {
    const m = montar({ editadoMetaEm: new Date(Date.now() - 2 * 3_600_000) });

    await expect(m.service.editarNaMeta('c1', 'u1', 'm1', DTO)).rejects.toBeInstanceOf(BadRequestException);
    expect(m.graph.editarModelo).not.toHaveBeenCalled();
  });

  it('deixa editar depois de passadas as 24 horas', async () => {
    const m = montar({ editadoMetaEm: new Date(Date.now() - 25 * 3_600_000) });
    await m.service.editarNaMeta('c1', 'u1', 'm1', DTO);
    expect(m.graph.editarModelo).toHaveBeenCalled();
  });

  it('grava o status que a Meta diz depois da edição, e não um palpite', async () => {
    const m = montar();
    m.graph.lerModelo.mockResolvedValue({ id: '999', status: 'APPROVED', category: 'MARKETING' });

    const r = await m.service.editarNaMeta('c1', 'u1', 'm1', DTO);

    expect(r.status).toBe('aprovado');
    expect(m.gravado.some((g) => g.status === 'aprovado' && g.editadoMetaEm instanceof Date)).toBe(true);
  });

  it('se a releitura falhar, fica em análise — o conservador, nunca "aprovado" por engano', async () => {
    const m = montar();
    m.graph.lerModelo.mockRejectedValue(new Error('rede'));

    const r = await m.service.editarNaMeta('c1', 'u1', 'm1', DTO);
    expect(r.status).toBe('enviado');
  });

  it('modelo em análise não é editável', async () => {
    const m = montar({ status: 'enviado' });
    await expect(m.service.editarNaMeta('c1', 'u1', 'm1', DTO)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('excluir modelo', () => {
  it('apaga na Meta com o id do idioma antes de apagar aqui', async () => {
    const m = montar();
    const r = await m.service.excluir('c1', 'u1', 'm1');

    expect(m.graph.excluirModelo).toHaveBeenCalledWith('waba1', 'tok', 'promo_sexta', '999');
    expect(r).toEqual({ ok: true, naMeta: true });
  });

  it('se a Meta recusar, nada some daqui', async () => {
    const m = montar();
    m.graph.excluirModelo.mockRejectedValue(new Error('meta fora'));

    await expect(m.service.excluir('c1', 'u1', 'm1')).rejects.toBeInstanceOf(BadRequestException);
    expect(m.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('rascunho nosso não chama a Meta', async () => {
    const m = montar({ status: 'rascunho', metaTemplateId: null });
    const r = await m.service.excluir('c1', 'u1', 'm1');

    expect(m.graph.excluirModelo).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, naMeta: false });
  });
});
