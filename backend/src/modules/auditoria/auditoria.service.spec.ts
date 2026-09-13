/**
 * Testes de unidade do AuditoriaService, com um ContextoDb falso.
 *
 * O que está sendo travado aqui é o contrato que o resto do backend assume:
 * `registrar` PROPAGA a falha (a operação cai junto com a prova dela) e
 * `registrarForaDeContexto` NÃO propaga, mas deixa o motivo real no log. Se
 * alguém inverter isso um dia, um destes testes quebra.
 */
import { Logger } from '@nestjs/common';

// `config/env` é fail-fast no import: sem DATABASE_URL/JWT_SECRET o processo
// morre só de carregar o módulo, e a cadeia deste teste passa por ele
// (service -> ContextoDb -> DrizzleModule -> env). Como aqui nada toca banco,
// trocamos o env por um objeto vazio. O jest.mock sobe para antes dos imports.
jest.mock('../../config/env', () => ({ env: {} }));

import type { ContextoDb, Db } from '../../db/contexto';
import { AuditoriaService } from './auditoria.service';

type Valores = Record<string, unknown>;

interface Bancada {
  ctx: ContextoDb;
  /** Linhas que chegaram no insert. */
  inseridos: Valores[];
  /** Motivos passados para comEscopoSistema, na ordem. */
  escopos: string[];
}

function bancada(opcoes: { contaId?: string | null; falha?: Error } = {}): Bancada {
  const inseridos: Valores[] = [];
  const escopos: string[] = [];

  const db = {
    insert: () => ({
      values: (valores: Valores): Promise<void> => {
        if (opcoes.falha) return Promise.reject(opcoes.falha);
        inseridos.push(valores);
        return Promise.resolve();
      },
    }),
  } as unknown as Db;

  const ctx = {
    get db(): Db {
      return db;
    },
    get contaId(): string | null {
      return opcoes.contaId ?? null;
    },
    async comEscopoSistema<T>(motivo: string, fn: (db: Db) => Promise<T>): Promise<T> {
      escopos.push(motivo);
      return fn(db);
    },
  } as unknown as ContextoDb;

  return { ctx, inseridos, escopos };
}

const CONTA = '11111111-1111-4111-8111-111111111111';

describe('AuditoriaService', () => {
  let logErro: jest.SpyInstance;

  beforeEach(() => {
    logErro = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('registrar', () => {
    it('propaga a falha para derrubar a operação junto', async () => {
      const falha = Object.assign(new Error('insert falhou'), { code: '42501' });
      const { ctx } = bancada({ contaId: CONTA, falha });
      const service = new AuditoriaService(ctx);

      await expect(service.registrar({ acao: 'conta.criada' })).rejects.toThrow('insert falhou');
    });

    it('grava na transação corrente e herda a conta do contexto', async () => {
      const { ctx, inseridos } = bancada({ contaId: CONTA });
      const service = new AuditoriaService(ctx);

      await service.registrar({
        acao: 'usuario.login',
        atorUsuarioId: '22222222-2222-4222-8222-222222222222',
        entidade: 'usuario',
        entidadeId: '22222222-2222-4222-8222-222222222222',
        detalhe: { origem: 'web' },
      });

      expect(inseridos).toHaveLength(1);
      expect(inseridos[0]).toMatchObject({
        contaId: CONTA,
        atorTipo: 'usuario',
        acao: 'usuario.login',
        detalhe: { origem: 'web' },
      });
    });

    it('recusa auditar em conta diferente da do contexto', async () => {
      const { ctx, inseridos } = bancada({ contaId: CONTA });
      const service = new AuditoriaService(ctx);

      await expect(
        service.registrar({
          acao: 'conta.suspensa',
          contaId: '33333333-3333-4333-8333-333333333333',
        }),
      ).rejects.toThrow(/outra conta/i);
      expect(inseridos).toHaveLength(0);
    });

    it('descarta ip fora do formato em vez de perder o registro', async () => {
      const { ctx, inseridos } = bancada({ contaId: CONTA });
      const service = new AuditoriaService(ctx);

      await service.registrar({ acao: 'usuario.login', ip: 'desconhecido' });
      await service.registrar({ acao: 'usuario.login', ip: '203.0.113.7' });

      // A coluna é `inet`: texto inválido estouraria o insert inteiro.
      expect(inseridos[0]!.ip).toBeNull();
      expect(inseridos[1]!.ip).toBe('203.0.113.7');
    });
  });

  describe('registrarForaDeContexto', () => {
    it('não propaga a falha, mas loga o motivo real', async () => {
      const falha = Object.assign(new Error('conexão caiu'), {
        code: '08006',
        detail: 'server closed the connection',
      });
      const { ctx } = bancada({ falha });
      const service = new AuditoriaService(ctx);

      await expect(
        service.registrarForaDeContexto({
          acao: 'usuario.login_recusado',
          detalhe: { email: 'quem@exemplo.com' },
        }),
      ).resolves.toBeUndefined();

      expect(logErro).toHaveBeenCalledTimes(1);
      const mensagem = String(logErro.mock.calls[0]![0]);
      expect(mensagem).toContain('usuario.login_recusado');
      expect(mensagem).toContain('conexão caiu');
      expect(mensagem).toContain('08006');
      expect(mensagem).toContain('server closed the connection');
      // O detalhe carrega dado do cliente e nunca vai para o log.
      expect(mensagem).not.toContain('quem@exemplo.com');
    });

    it('abre escopo de sistema identificado e grava sem conta quando não há contexto', async () => {
      const { ctx, inseridos, escopos } = bancada();
      const service = new AuditoriaService(ctx);

      await service.registrarForaDeContexto({ acao: 'meta.webhook_recebido', atorTipo: 'sistema' });

      expect(escopos).toEqual(['auditoria']);
      expect(inseridos[0]).toMatchObject({ contaId: null, atorTipo: 'sistema' });
      expect(logErro).not.toHaveBeenCalled();
    });
  });

  it('grava detalhe vazio como objeto vazio, nunca null', async () => {
    const { ctx, inseridos } = bancada({ contaId: CONTA });
    const service = new AuditoriaService(ctx);

    await service.registrar({ acao: 'conta.criada' });
    await service.registrarForaDeContexto({ acao: 'conta.criada' });

    // A coluna é `jsonb not null`: null quebraria o insert.
    expect(inseridos[0]!.detalhe).toEqual({});
    expect(inseridos[1]!.detalhe).toEqual({});
  });
});
