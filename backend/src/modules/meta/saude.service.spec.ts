/**
 * A saúde da conta: quando pergunta à Meta, o que grava e quando barra o disparo.
 *
 * O que estes testes trancam é o que não dá para ver na tela:
 *
 *   1. a leitura guardada é reusada (a tela não pergunta à Meta a cada abertura);
 *   2. falha na Meta não grava nada e não derruba quem chamou;
 *   3. o disparo só é barrado com leitura FRESCA dizendo "bloqueado";
 *   4. o aviso no celular sai na virada para bloqueado, e não a cada leitura.
 *
 * O banco entra como dublê. Nada aqui toca Postgres nem rede.
 */
import { BadRequestException, Logger } from '@nestjs/common';

jest.mock('../../config/env', () => ({
  env: { meta: { tokenChave: Buffer.alloc(32, 7).toString('base64'), graphVersao: 'v23.0' }, push: { contaServico: '' } },
}));

import { waConta, waNumero } from '../../db/schema';
import { cifrarToken } from './cripto';
import { traduzirErroMeta } from './erros-meta';
import { ErroGraph } from './graph.service';
import { SaudeService } from './saude.service';

const CONTA = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'EAAG-token-do-cliente';
const DISPONIVEL = { can_send_message: 'AVAILABLE', entities: [{ entity_type: 'WABA', id: '1578', can_send_message: 'AVAILABLE' }] };
const BLOQUEADA = {
  can_send_message: 'BLOCKED',
  entities: [
    {
      entity_type: 'WABA',
      id: '1578',
      can_send_message: 'BLOCKED',
      errors: [{ error_code: 141006, error_description: 'Payment issue.', possible_solution: 'Add a payment method.' }],
    },
  ],
};
const NUMERO_OK = { can_send_message: 'AVAILABLE', entities: [{ entity_type: 'PHONE_NUMBER', id: 'PN1', can_send_message: 'AVAILABLE' }] };

function montar(conta: Record<string, unknown> = {}, numero: Record<string, unknown> = {}) {
  const linhaDaConta = {
    id: 'wa-1',
    contaId: CONTA,
    wabaId: '1578000000000001',
    businessId: '3237000000000001',
    tokenCifrado: cifrarToken(TOKEN, Buffer.alloc(32, 7).toString('base64')),
    tokenExpiraEm: null,
    moeda: null,
    fuso: null,
    pagamentoId: null,
    saudeEstado: null,
    saude: null,
    saudeEm: null,
    ...conta,
  } as Record<string, unknown>;
  const linhaDoNumero = { id: 'num-1', phoneNumberId: 'PN1', telefone: '+5521999990000', status: 'registrado', saudeEstado: null, saude: null, ...numero } as Record<
    string,
    unknown
  >;
  const gravados: Array<{ tabela: unknown; valores: Record<string, unknown> }> = [];

  // Encadeamento mínimo do Drizzle. O `select` devolve a linha de agora — e o
  // `update` a altera, para a releitura depois de gravar enxergar o que mudou.
  const db = {
    select: () => {
      const cadeia: Record<string, unknown> = {};
      let tabela: unknown;
      cadeia.from = (t: unknown) => {
        tabela = t;
        return cadeia;
      };
      for (const m of ['where', 'orderBy', 'limit']) cadeia[m] = () => cadeia;
      cadeia.then = (r: (v: unknown[]) => void) => r(tabela === waConta ? [linhaDaConta] : [linhaDoNumero]);
      return cadeia;
    },
    update: (tabela: unknown) => {
      const cadeia: Record<string, unknown> = {};
      cadeia.set = (valores: Record<string, unknown>) => {
        gravados.push({ tabela, valores });
        Object.assign(tabela === waConta ? linhaDaConta : linhaDoNumero, valores);
        return cadeia;
      };
      cadeia.where = () => cadeia;
      cadeia.then = (r: (v: unknown[]) => void) => r([]);
      return cadeia;
    },
  };

  // `comConta` abre uma transação à parte — aqui só conta quantas foram abertas.
  const proprias: string[] = [];
  const ctx = {
    db,
    comEscopoSistema: <T>(_m: string, fn: (d: typeof db) => Promise<T>) => fn(db),
    comConta: <T>(contaId: string, fn: (d: typeof db) => Promise<T>) => {
      proprias.push(contaId);
      return fn(db);
    },
  };
  const graph = {
    saudeDe: jest.fn((no: string) => Promise.resolve(no === 'PN1' ? NUMERO_OK : DISPONIVEL)),
    cobrancaDaWaba: jest.fn().mockResolvedValue({ currency: 'BRL', timezone_id: '25', primary_funding_id: '2056000000000001', business_verification_status: 'verified' }),
  };
  const avisos = { avisar: jest.fn().mockResolvedValue(undefined) };
  const service = new SaudeService(ctx as never, graph as never, avisos as never);

  const daConta = () => gravados.filter((g) => g.tabela === waConta).map((g) => g.valores);
  const doNumero = () => gravados.filter((g) => g.tabela === waNumero).map((g) => g.valores);
  return { service, graph, avisos, gravados, daConta, doNumero, linhaDaConta, proprias };
}

