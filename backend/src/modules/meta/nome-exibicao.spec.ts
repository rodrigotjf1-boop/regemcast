/**
 * A decisão da Meta sobre o nome de exibição do número
 * (`phone_number_name_update`).
 *
 * O exemplo do aviso é o da documentação da Meta (conferido em 02/10/2026). O
 * que estes testes trancam:
 *
 *   1. só a decisão final (aprovado, recusado) avisa no celular;
 *   2. a saúde da conta é relida em toda decisão — é ela que diz se a restrição
 *      acabou;
 *   3. o nome aprovado é gravado no número certo: pelo telefone, DENTRO da WABA
 *      do aviso.
 *
 * O banco entra como dublê. Nada aqui toca Postgres nem rede.
 */
import { Logger } from '@nestjs/common';

jest.mock('../../config/env', () => ({ env: { push: { contaServico: '' } } }));

import { waConta, waNumero } from '../../db/schema';
import { avisoDoNome, lerDecisaoDoNome } from './nome-exibicao.regras';
import { WebhookService } from './webhook.service';

const CONTA = '11111111-1111-4111-8111-111111111111';
const WABA = '102290129340398';

/** O exemplo da documentação. */
const APROVADO = {
  display_phone_number: '15550783881',
  decision: 'APPROVED',
  requested_verified_name: 'Lucky Shrub',
  rejection_reason: null,
};

describe('lerDecisaoDoNome', () => {
  it('lê o exemplo oficial', () => {
    expect(lerDecisaoDoNome(APROVADO)).toEqual({
      decisao: 'aprovado',
      nome: 'Lucky Shrub',
      motivo: null,
      telefoneE164: '+15550783881',
    });
  });

  it.each([
    ['APPROVED', 'aprovado'],
    ['REJECTED', 'recusado'],
    ['PENDING', 'em_analise'],
    ['DEFERRED', 'adiado'],
    ['approved', 'aprovado'],
  ])('decisão %s → %s', (bruta, esperada) => {
    expect(lerDecisaoDoNome({ ...APROVADO, decision: bruta })?.decisao).toBe(esperada);
  });

  it('decisão que não conhecemos: nulo — nada é feito por adivinhação', () => {
    expect(lerDecisaoDoNome({ ...APROVADO, decision: 'ALGO_NOVO' })).toBeNull();
    expect(lerDecisaoDoNome({})).toBeNull();
  });

  it.each([
    ['NAME_EMPLOYEE_ISSUE', 'o nome traz o nome de uma pessoa ou de um funcionário'],
    ['NAME_ENDCLIENT_NOTRELATED', 'o nome cita outra empresa, sem relação com a sua'],
    ['NAME_FORMAT_UNACCEPTABLE', 'o formato do nome não é aceito'],
    ['NAME_INDIVIDUAL_ISSUE', 'o nome traz o nome de uma pessoa'],
    ['NAME_NOT_CONSISTENT', 'o nome não bate com a marca da empresa'],
  ])('motivo de recusa %s em português', (bruto, esperado) => {
    expect(lerDecisaoDoNome({ ...APROVADO, decision: 'REJECTED', rejection_reason: bruto })?.motivo).toBe(esperado);
  });

  it('motivo desconhecido (ou UNKNOWN) fica sem motivo, em vez de mostrar a palavra crua', () => {
    expect(lerDecisaoDoNome({ ...APROVADO, decision: 'REJECTED', rejection_reason: 'UNKNOWN' })?.motivo).toBeNull();
    expect(lerDecisaoDoNome({ ...APROVADO, decision: 'REJECTED', rejection_reason: 'NAME_NOVO' })?.motivo).toBeNull();
  });

  it('o telefone vira E.164; o que não parece telefone fica nulo', () => {
    expect(lerDecisaoDoNome({ ...APROVADO, display_phone_number: '+55 21 99999-8888' })?.telefoneE164).toBe('+5521999998888');
    expect(lerDecisaoDoNome({ ...APROVADO, display_phone_number: '123' })?.telefoneE164).toBeNull();
    expect(lerDecisaoDoNome({ ...APROVADO, display_phone_number: undefined })?.telefoneE164).toBeNull();
  });
});

