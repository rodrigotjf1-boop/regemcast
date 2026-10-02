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
import { autorDaIntegracao, comAutorDaIntegracao } from './autor-integracao';

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

  describe('o autor "integração" (porta MCP)', () => {
    const LIAME = { tokenId: '44444444-4444-4444-8444-444444444444', produto: 'liame', nome: 'Liame — piloto', classe: 'dms' };

    it('o que o serviço registra como usuário, sem dizer qual, sai como integração — com o nome do token', async () => {
      const { ctx, inseridos } = bancada({ contaId: CONTA });
      const service = new AuditoriaService(ctx);

      await comAutorDaIntegracao(LIAME, () =>
        service.registrar({ atorTipo: 'usuario', atorUsuarioId: null, acao: 'campanha.criada', detalhe: { nome: 'Promo' } }),
      );

      expect(inseridos[0]).toMatchObject({
        contaId: CONTA,
        atorTipo: 'integracao',
        atorUsuarioId: null,
        atorNome: 'Liame — piloto (liame)',
        acao: 'campanha.criada',
        detalhe: { nome: 'Promo', integracao: { produto: 'liame', classe: 'dms', tokenId: LIAME.tokenId } },
      });
    });

    it('vale também para quem nem informa o tipo de autor', async () => {
      const { ctx, inseridos } = bancada({ contaId: CONTA });
      await comAutorDaIntegracao(LIAME, () => new AuditoriaService(ctx).registrar({ acao: 'modelo.rascunho.criado' }));
      expect(inseridos[0]).toMatchObject({ atorTipo: 'integracao', atorNome: 'Liame — piloto (liame)' });
    });

    it('o token nunca vai para a trilha: só o id dele', async () => {
      const { ctx, inseridos } = bancada({ contaId: CONTA });
      await comAutorDaIntegracao(LIAME, () => new AuditoriaService(ctx).registrar({ acao: 'campanha.criada' }));
      expect(JSON.stringify(inseridos[0])).not.toMatch(/rct_it_/);
    });

    it('registro que já tem uma pessoa, ou é do sistema ou da distribuição, fica como veio', async () => {
      const { ctx, inseridos } = bancada({ contaId: CONTA });
      const service = new AuditoriaService(ctx);

      await comAutorDaIntegracao(LIAME, async () => {
        await service.registrar({ acao: 'usuario.login', atorUsuarioId: '22222222-2222-4222-8222-222222222222' });
        await service.registrar({ acao: 'campanha.pausada', atorTipo: 'sistema' });
        await service.registrar({ acao: 'integracao.token_revogado', atorTipo: 'distribuicao' });
      });

      expect(inseridos.map((i) => i.atorTipo)).toEqual(['usuario', 'sistema', 'distribuicao']);
      expect(inseridos.every((i) => !('atorNome' in i) && !('integracao' in (i.detalhe as object)))).toBe(true);
    });

    it('fora de uma ferramenta do MCP nada muda', async () => {
      const { ctx, inseridos } = bancada({ contaId: CONTA });
      await new AuditoriaService(ctx).registrar({ acao: 'campanha.criada', detalhe: { nome: 'Promo' } });
      expect(inseridos[0]).toMatchObject({ atorTipo: 'usuario', detalhe: { nome: 'Promo' } });
      expect(inseridos[0]).not.toHaveProperty('atorNome');
    });

    it('o autor vive só durante a chamada, e não vaza de um pedido para outro ao mesmo tempo', async () => {
      const REGEM = { ...LIAME, produto: 'regem', nome: 'Regem' };
      const vistos = await Promise.all([
        comAutorDaIntegracao(LIAME, async () => {
          await new Promise((r) => setTimeout(r, 15));
          return autorDaIntegracao()?.produto;
        }),
        comAutorDaIntegracao(REGEM, async () => autorDaIntegracao()?.produto),
      ]);
      expect(vistos).toEqual(['liame', 'regem']);
      expect(autorDaIntegracao()).toBeNull();
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