const haMinutos = (n: number) => new Date(Date.now() - n * 60_000);
/** Os campos da cobrança, na ordem em que são pedidos. */
const CAMPOS = ['currency', 'timezone_id', 'primary_funding_id', 'business_verification_status'];
const guardada = { entidades: [{ tipo: 'conta', id: '1578', estado: 'disponivel', erros: [], info: [] }], cobrancaLida: true };

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe('a tela — GET /whatsapp/saude', () => {
  it('nunca lida: pergunta à Meta (conta, cobrança e número), grava e devolve o sinal', async () => {
    const m = montar();
    const s = await m.service.daConta(CONTA);

    expect(m.graph.saudeDe).toHaveBeenCalledWith('1578000000000001', TOKEN);
    expect(m.graph.saudeDe).toHaveBeenCalledWith('PN1', TOKEN);
    expect(m.graph.cobrancaDaWaba).toHaveBeenCalledTimes(1);
    expect(m.graph.cobrancaDaWaba).toHaveBeenCalledWith('1578000000000001', TOKEN, CAMPOS);
    expect(m.daConta()[0]).toMatchObject({
      saudeEstado: 'disponivel',
      moeda: 'BRL',
      fuso: '25',
      pagamentoId: '2056000000000001',
      verificacaoNegocio: 'verified',
    });
    expect(m.daConta()[0]!.saude).toMatchObject({ cobrancaLidos: CAMPOS, cobrancaRecusada: [], cobrancaRecusadaEm: null });
    expect(m.doNumero()[0]).toMatchObject({ saudeEstado: 'disponivel' });
    expect('sinal' in s && s.sinal).toBe('pode_enviar');
  });

  it('lida há 3 minutos: usa o que está guardado, sem chamar a Meta', async () => {
    const m = montar({ saudeEstado: 'disponivel', saude: guardada, saudeEm: haMinutos(3), moeda: 'BRL', pagamentoId: '9' });
    const s = await m.service.daConta(CONTA);

    expect(m.graph.saudeDe).not.toHaveBeenCalled();
    expect(m.gravados).toHaveLength(0);
    expect('sinal' in s && s.sinal).toBe('pode_enviar');
  });

  it('lida há 15 minutos: relê', async () => {
    const m = montar({ saudeEstado: 'disponivel', saude: guardada, saudeEm: haMinutos(15) });
    await m.service.daConta(CONTA);
    expect(m.graph.saudeDe).toHaveBeenCalled();
  });

  it('"Conferir agora" relê mesmo recente — mas não duas vezes em 20 segundos', async () => {
    const recente = montar({ saudeEstado: 'disponivel', saude: guardada, saudeEm: haMinutos(3) });
    await recente.service.daConta(CONTA, { atualizar: true });
    expect(recente.graph.saudeDe).toHaveBeenCalled();

    const agorinha = montar({ saudeEstado: 'disponivel', saude: guardada, saudeEm: new Date(Date.now() - 5_000) });
    await agorinha.service.daConta(CONTA, { atualizar: true });
    expect(agorinha.graph.saudeDe).not.toHaveBeenCalled();
  });

  it('a Meta fora do ar: a leitura não muda, a falha fica anotada e a tela diz que a Meta não respondeu', async () => {
    const m = montar();
    m.graph.saudeDe.mockRejectedValue(new Error('tempo esgotado'));
    const s = await m.service.daConta(CONTA);

    // Só a anotação da falha: nem veredito, nem "lida em".
    expect(m.daConta()).toHaveLength(1);
    expect(Object.keys(m.daConta()[0]!)).toEqual(['saude']);
    expect(m.daConta()[0]!.saude).toMatchObject({ entidades: [], ultimaFalha: { codigo: null } });
    expect('sinal' in s && s.sinal).toBe('desconhecido');
    expect('resumo' in s && s.resumo).toMatch(/^A Meta não respondeu à última conferência\./);
  });

  it('a Meta recusa a autorização (190): a tela diz que a conexão caiu, em vez de "ainda não conferimos"', async () => {
    const m = montar();
    m.graph.saudeDe.mockRejectedValue(new ErroGraph({ status: 401, codigo: 190, traduzido: traduzirErroMeta(190) }));
    const s = await m.service.daConta(CONTA);

    expect(m.daConta()[0]!.saude).toMatchObject({ ultimaFalha: { codigo: 190 } });
    expect('sinal' in s && s.sinal).toBe('bloqueado');
    expect('itens' in s && s.itens[0]).toMatchObject({ chave: 'conexao', problemas: [expect.objectContaining({ titulo: 'A conexão com a Meta caiu' })] });
    // A frase da Meta e o token não vão para o banco nem para a tela.
    expect(JSON.stringify([m.daConta(), s])).not.toMatch(/validating|access token|EAAG/i);
  });

  it('a falha anotada não apaga a última leitura boa, e some na leitura boa seguinte', async () => {
    const m = montar({ saudeEstado: 'disponivel', saude: guardada, saudeEm: haMinutos(15), moeda: 'BRL' });
    m.graph.saudeDe.mockRejectedValueOnce(new Error('tempo esgotado'));
    await m.service.daConta(CONTA);
    expect(m.linhaDaConta.saudeEstado).toBe('disponivel');
    expect(m.linhaDaConta.saude).toMatchObject({ entidades: guardada.entidades, ultimaFalha: { codigo: null } });

    await m.service.daConta(CONTA);
    expect(m.linhaDaConta.saude).not.toHaveProperty('ultimaFalha');
  });

  it('resposta que não é uma saúde: nada é gravado', async () => {
    const m = montar();
    m.graph.saudeDe.mockResolvedValue({ can_send_message: 'TALVEZ' } as never);
    await m.service.daConta(CONTA);
    expect(m.gravados).toHaveLength(0);
  });

  it('a cobrança recusada pela Meta não esconde a saúde: grava o veredito e mantém a moeda que já tinha', async () => {
    const m = montar({ moeda: 'BRL' });
    m.graph.cobrancaDaWaba.mockRejectedValue(new Error('campo recusado'));
    const s = await m.service.daConta(CONTA);

    expect(m.daConta()[0]).toMatchObject({ saudeEstado: 'disponivel' });
    expect('moeda' in m.daConta()[0]!).toBe(false);
    // Sem cobrança lida, o item do pagamento não aparece: nada é afirmado.
    expect('itens' in s && s.itens.some((i) => i.chave === 'pagamento')).toBe(false);
  });

  it('a Meta recusa a cobrança INTEIRA por causa de um campo: lê um de cada vez e guarda o que deu', async () => {
    // Foi a primeira leitura real (02/10/2026): a chamada com os quatro campos
    // foi recusada, e a tela ficou sem a moeda por causa de um campo que nem era ela.
    const m = montar();
    m.graph.cobrancaDaWaba.mockImplementation((_waba: string, _token: string, campos: readonly string[]) =>
      campos.includes('primary_funding_id')
        ? Promise.reject(new ErroGraph({ status: 400, codigo: 100, traduzido: traduzirErroMeta(100) }))
        : Promise.resolve({ currency: 'BRL', timezone_id: '25', business_verification_status: 'verified' }),
    );
    const s = await m.service.daConta(CONTA);

    // Os quatro juntos, e depois um de cada vez.
    expect(m.graph.cobrancaDaWaba.mock.calls.map((c) => c[2])).toEqual([CAMPOS, ['currency'], ['timezone_id'], ['primary_funding_id'], ['business_verification_status']]);
    expect(m.daConta()[0]).toMatchObject({ moeda: 'BRL', fuso: '25', verificacaoNegocio: 'verified' });
    // O campo recusado não é gravado como "vazio".
    expect('pagamentoId' in m.daConta()[0]!).toBe(false);
    expect(m.daConta()[0]!.saude).toMatchObject({
      cobrancaLidos: ['currency', 'timezone_id', 'business_verification_status'],
      cobrancaRecusada: [{ campo: 'primary_funding_id', codigo: 100 }],
    });
    // E a tela diz só o que sabe: a moeda, sem alarme sobre a forma de pagamento.
    expect('itens' in s && s.itens.find((i) => i.chave === 'pagamento')).toMatchObject({ sinal: 'pode_enviar', resumo: 'Cobrança em BRL.' });
  });

  it('campo recusado há pouco não é pedido de novo: uma chamada só, com os outros', async () => {
    const recusadaEm = haMinutos(40).toISOString();
    const m = montar({
      saudeEstado: 'disponivel',
      saudeEm: haMinutos(40),
      moeda: 'BRL',
      saude: { entidades: [], cobrancaLidos: ['currency'], cobrancaRecusada: [{ campo: 'primary_funding_id', codigo: 100 }], cobrancaRecusadaEm: recusadaEm },
    });
    await m.service.daConta(CONTA);

    expect(m.graph.cobrancaDaWaba).toHaveBeenCalledTimes(1);
    expect(m.graph.cobrancaDaWaba.mock.calls[0]![2]).toEqual(['currency', 'timezone_id', 'business_verification_status']);
    // A recusa de antes continua anotada, com a data dela.
    expect(m.daConta()[0]!.saude).toMatchObject({
      cobrancaRecusada: [{ campo: 'primary_funding_id', codigo: 100 }],
      cobrancaRecusadaEm: recusadaEm,
    });
  });

  it('no dia seguinte, o campo recusado volta a ser pedido', async () => {
    const m = montar({
      saudeEstado: 'disponivel',
      saudeEm: haMinutos(40),
      saude: { entidades: [], cobrancaLidos: ['currency'], cobrancaRecusada: [{ campo: 'primary_funding_id', codigo: 100 }], cobrancaRecusadaEm: haMinutos(25 * 60).toISOString() },
    });
    await m.service.daConta(CONTA);

    expect(m.graph.cobrancaDaWaba.mock.calls[0]![2]).toEqual(CAMPOS);
    expect(m.daConta()[0]!.saude).toMatchObject({ cobrancaLidos: CAMPOS, cobrancaRecusada: [] });
  });

  it('rede caída na cobrança: não tenta campo a campo, e o que se sabia continua valendo', async () => {
    const m = montar({ saudeEstado: 'disponivel', saudeEm: haMinutos(40), moeda: 'BRL', pagamentoId: '9', saude: { entidades: [], cobrancaLidos: [...CAMPOS], cobrancaRecusada: [] } });
    m.graph.cobrancaDaWaba.mockRejectedValue(new ErroGraph({ status: 0, codigo: null, traduzido: traduzirErroMeta(null) }));
    const s = await m.service.daConta(CONTA);

    expect(m.graph.cobrancaDaWaba).toHaveBeenCalledTimes(1);
    expect(m.daConta()[0]!.saude).toMatchObject({ cobrancaLidos: CAMPOS });
    expect('moeda' in m.daConta()[0]!).toBe(false);
    expect('itens' in s && s.itens.find((i) => i.chave === 'pagamento')).toMatchObject({ sinal: 'pode_enviar' });
  });

  it('o token nunca aparece no que a tela recebe', async () => {
    const m = montar();
    expect(JSON.stringify(await m.service.daConta(CONTA))).not.toContain(TOKEN);
  });
});

