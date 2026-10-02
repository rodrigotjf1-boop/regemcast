/**
 * Os avisos da Meta sobre um modelo já aprovado: a qualidade caiu, a categoria
 * vai mudar ou mudou.
 *
 * O que estes testes trancam:
 *
 *   1. o dono é avisado mesmo quando o modelo nasceu fora do Regemcast (a conta
 *      sai da WABA do aviso);
 *   2. só a queda de qualidade avisa — melhora e "sem informação" ficam quietas;
 *   3. a mudança de categoria FEITA grava a categoria nova no nosso registro;
 *      a marcada, não.
 *
 * O banco entra como dublê. Nada aqui toca Postgres nem rede.
 */
import { Logger } from '@nestjs/common';

jest.mock('../../config/env', () => ({ env: { push: { contaServico: '' } } }));

import { conta, modelo, waConta } from '../../db/schema';
import { WebhookService } from './webhook.service';

const CONTA = '11111111-1111-4111-8111-111111111111';
const WABA = '1578000000000001';

function montar(opcoes: { local?: boolean; daWaba?: boolean; fuso?: string } = {}) {
  const { local = true, daWaba = true, fuso = 'America/Sao_Paulo' } = opcoes;
  const gravados: Array<{ tabela: unknown; valores: Record<string, unknown> }> = [];
  const escopos: string[] = [];

  const db = {
    select: () => {
      const cadeia: Record<string, unknown> = {};
      let tabela: unknown;
      cadeia.from = (t: unknown) => {
        tabela = t;
        return cadeia;
      };
      for (const m of ['where', 'limit']) cadeia[m] = () => cadeia;
      cadeia.then = (r: (v: unknown[]) => void) => {
        if (tabela === modelo) return r(local ? [{ contaId: CONTA, id: 'modelo-1', nome: 'pedido_saiu' }] : []);
        if (tabela === waConta) return r(daWaba ? [{ contaId: CONTA }] : []);
        if (tabela === conta) return r([{ fuso }]);
        return r([]);
      };
      return cadeia;
    },
    update: (tabela: unknown) => {
      const cadeia: Record<string, unknown> = {};
      cadeia.set = (valores: Record<string, unknown>) => {
        gravados.push({ tabela, valores });
        return cadeia;
      };
      cadeia.where = () => cadeia;
      cadeia.then = (r: (v: unknown[]) => void) => r([]);
      return cadeia;
    },
  };
  const ctx = {
    comEscopoSistema: <T>(motivo: string, fn: (d: typeof db) => Promise<T>) => {
      escopos.push(motivo);
      return fn(db);
    },
  };
  const avisos = { avisar: jest.fn().mockResolvedValue(undefined) };
  const service = new WebhookService(ctx as never, {} as never, avisos as never, {} as never, {} as never, {} as never);
  const aplicar = (field: string, value: Record<string, unknown>, entrada: string | undefined = WABA) =>
    (service as unknown as { aplicar(tipo: string, m: unknown): Promise<unknown> }).aplicar(field, { field, value, entrada });
  return { aplicar, avisos, gravados, escopos };
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe('a qualidade do modelo mudou (message_template_quality_update)', () => {
  const caiu = {
    previous_quality_score: 'GREEN',
    new_quality_score: 'RED',
    message_template_id: 806312974732579,
    message_template_name: 'pedido_saiu',
    message_template_language: 'pt_BR',
  };

  it('caiu para vermelha: avisa no celular, na categoria "modelos", levando à tela dos modelos', async () => {
    const m = montar();
    await m.aplicar('message_template_quality_update', caiu);

    expect(m.avisos.avisar).toHaveBeenCalledTimes(1);
    expect(m.avisos.avisar).toHaveBeenCalledWith(CONTA, 'modelos', {
      titulo: 'Qualidade ruim: pedido_saiu',
      corpo: expect.stringContaining('pausar ou desativar'),
      dados: { tela: 'modelos', modeloId: 'modelo-1' },
    });
    // A tela lê a qualidade na lista da Meta: aqui não se grava nada.
    expect(m.gravados).toEqual([]);
  });

  it('modelo criado fora do Regemcast: a conta sai da WABA do aviso, e o dono é avisado', async () => {
    const m = montar({ local: false });
    await m.aplicar('message_template_quality_update', caiu);

    expect(m.avisos.avisar).toHaveBeenCalledWith(CONTA, 'modelos', expect.objectContaining({ dados: { tela: 'modelos' } }));
  });

  it.each([
    ['melhorou', { previous_quality_score: 'RED', new_quality_score: 'GREEN' }],
    ['ficou sem informação', { previous_quality_score: 'GREEN', new_quality_score: 'UNKNOWN' }],
    ['modelo novo já verde', { previous_quality_score: 'UNKNOWN', new_quality_score: 'GREEN' }],
  ])('%s: sem aviso, e sem consulta ao banco', async (_caso, mudanca) => {
    const m = montar();
    await m.aplicar('message_template_quality_update', { ...caiu, ...mudanca });
    expect(m.avisos.avisar).not.toHaveBeenCalled();
    expect(m.escopos).toEqual([]);
  });

  it('WABA que não é nossa, de modelo que não é nosso: ignora sem erro', async () => {
    const m = montar({ local: false, daWaba: false });
    await expect(m.aplicar('message_template_quality_update', caiu)).resolves.toBeUndefined();
    expect(m.avisos.avisar).not.toHaveBeenCalled();
  });
});

describe('a categoria do modelo (template_category_update)', () => {
  const vaiMudar = {
    message_template_id: 278077987957091,
    message_template_name: 'pedido_saiu',
    message_template_language: 'pt_BR',
    new_category: 'UTILITY',
    correct_category: 'MARKETING',
    category_update_timestamp: 1746169200,
  };
  const mudou = {
    message_template_id: 278077987957091,
    message_template_name: 'pedido_saiu',
    message_template_language: 'pt_BR',
    previous_category: 'UTILITY',
    new_category: 'MARKETING',
  };

  it('aviso das 24 horas: avisa com a hora no fuso da conta, e NÃO mexe no registro', async () => {
    const m = montar({ fuso: 'America/Manaus' });
    await m.aplicar('template_category_update', vaiMudar);

    expect(m.avisos.avisar).toHaveBeenCalledWith(CONTA, 'modelos', {
      titulo: 'A Meta vai mudar a categoria: pedido_saiu',
      corpo: 'O modelo passa de utilidade para marketing em 02/05 às 03:00. O preço por mensagem e as regras de envio mudam junto.',
      dados: { tela: 'modelos', modeloId: 'modelo-1' },
    });
    expect(m.gravados).toEqual([]);
  });

  it('mudança feita: grava a categoria nova no nosso registro e avisa', async () => {
    const m = montar();
    await m.aplicar('template_category_update', mudou);

    expect(m.gravados).toEqual([{ tabela: modelo, valores: { categoriaMeta: 'MARKETING' } }]);
    expect(m.avisos.avisar).toHaveBeenCalledWith(CONTA, 'modelos', {
      titulo: 'A Meta mudou a categoria: pedido_saiu',
      corpo: 'O modelo passou de utilidade para marketing. O preço por mensagem e as regras de envio mudam junto.',
      dados: { tela: 'modelos', modeloId: 'modelo-1' },
    });
  });

  it('mudança feita em modelo criado fora do Regemcast: avisa, sem ter o que gravar', async () => {
    const m = montar({ local: false });
    await m.aplicar('template_category_update', mudou);

    expect(m.gravados).toEqual([]);
    expect(m.avisos.avisar).toHaveBeenCalledWith(CONTA, 'modelos', expect.objectContaining({ dados: { tela: 'modelos' } }));
  });

  it('tudo pela chave mestra dos modelos (o aviso chega sem conta)', async () => {
    const m = montar();
    await m.aplicar('template_category_update', mudou);
    expect(new Set(m.escopos)).toEqual(new Set(['meta.webhook.modelo']));
  });

  it('aviso que não traz mudança de verdade: nada acontece', async () => {
    const m = montar();
    await m.aplicar('template_category_update', { ...mudou, previous_category: 'MARKETING' });
    expect(m.avisos.avisar).not.toHaveBeenCalled();
    expect(m.gravados).toEqual([]);
  });
});

/**
 * A chave de idempotência dos avisos sem id de mensagem.
 *
 * Só com o conteúdo, o segundo aviso IGUAL — o modelo que cai de qualidade de
 * novo, semanas depois — era descartado como reenvio, para sempre.
 */
describe('o mesmo aviso em outro momento é outro evento', () => {
  function registrador() {
    const chaves: string[] = [];
    const payloads: Array<Record<string, unknown>> = [];
    const db = {
      insert: () => ({
        values: (v: { chaveIdempotencia: string; payload: Record<string, unknown> }) => {
          chaves.push(v.chaveIdempotencia);
          payloads.push(v.payload);
          return { onConflictDoNothing: async () => undefined };
        },
      }),
    };
    const ctx = { comEscopoSistema: <T>(_m: string, fn: (d: typeof db) => Promise<T>) => fn(db) };
    const service = new WebhookService(ctx as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    return { service, chaves, payloads };
  }

  const aviso = (time: number | undefined, value: Record<string, unknown>, field = 'message_template_quality_update') => ({
    object: 'whatsapp_business_account',
    entry: [{ id: WABA, ...(time === undefined ? {} : { time }), changes: [{ field, value }] }],
  });
  const queda = { previous_quality_score: 'GREEN', new_quality_score: 'YELLOW', message_template_id: 806312974732579, message_template_name: 'pedido_saiu' };

  it('reenvio da Meta (mesmo conteúdo, mesmo momento): a mesma chave — é descartado', async () => {
    const r = registrador();
    await r.service.registrar(aviso(1746082800, queda));
    await r.service.registrar(aviso(1746082800, queda));
    expect(r.chaves[0]).toBe(r.chaves[1]);
  });

  it('a segunda queda igual, semanas depois: chave diferente — é tratada', async () => {
    const r = registrador();
    await r.service.registrar(aviso(1746082800, queda));
    await r.service.registrar(aviso(1748761200, queda));
    expect(r.chaves[0]).not.toBe(r.chaves[1]);
  });

  it.each(['message_template_status_update', 'account_update', 'phone_number_quality_update', 'template_category_update'])(
    'vale para todo aviso sem id de mensagem (%s)',
    async (field) => {
      const r = registrador();
      await r.service.registrar(aviso(1746082800, { event: 'PAUSED', message_template_id: 1 }, field));
      await r.service.registrar(aviso(1748761200, { event: 'PAUSED', message_template_id: 1 }, field));
      expect(r.chaves[0]).not.toBe(r.chaves[1]);
    },
  );

  it('status de mensagem continua pela mensagem e pelo estado, não pelo momento', async () => {
    const r = registrador();
    const status = { metadata: { phone_number_id: 'PN1' }, statuses: [{ id: 'wamid.X', status: 'delivered' }] };
    await r.service.registrar(aviso(1746082800, status, 'messages'));
    await r.service.registrar(aviso(1746082999, status, 'messages'));
    expect(r.chaves).toEqual(['messages:wamid.X:delivered', 'messages:wamid.X:delivered']);
  });

  it('o momento e a WABA ficam guardados no evento; aviso sem momento segue valendo', async () => {
    const r = registrador();
    await r.service.registrar(aviso(1746082800, queda));
    await r.service.registrar(aviso(undefined, queda));
    expect(r.payloads[0]).toMatchObject({ entrada: WABA, quando: 1746082800 });
    expect(r.payloads[1]).toMatchObject({ entrada: WABA });
    expect(r.payloads[1]).not.toHaveProperty('quando');
  });
});
