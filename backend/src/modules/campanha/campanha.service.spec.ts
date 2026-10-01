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

jest.mock('../../config/env', () => ({ env: { mercadoPago: { carenciaDias: 5 } } }));

import { MidiaIndisponivel } from '../midia/midia.service';
import {
  CampanhaService,
  MAX_TENTATIVAS_ENVIO,
  detalheDaFalha,
  ehErroDeModelo,
  esperaDaNovaTentativa,
} from './campanha.service';
import { exigenciasDoEnvio } from '../meta/envio.regras';
import { ErroGraph } from '../meta/graph.service';
import { traduzirErroMeta } from '../meta/erros-meta';

const CONTA = '11111111-1111-4111-8111-111111111111';
const USUARIO = '22222222-2222-4222-8222-222222222222';
const CAMPANHA = '33333333-3333-4333-8333-333333333333';
const LISTA = '44444444-4444-4444-8444-444444444444';

interface Escrita {
  tipo: 'update' | 'insert';
  valores: Record<string, unknown>;
}

type Encadeavel = Record<string, unknown>;

function consulta(linhas: unknown[], diario: Escrita[], tipo?: 'update' | 'insert'): Encadeavel {
  const alvo: Encadeavel = {};
  for (const metodo of ['from', 'where', 'orderBy', 'groupBy', 'limit', 'returning', 'innerJoin', 'leftJoin']) {
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

/** O modelo `promo` como a lista da Meta o devolve (já traduzido por `MetaService.modelos`). */
const MODELO_PROMO = {
  id: '1',
  nome: 'promo',
  idioma: 'pt_BR',
  categoria: 'marketing',
  status: 'aprovado',
  motivo: null,
  cabecalho: null,
  corpo: 'Promoção de sexta!',
  rodape: null,
  variaveis: 0,
  botoes: [],
  exige: exigenciasDoEnvio([]),
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
    // O que a Meta diz da conta: um modelo aprovado, sem variável.
    modelos: jest.fn().mockResolvedValue([MODELO_PROMO]),
  };

  const graph = {
    enviarModelo: jest.fn().mockResolvedValue('wamid.ABC'),
  };

  const registrar = jest.fn().mockResolvedValue(undefined);
  const telemetria = { registrar: jest.fn().mockResolvedValue(undefined) };
  // A mídia do modelo: existe, e a Meta devolve um id quando ela sobe.
  const midias = {
    disponivelParaEnvio: jest.fn().mockResolvedValue(true),
    paraEnvio: jest.fn().mockResolvedValue({ id: 'MEDIA-1', nomeArquivo: 'promo.jpg' }),
  };

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
    telemetria as unknown as ConstructorParameters<typeof CampanhaService>[4],
    { avisar: jest.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<
      typeof CampanhaService
    >[5],
    midias as unknown as ConstructorParameters<typeof CampanhaService>[6],
  );

  return { service, db, meta, graph, midias, registrar, telemetria, diario, consulta: (l: unknown[]) => consulta(l, diario) };
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
    m.meta.modelos.mockResolvedValue([{ ...MODELO_PROMO, corpo: 'Oi, {{1}}!', variaveis: 1 }]);
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

/**
 * O modelo da campanha é o que a META diz, não o que a tela mandou. A tela só
 * oferece modelo aprovado, mas a tela não é a trava: um pedido montado à mão
 * criava campanha com modelo inexistente, recusado, ou com a categoria trocada
 * — e a categoria decide o descanso entre promoções.
 */
describe('criar — o modelo é conferido na Meta', () => {
  const pedido = {
    nome: 'Promoção de sexta',
    modeloNome: 'promo',
    modeloIdioma: 'pt_BR',
    destinatarios: [{ telefone: '5521999998888' }],
  };
  const criarCom = async (m: ReturnType<typeof montar>, extra: Record<string, unknown> = {}) => {
    m.db.insert.mockReturnValueOnce(consulta([{ id: CAMPANHA }], m.diario, 'insert'));
    return m.service.criar(CONTA, USUARIO, { ...pedido, ...extra });
  };
  const gravada = (m: ReturnType<typeof montar>) => m.diario.find((e) => e.tipo === 'insert')?.valores;

  it('recusa modelo que não está na conta da Meta, antes de gravar', async () => {
    const m = montar();
    const erro = await criarCom(m, { modeloNome: 'inventado' }).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(BadRequestException);
    expect((erro as BadRequestException).message).toContain('"inventado"');
    expect(m.db.insert).not.toHaveBeenCalled();
  });

  it.each(['em análise', 'recusado', 'pausado', 'desativado'])(
    'recusa modelo %s, dizendo o estado dele na Meta',
    async (status) => {
      const m = montar();
      m.meta.modelos.mockResolvedValue([{ ...MODELO_PROMO, status }]);
      const erro = await criarCom(m).catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(BadRequestException);
      expect((erro as BadRequestException).message).toContain(status);
      expect(m.db.insert).not.toHaveBeenCalled();
    },
  );

  it('o mesmo nome em outro idioma é outro modelo', async () => {
    const m = montar();
    const erro = await criarCom(m, { modeloIdioma: 'en_US' }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
  });

  it('grava nome, idioma, id e categoria como a Meta diz — não como a tela mandou', async () => {
    const m = montar();
    m.meta.modelos.mockResolvedValue([{ ...MODELO_PROMO, id: '777', categoria: 'marketing' }]);
    // A tela "manda" utilidade para escapar do descanso, e um id que não é o do modelo.
    await criarCom(m, { modeloCategoria: 'utilidade', modeloId: 'outro-id' });

    expect(gravada(m)).toEqual(
      expect.objectContaining({ modeloId: '777', modeloNome: 'promo', modeloIdioma: 'pt_BR', modeloCategoria: 'marketing' }),
    );
  });

  it('acha pelo id quando ele vem, mesmo com o nome trocado no pedido', async () => {
    const m = montar();
    await criarCom(m, { modeloId: '1', modeloNome: 'nome-errado' });
    expect(gravada(m)?.modeloNome).toBe('promo');
  });

  it('o descanso vale pela categoria da Meta: marketing dito "utilidade" pela tela descansa do mesmo jeito', async () => {
    const m = montar();
    m.db.select.mockReturnValueOnce(m.consulta([{ dias: 3 }])); // o descanso da conta
    await criarCom(m, { modeloCategoria: 'utilidade' });
    expect(gravada(m)?.descansoDias).toBe(3);
  });

  it('modelo de utilidade na Meta não descansa, mesmo que a tela diga marketing', async () => {
    const m = montar();
    m.meta.modelos.mockResolvedValue([{ ...MODELO_PROMO, categoria: 'utilidade' }]);
    m.db.select.mockReturnValueOnce(m.consulta([{ dias: 3 }]));
    await criarCom(m, { modeloCategoria: 'marketing' });
    expect(gravada(m)?.descansoDias).toBeNull();
  });

  it.each([
    ['a menos', 2, ['Ana'], 'usa 2 variáveis e a campanha trouxe 1'],
    ['a mais', 0, ['Ana'], 'não usa variável e a campanha trouxe 1'],
    ['nenhuma', 1, undefined, 'usa 1 variável e a campanha trouxe 0'],
  ])('recusa variável %s nos números digitados', async (_caso, variaveis, enviadas, trecho) => {
    const m = montar();
    m.meta.modelos.mockResolvedValue([{ ...MODELO_PROMO, variaveis }]);
    const erro = await criarCom(m, {
      destinatarios: [{ telefone: '5521999998888', ...(enviadas ? { variaveis: enviadas } : {}) }],
    }).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(BadRequestException);
    expect((erro as BadRequestException).message).toContain(trecho);
    expect(m.db.insert).not.toHaveBeenCalled();
  });

  it('recusa quando UM dos números digitados traz a conta errada de variáveis', async () => {
    const m = montar();
    m.meta.modelos.mockResolvedValue([{ ...MODELO_PROMO, variaveis: 1 }]);
    const erro = await criarCom(m, {
      destinatarios: [
        { telefone: '5521999998888', variaveis: ['Ana'] },
        { telefone: '5521999997777', variaveis: [] },
      ],
    }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
  });

  it('recusa variável a menos no público que sai da base', async () => {
    const m = montar();
    m.meta.modelos.mockResolvedValue([{ ...MODELO_PROMO, variaveis: 2 }]);
    const erro = await criarCom(m, {
      destinatarios: undefined,
      listaId: LISTA,
      variaveisLista: [{ origem: 'primeiro_nome', valor: 'cliente' }],
    }).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(BadRequestException);
    expect((erro as BadRequestException).message).toContain('usa 2 variáveis e a campanha trouxe 1');
    expect(m.db.insert).not.toHaveBeenCalled();
  });

  it('sem a Meta no ar não cria: o erro dela chega inteiro', async () => {
    const m = montar();
    m.meta.modelos.mockRejectedValue(new BadRequestException('Não conseguimos carregar seus modelos. Tente de novo.'));
    const erro = await criarCom(m).catch((e: unknown) => e);

    expect((erro as BadRequestException).message).toContain('Não conseguimos carregar seus modelos');
    expect(m.db.insert).not.toHaveBeenCalled();
  });
});

/**
 * Editar um rascunho passa pela mesma conferência da criação: o que fica
 * gravado é o modelo como a Meta o tem, e as variáveis fecham com ele.
 */
describe('editar — o modelo é conferido na Meta', () => {
  const comRascunho = (m: ReturnType<typeof montar>, extra: Record<string, unknown> = {}) =>
    m.db.select.mockReturnValueOnce(m.consulta([{ ...CAMPANHA_RASCUNHO, variaveisLista: [], ...extra }]));
  const gravado = (m: ReturnType<typeof montar>) => m.diario.find((e) => e.tipo === 'update')?.valores;

  it('mudar só o nome ou a janela não consulta a Meta', async () => {
    const m = montar();
    comRascunho(m);
    await m.service.editar(CONTA, USUARIO, CAMPANHA, { nome: 'Outro nome' }).catch(() => undefined);

    expect(m.meta.modelos).not.toHaveBeenCalled();
    expect(gravado(m)).toEqual({ nome: 'Outro nome' });
  });

  it('trocar o modelo grava o que a Meta diz dele, inclusive a categoria', async () => {
    const m = montar();
    comRascunho(m);
    m.meta.modelos.mockResolvedValue([
      MODELO_PROMO,
      { ...MODELO_PROMO, id: '2', nome: 'aviso', categoria: 'utilidade' },
    ]);
    await m.service
      .editar(CONTA, USUARIO, CAMPANHA, { modeloNome: 'aviso', modeloIdioma: 'pt_BR', modeloCategoria: 'marketing' })
      .catch(() => undefined);

    expect(gravado(m)).toEqual(
      expect.objectContaining({ modeloId: '2', modeloNome: 'aviso', modeloIdioma: 'pt_BR', modeloCategoria: 'utilidade' }),
    );
  });

  it('recusa trocar para um modelo que a Meta não aprovou', async () => {
    const m = montar();
    comRascunho(m);
    m.meta.modelos.mockResolvedValue([{ ...MODELO_PROMO, id: '2', nome: 'aviso', status: 'recusado' }]);

    await expect(
      m.service.editar(CONTA, USUARIO, CAMPANHA, { modeloNome: 'aviso', modeloIdioma: 'pt_BR' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(m.db.update).not.toHaveBeenCalled();
  });

  it('trocar SÓ o modelo confere as variáveis que a campanha já tem gravadas', async () => {
    const m = montar();
    comRascunho(m, { variaveisLista: [{ origem: 'primeiro_nome', valor: 'cliente' }] }); // 1 valor gravado
    m.meta.modelos.mockResolvedValue([{ ...MODELO_PROMO, id: '2', nome: 'aviso', variaveis: 2 }]);

    const erro = await m.service
      .editar(CONTA, USUARIO, CAMPANHA, { modeloNome: 'aviso', modeloIdioma: 'pt_BR' })
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(BadRequestException);
    expect((erro as BadRequestException).message).toContain('usa 2 variáveis e a campanha trouxe 1');
    expect(m.db.update).not.toHaveBeenCalled();
  });

  it('números digitados: as variáveis gravadas saem da fila da campanha', async () => {
    const m = montar();
    comRascunho(m, { variaveisLista: null });
    m.db.execute.mockResolvedValueOnce({ rows: [{ n: 0 }] }); // toda a fila sem variável
    m.meta.modelos.mockResolvedValue([{ ...MODELO_PROMO, id: '2', nome: 'aviso', variaveis: 1 }]);

    await expect(
      m.service.editar(CONTA, USUARIO, CAMPANHA, { modeloNome: 'aviso', modeloIdioma: 'pt_BR' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('trocar o público confere as variáveis que vêm no pedido, contra o modelo que a campanha já tem', async () => {
    const m = montar();
    comRascunho(m);
    m.meta.modelos.mockResolvedValue([{ ...MODELO_PROMO, variaveis: 1 }]);

    const erro = await m.service
      .editar(CONTA, USUARIO, CAMPANHA, { listaId: LISTA, variaveisLista: [] })
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(BadRequestException);
    expect((erro as BadRequestException).message).toContain('usa 1 variável e a campanha trouxe 0');
    expect(m.db.delete).not.toHaveBeenCalled();
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
    cicloInicio: new Date('2026-09-01T03:00:00Z'),
  };

  /** Uma rodada completa: ler, contar, reivindicar, conectar, enviar, concluir. */
  function prepararRodada(
    m: ReturnType<typeof montar>,
    reivindicados: unknown[],
    campanha: Record<string, unknown> = ATIVA,
    saldo?: number,
    limiteDaMeta: unknown[] = [],
  ) {
    m.db.select
      .mockReturnValueOnce(m.consulta([campanha])) // ler a campanha
      .mockReturnValueOnce(m.consulta([{ phoneNumberId: 'PN1' }])) // número, na conexão
      .mockReturnValueOnce(m.consulta([{ restam: 0 }])); // concluir
    m.db.execute
      .mockResolvedValueOnce({ rows: [{ dia: 0, semana: 0, mes: 0, ultimo: null }] }) // contagem
      .mockResolvedValueOnce({ rows: [] }) // tira da fila quem pediu para sair
      .mockResolvedValueOnce({ rows: [] }) // tira da fila quem está sem WhatsApp
      .mockResolvedValueOnce({ rows: [] }) // trava do teto da conta
      .mockResolvedValueOnce({ rows: [] }) // bloqueio por inadimplência (sem assinatura: libera)
      .mockResolvedValueOnce({ rows: saldo === undefined ? [] : [{ teto: 100, usados: 100 - saldo, em_voo: 0 }] }) // saldo do plano
      .mockResolvedValueOnce({ rows: limiteDaMeta }) // limite da Meta (vazio: nunca lido, não trava)
      .mockResolvedValueOnce({ rows: reivindicados }); // reivindicação
  }

  /** A reivindicação e o limite que ela usou (o limite entra como parâmetro: ',N,'). */
  function reivindicacao(m: ReturnType<typeof montar>): string | undefined {
    return m.db.execute.mock.calls.map((c) => JSON.stringify(c[0])).find((t) => t.includes('skip locked'));
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

  it('antes de reivindicar, tira da fila quem pediu para sair — na mesma campanha', async () => {
    // Entre montar e a janela abrir podem passar dias. Quem se descadastrou
    // nesse meio-tempo não pode receber: é regra da Meta e derruba a qualidade.
    const m = montar();
    prepararRodada(m, [{ id: 'd1', telefone_e164: '5521999998888', variaveis: [] }]);

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    const chamadas = m.db.execute.mock.calls.map((c) => JSON.stringify(c[0]));
    const descadastro = chamadas.findIndex((t) => t.includes('opt_out = true'));
    const reivindicacao = chamadas.findIndex((t) => t.includes('skip locked'));
    expect(descadastro).toBeGreaterThan(-1);
    expect(descadastro).toBeLessThan(reivindicacao);
    // Só marca quem ainda não saiu, e com o motivo à vista.
    expect(chamadas[descadastro]).toContain("d.status = 'pendente'");
    expect(chamadas[descadastro]).toContain('Pediu para sair');
    expect(chamadas[descadastro]).toContain(CAMPANHA);
  });

  it('sem disparos no plano, PAUSA a campanha e não reivindica ninguém', async () => {
    // O plano é o que o cliente pagou. Passar do teto é mandar de graça — e a
    // campanha não pode morrer: os destinatários ficam na fila, intactos.
    const m = montar();
    m.db.select.mockReturnValueOnce(m.consulta([ATIVA]));
    m.db.execute
      .mockResolvedValueOnce({ rows: [{ dia: 0, semana: 0, mes: 0, ultimo: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) // sem WhatsApp
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ teto: 5000, usados: 5000, em_voo: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(m.graph.enviarModelo).not.toHaveBeenCalled();
    const chamadas = m.db.execute.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(chamadas.some((t) => t.includes('skip locked'))).toBe(false);
    expect(chamadas.some((t) => t.includes("pausa_motivo = 'teto_plano'"))).toBe(true);
  });

  it('inadimplente depois da carência: PAUSA por inadimplência, sem reivindicar', async () => {
    const m = montar();
    m.db.select.mockReturnValueOnce(m.consulta([ATIVA]));
    m.db.execute
      .mockResolvedValueOnce({ rows: [{ dia: 0, semana: 0, mes: 0, ultimo: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) // sem WhatsApp
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'inadimplente', gratis_vencido: false, carencia_vencida: true }] })
      .mockResolvedValueOnce({ rows: [] });

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(m.graph.enviarModelo).not.toHaveBeenCalled();
    const chamadas = m.db.execute.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(chamadas.some((t) => t.includes('skip locked'))).toBe(false);
    expect(chamadas.some((t) => t.includes("pausa_motivo = 'inadimplencia'"))).toBe(true);
  });

  it('com pouco saldo, reivindica só o que cabe no plano', async () => {
    const m = montar();
    prepararRodada(m, [{ id: 'd1', telefone_e164: '5521999998888', variaveis: [] }], ATIVA, 3);

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    const reivindicacao = m.db.execute.mock.calls
      .map((c) => c[0] as { queryChunks?: unknown[] })
      .find((q) => JSON.stringify(q).includes('skip locked'));
    // O lote padrão é 20; com 3 disparos sobrando, o limite da consulta é 3.
    // O limite entra como parâmetro da consulta: ',3,' entre os pedaços do SQL.
    expect(JSON.stringify(reivindicacao)).toContain(',3,');
    expect(JSON.stringify(reivindicacao)).not.toContain(',20,');
  });

  it('a trava do teto é por CONTA, e vem antes da reivindicação', async () => {
    const m = montar();
    prepararRodada(m, [{ id: 'd1', telefone_e164: '5521999998888', variaveis: [] }]);

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    const chamadas = m.db.execute.mock.calls.map((c) => JSON.stringify(c[0]));
    const trava = chamadas.findIndex((t) => t.includes('regemcast.teto.' + CONTA));
    const reivindicacao = chamadas.findIndex((t) => t.includes('skip locked'));
    expect(trava).toBeGreaterThan(-1);
    expect(trava).toBeLessThan(reivindicacao);
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
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) // sem WhatsApp
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) // limite da Meta
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

  it('CONTA o disparo no ciclo da assinatura, junto com o status', async () => {
    // Até esta mudança o contador nunca era incrementado: a tela de Conta
    // mostrava consumo zero para sempre e a cobrança não tinha o que medir.
    const m = montar();
    prepararRodada(m, [{ id: 'd1', telefone_e164: '5521999998888', variaveis: [] }]);

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    const chamadas = m.db.execute.mock.calls.map((c) => JSON.stringify(c[0]));
    const contagem = chamadas.find((t) => t.includes('insert into uso_ciclo'));
    expect(contagem).toBeDefined();
    // Upsert atômico: somar no banco, e nunca ler-somar-gravar em código.
    expect(contagem).toContain('disparos + 1');
  });

  it('NÃO conta o disparo que a Meta recusou', async () => {
    const m = montar();
    prepararRodada(m, [{ id: 'd1', telefone_e164: '5521999998888', variaveis: [] }]);
    m.graph.enviarModelo.mockRejectedValueOnce(
      new ErroGraph({ status: 400, codigo: 131026, traduzido: traduzirErroMeta(131026) }),
    );

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    const chamadas = m.db.execute.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(chamadas.find((t) => t.includes('insert into uso_ciclo'))).toBeUndefined();
  });

  it('manda a recusa da Meta para a telemetria — SEM o telefone', async () => {
    const m = montar();
    prepararRodada(m, [{ id: 'd1', telefone_e164: '5521999998888', variaveis: [] }]);
    m.graph.enviarModelo.mockRejectedValueOnce(
      new ErroGraph({ status: 400, codigo: 131049, traduzido: traduzirErroMeta(131049) }),
    );

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(m.telemetria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ origem: 'meta', codigo: 131049, contaId: CONTA }),
    );
    // A telemetria é da distribuição e agrupa por conta e código. O telefone
    // de quem ia receber não tem nada a fazer lá.
    const gravado = JSON.stringify(m.telemetria.registrar.mock.calls[0][0]);
    expect(gravado).not.toContain('5521999998888');
  });
  // ------------------------------------------------------------- limite da Meta

  it('limite da Meta cheio: não reivindica ninguém — e NÃO pausa: continua sozinha quando abrir vaga', async () => {
    const m = montar();
    m.db.select
      .mockReturnValueOnce(m.consulta([ATIVA]))
      .mockReturnValueOnce(m.consulta([{ restam: 40 }])); // concluir: ainda há fila
    m.db.execute
      .mockResolvedValueOnce({ rows: [{ dia: 0, semana: 0, mes: 0, ultimo: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) // sem WhatsApp
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ limite: 250, alcancados: 250, em_voo: 0, libera_em: '2026-09-17T10:00:00Z' }] });

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(m.graph.enviarModelo).not.toHaveBeenCalled();
    expect(reivindicacao(m)).toBeUndefined();
    // Pausar obrigaria alguém a retomar; a vaga abre sozinha na janela de 24 h.
    const chamadas = m.db.execute.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(chamadas.some((t) => t.includes('pausa_motivo'))).toBe(false);
    expect(m.diario.find((e) => e.valores.status === 'pausada')).toBeUndefined();
  });

  it('limite da Meta quase cheio: reivindica só as vagas que sobram', async () => {
    const m = montar();
    prepararRodada(m, [{ id: 'd1', telefone_e164: '5521999998888', variaveis: [] }], ATIVA, undefined, [
      { limite: 250, alcancados: 247, em_voo: 1, libera_em: null },
    ]);

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    // 250 - 247 alcançados - 1 saindo agora = 2 vagas; o lote padrão seria 20.
    expect(reivindicacao(m)).toContain(',2,');
    expect(reivindicacao(m)).not.toContain(',20,');
  });

  it('sem teto ou limite nunca lido: não trava', async () => {
    const m = montar();
    prepararRodada(m, [{ id: 'd1', telefone_e164: '5521999998888', variaveis: [] }], ATIVA, undefined, [
      { limite: null, alcancados: 99_999, em_voo: 0, libera_em: null },
    ]);

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(reivindicacao(m)).toContain(',20,');
    expect(m.graph.enviarModelo).toHaveBeenCalledTimes(1);
  });

  it('a reserva é materializada antes do update — com a RLS, a forma `where id in (select … limit N)` reservava a fila inteira', async () => {
    const m = montar();
    prepararRodada(m, [{ id: 'd1', telefone_e164: '5521999998888', variaveis: [] }]);

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(reivindicacao(m)).toContain('as materialized');
    expect(reivindicacao(m)).not.toMatch(/where id in \(/);
  });

  it('descanso: com dias na campanha, quem recebeu marketing de OUTRA campanha vira "descanso" na própria reserva', async () => {
    const m = montar();
    prepararRodada(m, [{ id: 'd1', telefone_e164: '5521999998888', variaveis: [] }], { ...ATIVA, descansoDias: 3 });

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    const r = reivindicacao(m) ?? '';
    expect(r).toContain('descanso as (');
    expect(r).toContain("set status = 'descanso'");
    expect(r).toContain('o.campanha_id <>');
    expect(r).toContain('not in (select id from descanso)');
    // O dia entra como parâmetro, e a mensagem diz quantos dias.
    expect(r).toContain('Recebeu outra campanha de marketing há menos de 3 dias');
  });

  it('sem descanso na campanha (antigas, utilidade ou liberada pelo dono), a reserva é a de sempre', async () => {
    const m = montar();
    prepararRodada(m, [{ id: 'd1', telefone_e164: '5521999998888', variaveis: [] }]);

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(reivindicacao(m)).not.toContain('descanso');
  });

  it('antes de reivindicar, tira da fila quem está sem WhatsApp', async () => {
    const m = montar();
    prepararRodada(m, [{ id: 'd1', telefone_e164: '5521999998888', variaveis: [] }]);

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    const chamadas = m.db.execute.mock.calls.map((c) => JSON.stringify(c[0]));
    const semWhatsapp = chamadas.findIndex((t) => t.includes('sem_whatsapp_em is not null'));
    const reivindicacaoIdx = chamadas.findIndex((t) => t.includes('skip locked'));
    expect(semWhatsapp).toBeGreaterThan(-1);
    expect(semWhatsapp).toBeLessThan(reivindicacaoIdx);
  });

  it('a reivindicação pula quem tem nova tentativa marcada para depois', async () => {
    const m = montar();
    prepararRodada(m, [{ id: 'd1', telefone_e164: '5521999998888', variaveis: [] }]);

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(reivindicacao(m)).toContain('proxima_tentativa_em is null or proxima_tentativa_em <= now()');
  });

  // ------------------------------------------------------------- recusas da Meta

  it('a Meta pede calma (130429): quem recebeu a recusa volta com nova tentativa, o resto da rodada volta à fila e a campanha espera — sem pausar', async () => {
    const m = montar();
    prepararRodada(m, [
      { id: 'd1', telefone_e164: '5521999998888', variaveis: [], tentativas: 0 },
      { id: 'd2', telefone_e164: '5521777776666', variaveis: [], tentativas: 0 },
      { id: 'd3', telefone_e164: '5521555554444', variaveis: [], tentativas: 0 },
    ]);
    m.graph.enviarModelo.mockRejectedValueOnce(
      new ErroGraph({ status: 400, codigo: 130429, traduzido: traduzirErroMeta(130429) }),
    );

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    // Continuar a rodada seria bater no mesmo muro com os próximos.
    expect(m.graph.enviarModelo).toHaveBeenCalledTimes(1);
    const novaTentativa = m.diario.find((e) => e.valores.tentativas === 1);
    expect(novaTentativa?.valores.status).toBe('pendente');
    expect(novaTentativa?.valores.proximaTentativaEm).toBeInstanceOf(Date);
    // A campanha espera o tempo pedido; os outros dois voltam como estavam.
    expect(m.diario.find((e) => 'retomarEm' in e.valores)).toBeDefined();
    expect(m.diario.filter((e) => e.valores.status === 'pendente')).toHaveLength(2);
    // "Nenhuma mensagem se perde": ninguém queimado, nada pausado.
    expect(m.diario.find((e) => e.valores.status === 'falhou')).toBeUndefined();
    expect(m.diario.find((e) => e.valores.status === 'pausada')).toBeUndefined();
  });

  it('instabilidade da Meta (133004): o destinatário volta mais tarde, e a rodada segue com os outros', async () => {
    const m = montar();
    prepararRodada(m, [
      { id: 'd1', telefone_e164: '5521999998888', variaveis: [], tentativas: 0 },
      { id: 'd2', telefone_e164: '5521777776666', variaveis: [], tentativas: 0 },
    ]);
    m.graph.enviarModelo
      .mockRejectedValueOnce(new ErroGraph({ status: 503, codigo: 133004, traduzido: traduzirErroMeta(133004) }))
      .mockResolvedValueOnce('wamid.2');

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(m.graph.enviarModelo).toHaveBeenCalledTimes(2);
    expect(m.diario.find((e) => e.valores.tentativas === 1)?.valores.status).toBe('pendente');
    expect(m.diario.find((e) => e.valores.waMessageId === 'wamid.2')?.valores.status).toBe('enviada');
    expect(m.diario.find((e) => 'retomarEm' in e.valores)).toBeUndefined();
  });

  it('rede caída no meio do envio: falha SEM reenviar — pode ter chegado, e reenviar duplicaria', async () => {
    const m = montar();
    prepararRodada(m, [{ id: 'd1', telefone_e164: '5521999998888', variaveis: [], tentativas: 0 }]);
    m.graph.enviarModelo.mockRejectedValueOnce(
      new ErroGraph({
        status: 0,
        codigo: null,
        traduzido: { codigo: 0, classe: 'transitorio', titulo: 'Não conseguimos falar com a Meta', explicacao: 'x', esperaSegundos: 60 },
      }),
    );

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    const falha = m.diario.find((e) => e.valores.status === 'falhou');
    expect(falha).toBeDefined();
    expect(String(falha?.valores.erroDetalhe)).toContain('não dá para saber se a mensagem chegou');
    expect(m.diario.find((e) => e.valores.tentativas !== undefined)).toBeUndefined();
  });

  it(`depois de ${MAX_TENTATIVAS_ENVIO} novas tentativas, falha de vez dizendo quantas vezes a Meta recusou`, async () => {
    const m = montar();
    prepararRodada(m, [
      { id: 'd1', telefone_e164: '5521999998888', variaveis: [], tentativas: MAX_TENTATIVAS_ENVIO },
    ]);
    m.graph.enviarModelo.mockRejectedValueOnce(
      new ErroGraph({ status: 503, codigo: 133004, traduzido: traduzirErroMeta(133004) }),
    );

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    const falha = m.diario.find((e) => e.valores.status === 'falhou');
    expect(falha?.valores.erroCodigo).toBe(133004);
    expect(String(falha?.valores.erroDetalhe)).toContain(`recusou ${MAX_TENTATIVAS_ENVIO + 1} vezes`);
  });

  it('campanha esperando a Meta (retomar_em no futuro) não reivindica nem envia', async () => {
    const m = montar();
    m.db.select.mockReturnValueOnce(m.consulta([{ ...ATIVA, retomarEm: new Date('2026-09-16T15:10:00Z') }]));
    m.db.execute.mockResolvedValueOnce({ rows: [{ dia: 0, semana: 0, mes: 0, ultimo: null }] });

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(m.graph.enviarModelo).not.toHaveBeenCalled();
    expect(m.db.execute).toHaveBeenCalledTimes(1);
  });

  // ------------------------------------------------ o que o modelo exige no envio

  /** A campanha com o plano gravado ao montar: imagem no cabeçalho. */
  const COM_IMAGEM = { ...ATIVA, nome: 'Promo', envio: { cabecalho: { tipo: 'image', midia: 'midia:aaa' } } };
  const DOIS = [
    { id: 'd1', telefone_e164: '5521999998888', variaveis: ['Ana'], tentativas: 0, variavel_cabecalho: null },
    { id: 'd2', telefone_e164: '5521777776666', variaveis: ['Bia'], tentativas: 0, variavel_cabecalho: null },
  ];
  const pausa = (m: ReturnType<typeof montar>) => m.diario.find((e) => e.valores.status === 'pausada')?.valores;
  const voltaramParaAFila = (m: ReturnType<typeof montar>) => m.diario.some((e) => e.valores.status === 'pendente');

  it('modelo com imagem: a mídia sobe UMA vez por rodada e cada mensagem leva o cabeçalho', async () => {
    const m = montar();
    prepararRodada(m, DOIS, COM_IMAGEM);

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(m.midias.paraEnvio).toHaveBeenCalledTimes(1);
    expect(m.midias.paraEnvio).toHaveBeenCalledWith(CONTA, 'PN1', 'EAA-token', 'midia:aaa');
    expect(m.graph.enviarModelo).toHaveBeenCalledTimes(2);
    expect(m.graph.enviarModelo.mock.calls[0][1].componentes).toEqual([
      { type: 'header', parameters: [{ type: 'image', image: { id: 'MEDIA-1' } }] },
      { type: 'body', parameters: [{ type: 'text', text: 'Ana' }] },
    ]);
  });

  it('sem plano, o envio não leva `componentes`: campanha antiga sai como sempre saiu', async () => {
    const m = montar();
    prepararRodada(m, DOIS);

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(m.midias.paraEnvio).not.toHaveBeenCalled();
    expect(m.graph.enviarModelo.mock.calls[0][1]).not.toHaveProperty('componentes');
  });

  it('a Meta recusa o MODELO (132012): só a primeira falha, a rodada para e a campanha pausa pelo modelo', async () => {
    const m = montar();
    prepararRodada(m, DOIS, COM_IMAGEM);
    m.graph.enviarModelo.mockRejectedValue(
      new ErroGraph({ status: 400, codigo: 132012, traduzido: traduzirErroMeta(132012) }),
    );

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    // Sem a parada, cada destinatário viraria "falhou", um por um, até a fila acabar.
    expect(m.graph.enviarModelo).toHaveBeenCalledTimes(1);
    expect(m.diario.filter((e) => e.valores.status === 'falhou')).toHaveLength(1);
    expect(pausa(m)?.pausaMotivo).toBe('modelo');
    expect(voltaramParaAFila(m)).toBe(true);
  });

  it('erro que é da PESSOA (131026) não pausa: a rodada segue para o próximo', async () => {
    const m = montar();
    prepararRodada(m, DOIS, COM_IMAGEM);
    m.graph.enviarModelo.mockRejectedValueOnce(
      new ErroGraph({ status: 400, codigo: 131026, traduzido: traduzirErroMeta(131026) }),
    );

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(m.graph.enviarModelo).toHaveBeenCalledTimes(2);
    expect(pausa(m)).toBeUndefined();
  });

  it('o arquivo do modelo sumiu: ninguém é enviado nem queimado, e a campanha pausa pelo modelo', async () => {
    const m = montar();
    prepararRodada(m, DOIS, COM_IMAGEM);
    m.midias.paraEnvio.mockRejectedValue(new MidiaIndisponivel('O arquivo do modelo não está mais disponível.'));

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(m.graph.enviarModelo).not.toHaveBeenCalled();
    expect(m.diario.some((e) => e.valores.status === 'falhou')).toBe(false);
    expect(pausa(m)?.pausaMotivo).toBe('modelo');
    expect(voltaramParaAFila(m)).toBe(true);
  });

  it('a rede cai ao subir o arquivo: a rodada volta à fila e a campanha espera, SEM pausar', async () => {
    const m = montar();
    prepararRodada(m, DOIS, COM_IMAGEM);
    m.midias.paraEnvio.mockRejectedValue(
      new ErroGraph({
        status: 0,
        codigo: null,
        traduzido: { codigo: 0, classe: 'transitorio', titulo: 'Sem conexão', explicacao: 'x', esperaSegundos: 60 },
      }),
    );

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(m.graph.enviarModelo).not.toHaveBeenCalled();
    expect(pausa(m)).toBeUndefined();
    expect(m.diario.some((e) => 'retomarEm' in e.valores)).toBe(true);
    expect(voltaramParaAFila(m)).toBe(true);
  });

  it('a autorização venceu ao subir o arquivo (190): pausa pela conexão, não pelo modelo', async () => {
    const m = montar();
    prepararRodada(m, DOIS, COM_IMAGEM);
    m.midias.paraEnvio.mockRejectedValue(new ErroGraph({ status: 401, codigo: 190, traduzido: traduzirErroMeta(190) }));

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(m.graph.enviarModelo).not.toHaveBeenCalled();
    expect(pausa(m)?.pausaMotivo).toBe('conexao');
  });

  it('variável do título: quem ficou sem valor falha com o motivo dito, e os outros recebem', async () => {
    const m = montar();
    prepararRodada(
      m,
      [
        { id: 'd1', telefone_e164: '5521999998888', variaveis: [], tentativas: 0, variavel_cabecalho: '  ' },
        { id: 'd2', telefone_e164: '5521777776666', variaveis: [], tentativas: 0, variavel_cabecalho: 'Bia' },
      ],
      { ...ATIVA, nome: 'Promo', envio: { cabecalho: { tipo: 'texto', origem: 'nome', valor: 'cliente' } } },
    );

    await m.service.processarRodada(CAMPANHA, new Date('2026-09-16T15:00:00Z'));

    expect(m.diario.find((e) => e.valores.status === 'falhou')?.valores.erroTitulo).toBe('Sem valor para o título');
    expect(m.graph.enviarModelo).toHaveBeenCalledTimes(1);
    expect(m.graph.enviarModelo.mock.calls[0][1].componentes).toEqual([
      { type: 'header', parameters: [{ type: 'text', text: 'Bia' }] },
    ]);
    expect(pausa(m)).toBeUndefined();
  });
});

describe('ehErroDeModelo', () => {
  it.each([132000, 132001, 132005, 132007, 132012, 132015, 132016])('%d é do modelo: a campanha para', (codigo) => {
    expect(ehErroDeModelo(codigo)).toBe(true);
  });

  it.each([131026, 131049, 130429, 190, 131999, 132017, null, undefined])('%p não é: a rodada segue', (codigo) => {
    expect(ehErroDeModelo(codigo)).toBe(false);
  });
});

/**
 * O plano de envio é montado ao CRIAR a campanha: a forma vem da Meta, os
 * valores vêm do modelo como foi criado no Regemcast. Faltando a origem de
 * alguma coisa, a recusa vem antes de gravar — e não depois do disparo.
 */
describe('criar — o que o modelo exige no envio', () => {
  const pedido = { nome: 'Promo', modeloNome: 'promo', modeloIdioma: 'pt_BR', destinatarios: [{ telefone: '5521999998888' }] };
  const naMeta = (componentes: unknown[]) => ({ ...MODELO_PROMO, exige: exigenciasDoEnvio(componentes) });
  const IMAGEM = [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Olha!' }];
  const criarCom = async (m: ReturnType<typeof montar>, extra: Record<string, unknown> = {}) => {
    m.db.insert.mockReturnValueOnce(consulta([{ id: CAMPANHA }], m.diario, 'insert'));
    return m.service.criar(CONTA, USUARIO, { ...pedido, ...extra });
  };
  const gravada = (m: ReturnType<typeof montar>) => m.diario.find((e) => e.tipo === 'insert')?.valores;
  /** O modelo como foi criado no Regemcast — é a primeira leitura do banco na criação. */
  const local = (m: ReturnType<typeof montar>, linha: Record<string, unknown> | null) =>
    m.db.select.mockReturnValueOnce(m.consulta(linha ? [{ metaTemplateId: '1', botoes: [], cartoes: [], ltoHoras: null, ...linha }] : []));

  it('modelo só de texto não ganha plano', async () => {
    const m = montar();
    await criarCom(m);
    expect(gravada(m)?.envio).toBeNull();
  });

  it('imagem no cabeçalho: o plano guarda a mídia do próprio modelo', async () => {
    const m = montar();
    m.meta.modelos.mockResolvedValue([naMeta(IMAGEM)]);
    local(m, { cabecalhoMidia: 'midia:aaa' });

    await criarCom(m);

    expect(m.midias.disponivelParaEnvio).toHaveBeenCalledWith(CONTA, 'midia:aaa');
    expect(gravada(m)?.envio).toEqual({ cabecalho: { tipo: 'image', midia: 'midia:aaa' } });
  });

  it('modelo com imagem criado direto na Meta: não temos o arquivo, e a recusa diz isso', async () => {
    const m = montar();
    m.meta.modelos.mockResolvedValue([naMeta(IMAGEM)]);
    local(m, null);

    const erro = await criarCom(m).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(BadRequestException);
    expect((erro as BadRequestException).message).toContain('não foi criado pelo Regemcast');
    expect(m.db.insert).not.toHaveBeenCalled();
  });

  it('o arquivo do modelo não está mais guardado: recusa mandando enviar de novo', async () => {
    const m = montar();
    m.meta.modelos.mockResolvedValue([naMeta(IMAGEM)]);
    local(m, { cabecalhoMidia: 'midia:aaa' });
    m.midias.disponivelParaEnvio.mockResolvedValue(false);

    const erro = await criarCom(m).catch((e: unknown) => e);

    expect((erro as BadRequestException).message).toContain('não está mais disponível');
    expect(m.db.insert).not.toHaveBeenCalled();
  });

  it('cupom: o código sai do modelo, a posição sai da Meta', async () => {
    const m = montar();
    m.meta.modelos.mockResolvedValue([
      naMeta([{ type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Pedir', url: 'https://x.example' }, { type: 'COPY_CODE', example: 'VOLTA10' }] }]),
    ]);
    local(m, { botoes: [{ tipo: 'URL', texto: 'Pedir' }, { tipo: 'COPY_CODE', texto: ' VOLTA10 ' }] });

    await criarCom(m);

    expect(gravada(m)?.envio).toEqual({ cupom: { indice: 1, codigo: 'VOLTA10' } });
  });

  it('carrossel: uma mídia por cartão, na ordem; número de cartões diferente é recusado', async () => {
    const cartao = { components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'X' }] };
    const m = montar();
    m.meta.modelos.mockResolvedValue([naMeta([{ type: 'BODY', text: 'Veja' }, { type: 'CAROUSEL', cards: [cartao, cartao] }])]);
    local(m, { cartoes: [{ imagem: 'midia:c0' }, { imagem: 'midia:c1' }] });
    await criarCom(m);
    expect(gravada(m)?.envio).toEqual({
      cartoes: [
        { tipo: 'image', midia: 'midia:c0', respostas: [] },
        { tipo: 'image', midia: 'midia:c1', respostas: [] },
      ],
    });

    const outro = montar();
    outro.meta.modelos.mockResolvedValue([naMeta([{ type: 'CAROUSEL', cards: [cartao, cartao] }])]);
    local(outro, { cartoes: [{ imagem: 'midia:c0' }] });
    await expect(criarCom(outro)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('oferta por tempo limitado: as horas do modelo; sem elas (ou sem o modelo aqui), 3', async () => {
    const OFERTA = [{ type: 'LIMITED_TIME_OFFER', limited_time_offer: { text: 'Só hoje', has_expiration: true } }, { type: 'BODY', text: 'Corre' }];
    const com = montar();
    com.meta.modelos.mockResolvedValue([naMeta(OFERTA)]);
    local(com, { ltoHoras: 12 });
    await criarCom(com);
    expect(gravada(com)?.envio).toEqual({ oferta: { horas: 12 } });

    const sem = montar();
    sem.meta.modelos.mockResolvedValue([naMeta(OFERTA)]);
    local(sem, null);
    await criarCom(sem);
    expect(gravada(sem)?.envio).toEqual({ oferta: { horas: 3 } });
  });

  describe('variável no título', () => {
    const TITULO = [{ type: 'HEADER', format: 'TEXT', text: 'Oi, {{1}}!' }, { type: 'BODY', text: 'Novidade.' }];

    it('sem o valor, recusa pedindo para preencher', async () => {
      const m = montar();
      m.meta.modelos.mockResolvedValue([naMeta(TITULO)]);
      const erro = await criarCom(m).catch((e: unknown) => e);
      expect((erro as BadRequestException).message).toContain('variável no título');
      expect(m.db.insert).not.toHaveBeenCalled();
    });

    it('com texto fixo, o plano guarda de onde ela sai e cada número digitado leva o valor', async () => {
      const m = montar();
      m.meta.modelos.mockResolvedValue([naMeta(TITULO)]);
      await criarCom(m, { variavelCabecalho: { origem: 'fixo', valor: ' Pessoal ' } });

      expect(gravada(m)?.envio).toEqual({ cabecalho: { tipo: 'texto', origem: 'fixo', valor: 'Pessoal' } });
      const fila = m.diario.filter((e) => e.tipo === 'insert').at(-1)?.valores as unknown as Array<{ variavelCabecalho: string }>;
      expect(fila[0]?.variavelCabecalho).toBe('Pessoal');
    });

    it.each([
      ['nome do contato com números digitados', { origem: 'nome', valor: 'cliente' }, 'texto fixo'],
      ['cashback', { origem: 'cashback_saldo', valor: '' }, 'texto fixo ou o nome'],
      ['valor vazio', { origem: 'fixo', valor: '   ' }, 'Preencha'],
      ['mais de 60 caracteres', { origem: 'fixo', valor: 'x'.repeat(61) }, '60 caracteres'],
    ])('recusa %s', async (_caso, variavelCabecalho, trecho) => {
      const m = montar();
      m.meta.modelos.mockResolvedValue([naMeta(TITULO)]);
      const erro = await criarCom(m, { variavelCabecalho }).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(BadRequestException);
      expect((erro as BadRequestException).message).toContain(trecho);
      expect(m.db.insert).not.toHaveBeenCalled();
    });
  });

  it('o que o disparo ainda não sabe mandar é recusado com o motivo', async () => {
    const m = montar();
    m.meta.modelos.mockResolvedValue([
      naMeta([{ type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Ver', url: 'https://x.example/{{1}}' }] }]),
    ]);
    const erro = await criarCom(m).catch((e: unknown) => e);
    expect((erro as BadRequestException).message).toContain('link com variável');
    expect(m.db.insert).not.toHaveBeenCalled();
  });
});

describe('nova tentativa', () => {
  it('espera o que a Meta pede, dobrando a cada recusa, até 1 hora', () => {
    expect(esperaDaNovaTentativa(60, 0)).toBe(60);
    expect(esperaDaNovaTentativa(60, 2)).toBe(240);
    expect(esperaDaNovaTentativa(900, 3)).toBe(3_600);
    expect(esperaDaNovaTentativa(undefined, 0)).toBe(60);
  });

  it('o que a Meta manda esperar um dia, espera um dia — não mais', () => {
    expect(esperaDaNovaTentativa(86_400, 0)).toBe(86_400);
    expect(esperaDaNovaTentativa(86_400, 5)).toBe(86_400);
  });

  it('a falha definitiva não promete o que não vai acontecer', () => {
    const recusa = new ErroGraph({ status: 400, codigo: 131026, traduzido: traduzirErroMeta(131026) });
    expect(detalheDaFalha(recusa, 0)).toBe(recusa.mensagemParaUsuario);
    expect(detalheDaFalha(null, 0)).toBe('Não conseguimos enviar esta mensagem.');
  });
});
