/**
 * Testes do disparo.
 *
 * O que está sob teste aqui é a regra que a auditoria do Regem mostrou custar
 * caro: **"a Meta aceitou" não é "chegou"**. Lá uma campanha marca 100% enviada
 * com 100% das mensagens em `failed`, porque o envio guarda o 200 do POST e
 * nunca reconcilia. Os testes abaixo trancam o contrário — e trancam também que
 * uma falha no meio da lista não derruba o resto.
 *
 * O banco entra como dublê. Nada aqui toca Postgres nem rede.
 */
import { BadRequestException, Logger } from '@nestjs/common';

jest.mock('../../config/env', () => ({ env: {} }));

import { CampanhaService } from './campanha.service';
import { ErroGraph } from '../meta/graph.service';
import { traduzirErroMeta } from '../meta/erros-meta';

const CONTA = '11111111-1111-4111-8111-111111111111';
const USUARIO = '22222222-2222-4222-8222-222222222222';
const CAMPANHA = '33333333-3333-4333-8333-333333333333';

interface Escrita {
  tipo: 'update' | 'insert';
  valores: Record<string, unknown>;
}

type Encadeavel = Record<string, unknown>;

function consulta(linhas: unknown[], diario: Escrita[], tipo?: 'update' | 'insert'): Encadeavel {
  const alvo: Encadeavel = {};
  for (const metodo of ['from', 'where', 'orderBy', 'groupBy', 'limit', 'returning', 'innerJoin']) {
    alvo[metodo] = () => alvo;
  }
  alvo.set = (v: Record<string, unknown>) => {
    if (tipo) diario.push({ tipo, valores: v });
    return alvo;
  };
  alvo.values = (v: Record<string, unknown>) => {
    if (tipo) diario.push({ tipo, valores: v });
    return alvo;
  };
  alvo.then = (resolver: (v: unknown[]) => void) => resolver(linhas);
  return alvo;
}

const CAMPANHA_RASCUNHO = {
  id: CAMPANHA,
  contaId: CONTA,
  nome: 'Promoção de sexta',
  modeloId: '1',
  modeloNome: 'promo',
  modeloIdioma: 'pt_BR',
  modeloCategoria: 'MARKETING',
  status: 'rascunho',
  criadaPor: USUARIO,
  iniciadaEm: null,
  concluidaEm: null,
  criadoEm: new Date('2026-09-15T12:00:00Z'),
  atualizadoEm: new Date('2026-09-15T12:00:00Z'),
};

