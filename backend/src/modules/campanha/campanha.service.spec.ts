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
  for (const metodo of ['from', 'where', 'orderBy', 'groupBy', 'limit', 'returning']) {
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
  };

  const meta = {
    tokenDaConta: jest.fn().mockResolvedValue({ token: 'EAA-token', wabaId: 'WABA1' }),
  };

  const graph = {
    enviarModelo: jest.fn().mockResolvedValue('wamid.ABC'),
  };

  const registrar = jest.fn().mockResolvedValue(undefined);

  const ctx = { db, contaId: CONTA, contaObrigatoria: () => CONTA };

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

/** Prepara a sequência de selects que um `disparar` completo consome. */
function prepararDisparo(m: ReturnType<typeof montar>, pendentes: unknown[]) {
  m.db.select
    .mockReturnValueOnce(m.consulta([CAMPANHA_RASCUNHO])) // buscar
    .mockReturnValueOnce(m.consulta([{ phoneNumberId: 'PN1', status: 'registrado' }])) // número
    .mockReturnValueOnce(m.consulta(pendentes)) // pendentes
    .mockReturnValueOnce(m.consulta([CAMPANHA_RASCUNHO])) // buscar, no detalhe
    .mockReturnValueOnce(m.consulta([{ status: 'enviada', quantos: pendentes.length }])); // contagem
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
  it('grava o wamid e marca "enviada" — nunca "entregue"', async () => {
    const m = montar();
    prepararDisparo(m, [{ id: 'd1', telefone: '5521999998888', variaveis: ['Ana'] }]);

    await m.service.disparar(CONTA, USUARIO, CAMPANHA);

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
    prepararDisparo(m, [
      { id: 'd1', telefone: '5521999998888', variaveis: [] },
      { id: 'd2', telefone: '5521777776666', variaveis: [] },
      { id: 'd3', telefone: '5521555554444', variaveis: [] },
    ]);

    m.graph.enviarModelo
      .mockResolvedValueOnce('wamid.1')
      .mockRejectedValueOnce(
        new ErroGraph({ status: 400, codigo: 131026, traduzido: traduzirErroMeta(131026) }),
      )
      .mockResolvedValueOnce('wamid.3');

    await m.service.disparar(CONTA, USUARIO, CAMPANHA);

    // Parar no primeiro erro é o que faz uma campanha inteira morrer por causa
    // de um número inválido no meio da lista.
    expect(m.graph.enviarModelo).toHaveBeenCalledTimes(3);

    const falha = m.diario.find((e) => e.valores.status === 'falhou');
    expect(falha).toBeDefined();
    // O motivo REAL, não "deu erro": sem ele o suporte pede print em vez de
    // responder.
    expect(falha?.valores.erroCodigo).toBe(131026);
    expect(String(falha?.valores.erroDetalhe ?? '')).not.toHaveLength(0);
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

  it('recusa quando não há número pronto para enviar', async () => {
    const m = montar();
    m.db.select
      .mockReturnValueOnce(m.consulta([CAMPANHA_RASCUNHO]))
      .mockReturnValueOnce(m.consulta([])); // nenhum número registrado

    await expect(m.service.disparar(CONTA, USUARIO, CAMPANHA)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(m.graph.enviarModelo).not.toHaveBeenCalled();
  });
});