describe('avisoDoNome', () => {
  it('aprovado: diz que a restrição deixa de valer', () => {
    expect(avisoDoNome(lerDecisaoDoNome(APROVADO)!)).toEqual({
      titulo: 'Nome de exibição aprovado: Lucky Shrub',
      corpo: 'A Meta aprovou o nome de exibição do número. A restrição por nome não aprovado deixa de valer.',
    });
  });

  it('recusado: diz o motivo e o que fazer', () => {
    const d = lerDecisaoDoNome({ ...APROVADO, decision: 'REJECTED', rejection_reason: 'NAME_NOT_CONSISTENT' })!;
    expect(avisoDoNome(d)).toEqual({
      titulo: 'Nome de exibição recusado: Lucky Shrub',
      corpo:
        'A Meta recusou o nome de exibição do número: o nome não bate com a marca da empresa. Ajuste o nome no Gerenciador do WhatsApp, na Meta, e envie de novo.',
    });
  });

  it('recusado sem motivo conhecido: a frase fecha sem os dois-pontos', () => {
    const d = lerDecisaoDoNome({ ...APROVADO, decision: 'REJECTED', rejection_reason: 'UNKNOWN' })!;
    expect(avisoDoNome(d)!.corpo).toBe(
      'A Meta recusou o nome de exibição do número. Ajuste o nome no Gerenciador do WhatsApp, na Meta, e envie de novo.',
    );
  });

  it('em análise e adiado não avisam', () => {
    expect(avisoDoNome(lerDecisaoDoNome({ ...APROVADO, decision: 'PENDING' })!)).toBeNull();
    expect(avisoDoNome(lerDecisaoDoNome({ ...APROVADO, decision: 'DEFERRED' })!)).toBeNull();
  });
});

describe('o aviso no webhook', () => {
  function montar(opcoes: { daWaba?: boolean } = {}) {
    const { daWaba = true } = opcoes;
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
        cadeia.then = (r: (v: unknown[]) => void) => r(tabela === waConta && daWaba ? [{ id: 'wa-1', contaId: CONTA }] : []);
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
    const saude = { atualizarDoSistema: jest.fn().mockResolvedValue({ leu: true, credencial: false }) };
    const service = new WebhookService(ctx as never, {} as never, avisos as never, {} as never, {} as never, saude as never);
    const receber = (value: Record<string, unknown>, entrada: string | undefined = WABA) =>
      (service as unknown as { aplicar(tipo: string, m: unknown): Promise<unknown> }).aplicar('phone_number_name_update', {
        field: 'phone_number_name_update',
        value,
        entrada,
      });
    return { receber, avisos, saude, gravados, escopos };
  }

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  it('aprovado: grava o nome no número, relê a saúde e avisa o dono, levando à tela do WhatsApp', async () => {
    const m = montar();
    await m.receber(APROVADO);

    expect(m.gravados).toEqual([{ tabela: waNumero, valores: { nomeExibicao: 'Lucky Shrub' } }]);
    expect(m.saude.atualizarDoSistema).toHaveBeenCalledWith({ wabaId: WABA });
    expect(m.avisos.avisar).toHaveBeenCalledWith(CONTA, 'campanhas', {
      titulo: 'Nome de exibição aprovado: Lucky Shrub',
      corpo: expect.stringContaining('deixa de valer'),
      dados: { tela: 'whatsapp' },
    });
    expect(m.escopos).toEqual(['meta.webhook.nome']);
  });

  it('recusado: NÃO grava o nome recusado, relê a saúde e avisa com o motivo', async () => {
    const m = montar();
    await m.receber({ ...APROVADO, decision: 'REJECTED', rejection_reason: 'NAME_FORMAT_UNACCEPTABLE' });

    expect(m.gravados).toEqual([]);
    expect(m.saude.atualizarDoSistema).toHaveBeenCalledTimes(1);
    expect(m.avisos.avisar).toHaveBeenCalledWith(
      CONTA,
      'campanhas',
      expect.objectContaining({ titulo: 'Nome de exibição recusado: Lucky Shrub', corpo: expect.stringContaining('o formato do nome não é aceito') }),
    );
  });

  it.each(['PENDING', 'DEFERRED'])('%s: relê a saúde, sem aviso e sem gravar', async (decision) => {
    const m = montar();
    await m.receber({ ...APROVADO, decision });

    expect(m.saude.atualizarDoSistema).toHaveBeenCalledTimes(1);
    expect(m.avisos.avisar).not.toHaveBeenCalled();
    expect(m.gravados).toEqual([]);
  });

  it('WABA que não é nossa: nada acontece', async () => {
    const m = montar({ daWaba: false });
    await m.receber(APROVADO);

    expect(m.saude.atualizarDoSistema).not.toHaveBeenCalled();
    expect(m.avisos.avisar).not.toHaveBeenCalled();
    expect(m.gravados).toEqual([]);
  });

  it('sem a WABA do aviso, ou com decisão que não conhecemos: nem consulta o banco', async () => {
    const m = montar();
    await m.receber(APROVADO, '');
    await m.receber({ ...APROVADO, decision: 'ALGO_NOVO' });
    expect(m.escopos).toEqual([]);
  });

  it('aprovado sem telefone reconhecível: avisa, mas não grava o nome em número nenhum', async () => {
    const m = montar();
    await m.receber({ ...APROVADO, display_phone_number: '' });
    expect(m.gravados).toEqual([]);
    expect(m.avisos.avisar).toHaveBeenCalledTimes(1);
  });
});