describe('o aviso no celular', () => {
  it('sai quando a conta VIRA bloqueada', async () => {
    const m = montar({ saudeEstado: 'disponivel', saude: guardada, saudeEm: haMinutos(40) });
    m.graph.saudeDe.mockImplementation((no: string) => Promise.resolve(no === 'PN1' ? NUMERO_OK : BLOQUEADA));
    await m.service.daConta(CONTA);

    expect(m.avisos.avisar).toHaveBeenCalledTimes(1);
    expect(m.avisos.avisar).toHaveBeenCalledWith(CONTA, 'campanhas', expect.objectContaining({ titulo: 'Sua conta não pode enviar agora' }));
  });

  it('não sai de novo enquanto ela CONTINUA bloqueada', async () => {
    const m = montar({ saudeEstado: 'bloqueado', saude: guardada, saudeEm: haMinutos(40) });
    m.graph.saudeDe.mockImplementation((no: string) => Promise.resolve(no === 'PN1' ? NUMERO_OK : BLOQUEADA));
    await m.service.daConta(CONTA);
    expect(m.avisos.avisar).not.toHaveBeenCalled();
  });

  it('nem quando está tudo em ordem', async () => {
    const m = montar();
    await m.service.daConta(CONTA);
    expect(m.avisos.avisar).not.toHaveBeenCalled();
  });
});

