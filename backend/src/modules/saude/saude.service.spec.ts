/**
 * Testes das rotas de saúde.
 *
 * O que eles travam é UMA regra: o corpo que sai para a internet não conta
 * nada sobre a infraestrutura. Com o Redis fora, a resposta pública diz
 * `redis: "falhou"` e para por aí; `connect ECONNREFUSED 10.0.0.5:6379` — host,
 * porta e um pedaço da topologia — só aparece no log e na rota que exige o
 * token do console de distribuição.
 *
 * Por isso as asserções são NEGATIVAS (`not.toContain`) sobre o JSON inteiro:
 * um campo novo com o motivo dentro, acrescentado sem pensar daqui a seis
 * meses, reprova aqui em vez de vazar em produção.
 *
 * Os dois `jest.mock` do topo existem porque `config/env` é fail-fast (derruba
 * a suíte por falta de DATABASE_URL) e porque abrir socket de Redis em teste
 * unitário é esperar 3 segundos por nada.
 */
jest.mock('../../config/env', () => ({
  env: { producao: false, redis: { url: 'redis://localhost:6379' } },
}));

const mockPing = jest.fn<Promise<string>, []>();

jest.mock('ioredis', () => ({
  __esModule: true,
  default: class RedisFalso {
    on(): this {
      return this;
    }
    disconnect(): void {
      /* nada a fechar no dublê */
    }
    ping(): Promise<string> {
      return mockPing();
    }
  },
}));

import { HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { Pool } from 'pg';

import { SaudeController } from './saude.controller';
import { SaudeService } from './saude.service';

/** O erro que o driver realmente devolve — com host e porta dentro. */
const HOST_INTERNO = '10.0.0.5';
function erroDeConexao(porta: number): Error {
  const erro = new Error(`connect ECONNREFUSED ${HOST_INTERNO}:${porta}`) as Error & {
    code?: string;
  };
  erro.code = 'ECONNREFUSED';
  return erro;
}

function montar(opcoes: { pgFalha?: Error; redisFalha?: Error } = {}) {
  const query = jest.fn(() =>
    opcoes.pgFalha ? Promise.reject(opcoes.pgFalha) : Promise.resolve({ rows: [{}] }),
  );
  mockPing.mockReset();
  mockPing.mockImplementation(() =>
    opcoes.redisFalha ? Promise.reject(opcoes.redisFalha) : Promise.resolve('PONG'),
  );

  const servico = new SaudeService({ query } as unknown as Pool);
  const controller = new SaudeController(servico);
  return { servico, controller };
}

/** Dublê do `Response`: só precisa guardar o status que o handler escolheu. */
function resposta(): Response & { statusEscolhido: number | null } {
  const res = {
    statusEscolhido: null as number | null,
    status(codigo: number) {
      res.statusEscolhido = codigo;
      return res;
    },
  };
  return res as unknown as Response & { statusEscolhido: number | null };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ------------------------------------------------------------------ liveness

describe('liveness público', () => {
  it('não conta qual versão está no ar', () => {
    const { controller } = montar();

    const corpo = controller.vivo();

    // A versão diz qual release está rodando — e, por tabela, quais correções
    // ainda NÃO estão. Quem precisa dela usa a rota com token.
    expect(Object.keys(corpo).sort()).toEqual(['ok', 'tempoDeVidaSeg']);
    expect(JSON.stringify(corpo)).not.toMatch(/versao|version/i);
  });
});

// ----------------------------------------------------------------- readiness

describe('readiness público', () => {
  it('tudo de pé: 200 e só o veredito de cada dependência', async () => {
    const { controller } = montar();
    const res = resposta();

    const corpo = await controller.pronto(res);

    expect(res.statusEscolhido).toBe(HttpStatus.OK);
    expect(corpo).toEqual({ postgres: 'ok', redis: 'ok' });
  });

  it('Redis fora: 503 sem host, porta nem mensagem do driver no corpo', async () => {
    const { controller } = montar({ redisFalha: erroDeConexao(6379) });
    const res = resposta();

    const corpo = await controller.pronto(res);

    expect(res.statusEscolhido).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(corpo).toEqual({ postgres: 'ok', redis: 'falhou' });

    // O ponto do teste: nada do diagnóstico atravessa para o corpo público.
    const texto = JSON.stringify(corpo);
    expect(texto).not.toContain(HOST_INTERNO);
    expect(texto).not.toContain('6379');
    expect(texto).not.toContain('ECONNREFUSED');
    expect(texto).not.toContain('motivos');
  });

  it('Postgres fora: 503 sem o SQLSTATE nem o detalhe no corpo', async () => {
    const { controller } = montar({ pgFalha: erroDeConexao(5432) });
    const res = resposta();

    const corpo = await controller.pronto(res);

    expect(res.statusEscolhido).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(corpo).toEqual({ postgres: 'falhou', redis: 'ok' });
    expect(JSON.stringify(corpo)).not.toContain('5432');
  });

  it('o motivo real vai para o log — ele é o destino garantido agora', async () => {
    const erro = jest.spyOn(Logger.prototype, 'error');
    const { controller } = montar({ redisFalha: erroDeConexao(6379) });

    await controller.pronto(resposta());

    expect(erro).toHaveBeenCalledTimes(1);
    const linha = String(erro.mock.calls[0][0]);
    expect(linha).toContain('ECONNREFUSED');
    expect(linha).toContain(HOST_INTERNO);
  });
});

// -------------------------------------------------- readiness com o token

describe('readiness detalhado (console de distribuição)', () => {
  it('devolve o motivo real, a versão e o mesmo status da sonda pública', async () => {
    const { controller } = montar({ redisFalha: erroDeConexao(6379) });
    const res = resposta();

    const corpo = await controller.prontoDetalhe(res);

    expect(res.statusEscolhido).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(corpo.redis).toBe('falhou');
    expect(corpo.motivos?.redis).toContain('ECONNREFUSED');
    expect(corpo.motivos?.redis).toContain(HOST_INTERNO);
    expect(typeof corpo.versao).toBe('string');
  });

  it('com tudo de pé não inventa motivo nenhum', async () => {
    const { controller } = montar();
    const res = resposta();

    const corpo = await controller.prontoDetalhe(res);

    expect(res.statusEscolhido).toBe(HttpStatus.OK);
    expect(corpo.motivos).toBeUndefined();
  });

  it('as duas rotas leem a MESMA checagem, então nunca discordam', async () => {
    const { servico } = montar({ pgFalha: erroDeConexao(5432) });

    const { publico, detalhado } = await servico.pronto();

    expect(detalhado.postgres).toBe(publico.postgres);
    expect(detalhado.redis).toBe(publico.redis);
  });
});