function montar() {
  const diario: Escrita[] = [];

  const db = {
    select: jest.fn(() => consulta([], diario)),
    update: jest.fn(() => consulta([], diario, 'update')),
    insert: jest.fn(() => consulta([], diario, 'insert')),
    delete: jest.fn(() => consulta([], diario)),
    execute: jest.fn().mockResolvedValue({ rows: [] }),
  };

  const meta = {
    tokenDaConta: jest.fn().mockResolvedValue({ token: 'EAA-token', wabaId: 'WABA1' }),
  };

  const graph = {
    enviarModelo: jest.fn().mockResolvedValue('wamid.ABC'),
  };

  const registrar = jest.fn().mockResolvedValue(undefined);

  const ctx = {
    db,
    contaId: CONTA,
    contaObrigatoria: () => CONTA,
    // O worker roda fora de request e abre os próprios escopos.
    comEscopoSistema: <T>(_motivo: string, fn: (d: typeof db) => Promise<T>) => fn(db),
    comConta: <T>(_conta: string, fn: (d: typeof db) => Promise<T>) => fn(db),
  };

  const service = new CampanhaService(
    ctx as unknown as ConstructorParameters<typeof CampanhaService>[0],
    meta as unknown as ConstructorParameters<typeof CampanhaService>[1],
    graph as unknown as ConstructorParameters<typeof CampanhaService>[2],
    { registrar, registrarForaDeContexto: jest.fn() } as unknown as ConstructorParameters<
      typeof CampanhaService
    >[3],
  );

  return { service, db, meta, graph, registrar, diario, consulta: (l: unknown[]) => consulta(l, diario) };
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterAll(() => jest.restoreAllMocks());

describe('criar', () => {
  it('recusa sem WhatsApp conectado, antes de gravar qualquer coisa', async () => {
    const m = montar();
    m.meta.tokenDaConta.mockResolvedValue(null);

    await expect(
      m.service.criar(CONTA, USUARIO, {
        nome: 'Teste',
        modeloNome: 'promo',
        modeloIdioma: 'pt_BR',
        destinatarios: [{ telefone: '5521999998888' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Deixar criar para falhar no disparo só adianta a frustração.
    expect(m.db.insert).not.toHaveBeenCalled();
  });

  it('recusa telefone repetido dizendo QUAL é', async () => {
    const m = montar();

    const erro = await m.service
      .criar(CONTA, USUARIO, {
        nome: 'Teste',
        modeloNome: 'promo',
        modeloIdioma: 'pt_BR',
        destinatarios: [{ telefone: '5521999998888' }, { telefone: '5521999998888' }],
      })
      .catch((e: unknown) => e);

    // O índice único do banco também barra, mas a mensagem dele não diz qual
    // número está repetido — e é isso que a pessoa precisa para corrigir.
    expect(erro).toBeInstanceOf(BadRequestException);
    expect((erro as BadRequestException).message).toContain('5521999998888');
  });

  it('nasce em rascunho: criar não envia nada', async () => {
    const m = montar();
    m.db.insert.mockReturnValueOnce(consulta([{ id: CAMPANHA }], m.diario, 'insert'));

    await m.service.criar(CONTA, USUARIO, {
      nome: 'Promoção de sexta',
      modeloNome: 'promo',
      modeloIdioma: 'pt_BR',
      destinatarios: [{ telefone: '5521999998888', variaveis: ['Ana'] }],
    });

    expect(m.graph.enviarModelo).not.toHaveBeenCalled();
    expect(m.diario[0]?.valores.status).toBe('rascunho');
  });
});

describe('disparar', () => {
  it('AGENDA a campanha e não envia nada dentro do request', async () => {
    // Enviar dentro do request segurava uma conexão de banco durante todas as
    // chamadas à Meta, e tornava impossível respeitar a janela de horário.
    const m = montar();
    m.db.select
      .mockReturnValueOnce(m.consulta([CAMPANHA_RASCUNHO])) // buscar
      .mockReturnValueOnce(m.consulta([{ phoneNumberId: 'PN1', status: 'registrado' }])) // número
      .mockReturnValueOnce(m.consulta([{ total: 1 }])) // total para a auditoria
      .mockReturnValueOnce(m.consulta([{ ...CAMPANHA_RASCUNHO, status: 'agendada' }])) // detalhe
      .mockReturnValueOnce(m.consulta([])); // contagem do detalhe

    await m.service.disparar(CONTA, USUARIO, CAMPANHA);

    expect(m.graph.enviarModelo).not.toHaveBeenCalled();
    expect(m.diario.find((e) => e.valores.status === 'agendada')).toBeDefined();
  });

  it('recusa disparar de novo uma campanha já disparada', async () => {
    const m = montar();
    m.db.select.mockReturnValueOnce(m.consulta([{ ...CAMPANHA_RASCUNHO, status: 'concluida' }]));

    await expect(m.service.disparar(CONTA, USUARIO, CAMPANHA)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    // Reenviar para quem já recebeu queima o destinatário e cobra de novo.
    expect(m.graph.enviarModelo).not.toHaveBeenCalled();
  });

  it('recusa quando não há número pronto — agora, e não horas depois', async () => {
    const m = montar();
    m.db.select
      .mockReturnValueOnce(m.consulta([CAMPANHA_RASCUNHO]))
      .mockReturnValueOnce(m.consulta([])); // nenhum número registrado

    // Sem esta conferência, a campanha ficaria "agendada" para sempre e o
    // cliente só descobriria o problema ao ver que nada saiu.
    await expect(m.service.disparar(CONTA, USUARIO, CAMPANHA)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(m.graph.enviarModelo).not.toHaveBeenCalled();
  });
});

describe('rodada do worker', () => {
  /** A campanha como a rodada lê: com janela, ritmo e o fuso da conta. */
  const ATIVA = {
    id: CAMPANHA,
    contaId: CONTA,
    status: 'agendada',
    modeloNome: 'promo',
    modeloIdioma: 'pt_BR',
    janelaDias: [],
    janelaInicio: null,
    janelaFim: null,
    pausaSegundos: 0,
    maxPorDia: null,
    maxPorSemana: null,
    maxPorMes: null,
    fuso: 'America/Sao_Paulo',
  };

  /** Uma rodada completa: ler, contar, reivindicar, conectar, enviar, concluir. */
  function prepararRodada(
    m: ReturnType<typeof montar>,
    reivindicados: unknown[],
    campanha: Record<string, unknown> = ATIVA,
  ) {
    m.db.select
      .mockReturnValueOnce(m.consulta([campanha])) // ler a campanha
      .mockReturnValueOnce(m.consulta([{ phoneNumberId: 'PN1' }])) // número, na conexão
      .mockReturnValueOnce(m.consulta([{ restam: 0 }])); // concluir
    m.db.execute
      .mockResolvedValueOnce({ rows: [{ dia: 0, semana: 0, mes: 0, ultimo: null }] }) // contagem
      .mockResolvedValueOnce({ rows: reivindicados }); // reivindicação
  }

  it('grava o wamid e marca "enviada" — nunca "entregue"', async () => {
    const m = montar();
    prepararRodada(m, [{ id: 'd1', telefone_e164: '5521999998888', variaveis: ['Ana'] }]);

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(m.graph.enviarModelo).toHaveBeenCalledWith(
      'PN1',
      { para: '5521999998888', modelo: 'promo', idioma: 'pt_BR', variaveis: ['Ana'] },
      'EAA-token',
    );

    /*
     * O ponto do módulo inteiro: a Meta aceitou e devolveu identificador. Se
     * chegou ao aparelho, quem diz é o webhook. Chamar isto de entregue é a
     * mentira que faz a campanha do Regem marcar 100% de sucesso.
     */
    const gravado = m.diario.find((e) => e.valores.waMessageId);
    expect(gravado?.valores.status).toBe('enviada');
    expect(gravado?.valores.waMessageId).toBe('wamid.ABC');
  });

  it('falha de um destinatário não interrompe os outros', async () => {
    const m = montar();
    prepararRodada(m, [
      { id: 'd1', telefone_e164: '5521999998888', variaveis: [] },
      { id: 'd2', telefone_e164: '5521777776666', variaveis: [] },
      { id: 'd3', telefone_e164: '5521555554444', variaveis: [] },
    ]);

    m.graph.enviarModelo
      .mockResolvedValueOnce('wamid.1')
      .mockRejectedValueOnce(
        new ErroGraph({ status: 400, codigo: 131026, traduzido: traduzirErroMeta(131026) }),
      )
      .mockResolvedValueOnce('wamid.3');

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    // Parar no primeiro erro é o que faz uma campanha inteira morrer por causa
    // de um número inválido no meio da lista.
    expect(m.graph.enviarModelo).toHaveBeenCalledTimes(3);

    const falha = m.diario.find((e) => e.valores.status === 'falhou');
    // O motivo REAL, não "deu erro": sem ele o suporte pede print em vez de
    // responder.
    expect(falha?.valores.erroCodigo).toBe(131026);
    expect(String(falha?.valores.erroDetalhe ?? '')).not.toHaveLength(0);
  });

  it('fora da janela, não reivindica nem envia ninguém', async () => {
    const m = montar();
    // Janela das 18h às 20h; 15:00 UTC é meio-dia em São Paulo.
    m.db.select.mockReturnValueOnce(
      m.consulta([{ ...ATIVA, janelaInicio: '18:00:00', janelaFim: '20:00:00' }]),
    );
    m.db.execute.mockResolvedValueOnce({ rows: [{ dia: 0, semana: 0, mes: 0, ultimo: null }] });

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(m.graph.enviarModelo).not.toHaveBeenCalled();
    // Só a contagem rodou: a reivindicação nem chegou a acontecer.
    expect(m.db.execute).toHaveBeenCalledTimes(1);
  });

  it('sem conexão, devolve os destinatários à fila e pausa — sem queimá-los', async () => {
    // Token vencido entre o disparo e a rodada não é culpa de quem ia receber.
    // Marcar como "falhou" perderia a campanha inteira por uma credencial.
    const m = montar();
    m.meta.tokenDaConta.mockResolvedValue(null);
    m.db.select
      .mockReturnValueOnce(m.consulta([ATIVA]))
      .mockReturnValueOnce(m.consulta([{ phoneNumberId: 'PN1' }]));
    m.db.execute
      .mockResolvedValueOnce({ rows: [{ dia: 0, semana: 0, mes: 0, ultimo: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'd1', telefone_e164: '5521999998888', variaveis: [] }] });

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(m.graph.enviarModelo).not.toHaveBeenCalled();
    expect(m.diario.find((e) => e.valores.status === 'pendente')).toBeDefined();
    expect(m.diario.find((e) => e.valores.status === 'pausada')).toBeDefined();
    expect(m.diario.find((e) => e.valores.status === 'falhou')).toBeUndefined();
  });

  it('ignora campanha que não está mais ativa', async () => {
    const m = montar();
    m.db.select.mockReturnValueOnce(m.consulta([{ ...ATIVA, status: 'cancelada' }]));
    m.db.execute.mockResolvedValueOnce({ rows: [{ dia: 0, semana: 0, mes: 0, ultimo: null }] });

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(m.graph.enviarModelo).not.toHaveBeenCalled();
  });
});