describe('antes de disparar', () => {
  it('a Meta diz AGORA que a conta está bloqueada: recusa, com o motivo e onde ver', async () => {
    const m = montar();
    m.graph.saudeDe.mockImplementation((no: string) => Promise.resolve(no === 'PN1' ? NUMERO_OK : BLOQUEADA));

    await expect(m.service.conferirAntesDeEnviar(CONTA)).rejects.toThrow(BadRequestException);
    await expect(montarBloqueada().service.conferirAntesDeEnviar(CONTA)).rejects.toThrow(
      /^Não dá para enviar agora\. A Meta bloqueou o envio por um problema da conta do WhatsApp\..*Os detalhes estão em WhatsApp, no menu\.$/,
    );
  });

  it('tudo em ordem: segue', async () => {
    await expect(montar().service.conferirAntesDeEnviar(CONTA)).resolves.toBeUndefined();
  });

  it('a leitura do disparo é gravada em transação própria — a recusa desfaz a do pedido, e a leitura tem de ficar', async () => {
    // Na bateria de ponta a ponta (01/10/2026): gravada na transação do pedido,
    // a leitura sumia com a recusa — a tela ficava com o estado velho e o aviso
    // de "bloqueou agora" saía de novo a cada tentativa de disparo.
    const m = montarBloqueada();
    await expect(m.service.conferirAntesDeEnviar(CONTA)).rejects.toThrow(BadRequestException);
    expect(m.proprias).toEqual([CONTA]);
    expect(m.daConta()[0]).toMatchObject({ saudeEstado: 'bloqueado' });
  });

  it('a tela grava na transação do próprio pedido (que não é desfeita)', async () => {
    const m = montar();
    await m.service.daConta(CONTA);
    expect(m.proprias).toEqual([]);
  });

  it('a Meta não respondeu: segue — bloqueio guardado de ontem não barra o disparo de hoje', async () => {
    const m = montar({ saudeEstado: 'bloqueado', saude: { entidades: [{ tipo: 'conta', id: '1', estado: 'bloqueado', erros: [], info: [] }], cobrancaLida: false }, saudeEm: haMinutos(600) });
    m.graph.saudeDe.mockRejectedValue(new Error('tempo esgotado'));
    await expect(m.service.conferirAntesDeEnviar(CONTA)).resolves.toBeUndefined();
  });

  it('leitura de 1 minuto atrás serve: não pergunta de novo', async () => {
    const m = montar({ saudeEstado: 'disponivel', saude: guardada, saudeEm: haMinutos(1) });
    await m.service.conferirAntesDeEnviar(CONTA);
    expect(m.graph.saudeDe).not.toHaveBeenCalled();
  });

  it('pagamento a conferir é aviso nosso: não barra', async () => {
    const m = montar();
    m.graph.cobrancaDaWaba.mockResolvedValue({});
    await expect(m.service.conferirAntesDeEnviar(CONTA)).resolves.toBeUndefined();
  });

  function montarBloqueada() {
    const m = montar();
    m.graph.saudeDe.mockImplementation((no: string) => Promise.resolve(no === 'PN1' ? NUMERO_OK : BLOQUEADA));
    return m;
  }
});

describe('pelo sistema — a rotina e o aviso de mudança na conta', () => {
  it('lê e grava pela chave mestra', async () => {
    const m = montar();
    await expect(m.service.atualizarDoSistema({ wabaId: '1578000000000001' })).resolves.toEqual({ leu: true, credencial: false });
    expect(m.daConta()[0]).toMatchObject({ saudeEstado: 'disponivel' });
  });

  it('autorização vencida: diz que a credencial caiu, para a rotina não insistir', async () => {
    const m = montar();
    m.graph.saudeDe.mockRejectedValue(new ErroGraph({ status: 401, codigo: 190, traduzido: traduzirErroMeta(190) }));
    await expect(m.service.atualizarDoSistema({ waContaId: 'wa-1' })).resolves.toEqual({ leu: false, credencial: true });
    // Nada da leitura é gravado — só a anotação da falha, com o código.
    expect(m.gravados).toHaveLength(1);
    expect(Object.keys(m.daConta()[0]!)).toEqual(['saude']);
    expect(m.daConta()[0]!.saude).toMatchObject({ ultimaFalha: { codigo: 190 } });
  });

  it('conta sem token: nem tenta', async () => {
    const m = montar({ tokenCifrado: null });
    await expect(m.service.atualizarDoSistema({ waContaId: 'wa-1' })).resolves.toEqual({ leu: false, credencial: false });
    expect(m.graph.saudeDe).not.toHaveBeenCalled();
  });
});
