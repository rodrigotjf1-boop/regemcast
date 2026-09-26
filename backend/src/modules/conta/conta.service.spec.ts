/**
 * Testes do ContaService.
 *
 * O banco entra como dublê: o que está sob teste aqui são as REGRAS que não
 * podem depender de sorte — fuso inválido barrado antes de gravar, dono que
 * não pode ser suspenso e ninguém se trancando para fora da própria conta.
 * Cada uma delas, se falhar, só aparece em produção e cara: fuso torto quebra
 * a janela de envio meses depois, e conta sem dono ativo não tem quem reative
 * ninguém.
 */
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

// `config/env` é fail-fast no import: sem DATABASE_URL o módulo derruba o
// processo só de ser carregado, e a cadeia deste teste passa por ele
// (service -> ContextoDb -> DrizzleModule -> env). Aqui nada toca banco, então
// o env vira objeto vazio. O jest.mock sobe para antes dos imports.
jest.mock('../../config/env', () => ({ env: {} }));

import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { ContaService } from './conta.service';

const CONTA = '11111111-1111-4111-8111-111111111111';
const DONO = '22222222-2222-4222-8222-222222222222';
const OPERADOR = '33333333-3333-4333-8333-333333333333';

const dono: UsuarioAutenticado = {
  id: DONO,
  contaId: CONTA,
  nome: 'Rodrigo',
  email: 'dono@empresa.com.br',
  papel: 'dono',
  escopo: 'web',
};

/**
 * Encadeamento mínimo do query builder do Drizzle: todo método devolve o
 * próprio objeto e o objeto é "thenable", então `await db.select().from(x)`
 * resolve na lista combinada para o teste.
 */
type Encadeavel = Record<string, unknown>;

function consulta(linhas: unknown[]): Encadeavel {
  const alvo: Encadeavel = {};
  for (const metodo of [
    'from',
    'leftJoin',
    'innerJoin',
    'where',
    'orderBy',
    'limit',
    'set',
    'values',
    'returning',
  ]) {
    alvo[metodo] = () => alvo;
  }
  alvo.then = (resolver: (v: unknown[]) => void) => resolver(linhas);
  return alvo;
}

/** Mesmo encadeamento, mas o await estoura — para simular falha do Postgres. */
function consultaQueFalha(erro: unknown): Encadeavel {
  const alvo = consulta([]);
  alvo.then = (_resolver: unknown, rejeitar: (e: unknown) => void) => rejeitar(erro);
  return alvo;
}

function montar() {
  const db = {
    select: jest.fn(() => consulta([])),
    update: jest.fn(() => consulta([])),
    insert: jest.fn(() => consulta([])),
    delete: jest.fn(() => consulta([])),
    execute: jest.fn().mockResolvedValue({ rows: [] }),
  };

  const registrar = jest.fn().mockResolvedValue(undefined);
  const auditoria = { registrar, registrarForaDeContexto: jest.fn() };

  // Fica como jest.fn para os testes poderem afirmar que NINGUÉM abre uma
  // segunda transação no meio da transação do request.
  const comEscopoSistema = jest.fn((_motivo: string, fn: (d: unknown) => Promise<unknown>) =>
    fn(db),
  );

  const ctx = {
    db,
    contaObrigatoria: () => CONTA,
    contaId: CONTA,
    comEscopoSistema,
  };

  const service = new ContaService(
    ctx as unknown as ConstructorParameters<typeof ContaService>[0],
    auditoria as unknown as ConstructorParameters<typeof ContaService>[1],
  );

  return { service, db, registrar, comEscopoSistema };
}

const LINHA_RESUMO = {
  id: CONTA,
  nome: 'Padaria Aurora',
  cnpj: null,
  timezone: 'America/Sao_Paulo',
  status: 'ativa',
  assinaturaStatus: 'cortesia',
  cicloInicio: new Date('2026-09-01T00:00:00.000Z'),
  cicloFim: new Date('2026-10-01T00:00:00.000Z'),
  gratisAte: new Date('2026-10-01T00:00:00.000Z'),
  disparos: 120,
  planoCodigo: 'cortesia',
  planoNome: 'Primeiro mês',
  planoDisparosMes: 5000,
};

describe('ContaService', () => {
  describe('resumo', () => {
    it('lê o plano na transação do request, sem abrir contexto novo', async () => {
      const { service, db, comEscopoSistema } = montar();
      db.select.mockReturnValueOnce(consulta([LINHA_RESUMO]));

      const resumo = await service.resumo();

      expect(resumo.plano).toEqual({
        codigo: 'cortesia',
        nome: 'Primeiro mês',
        disparosMes: 5000,
      });
      expect(resumo.uso).toEqual({ disparos: 120, teto: 5000, restantes: 4880 });
      // O defeito que este teste tranca: ler o catálogo com comEscopoSistema
      // abria uma SEGUNDA transação — e portanto pegava uma segunda conexão do
      // pool — enquanto a transação do request segurava a primeira. Com dez
      // requests simultâneos e poolMax 10, o pool inteiro travava.
      expect(comEscopoSistema).not.toHaveBeenCalled();
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it('devolve plano e teto nulos quando a conta ainda não tem plano', async () => {
      const { service, db } = montar();
      db.select.mockReturnValueOnce(
        consulta([
          { ...LINHA_RESUMO, planoCodigo: null, planoNome: null, planoDisparosMes: null },
        ]),
      );

      const resumo = await service.resumo();

      expect(resumo.plano).toBeNull();
      expect(resumo.uso).toEqual({ disparos: 120, teto: null, restantes: null });
    });

    it('responde 404 quando a conta do contexto não existe mais', async () => {
      const { service } = montar();

      await expect(service.resumo()).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('atualizar', () => {
    it('recusa fuso horário desconhecido antes de encostar no banco', async () => {
      const { service, db, registrar } = montar();

      await expect(
        service.atualizar({ timezone: 'Marte/Olimpo' }, dono),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(db.select).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
      expect(registrar).not.toHaveBeenCalled();
    });

    it('aceita fuso IANA válido, grava e audita', async () => {
      const { service, db, registrar } = montar();
      db.select.mockReturnValueOnce(
        consulta([{ nome: 'Padaria', cnpj: null, timezone: 'America/Sao_Paulo' }]),
      );
      db.update.mockReturnValueOnce(
        consulta([
          {
            id: CONTA,
            nome: 'Padaria',
            cnpj: null,
            timezone: 'America/Manaus',
            status: 'ativa',
          },
        ]),
      );

      const atualizada = await service.atualizar({ timezone: 'America/Manaus' }, dono);

      expect(atualizada.timezone).toBe('America/Manaus');
      expect(registrar).toHaveBeenCalledTimes(1);
      expect(registrar.mock.calls[0][0]).toMatchObject({ acao: 'conta.atualizada' });
      // Outro fuso, outra hora local das compras: o período de cada contato é refeito.
      expect(db.execute).toHaveBeenCalledTimes(1);
      const refeito = new PgDialect().sqlToQuery(db.execute.mock.calls[0][0] as SQL);
      expect(refeito.sql).toContain('set periodo_preferido');
      expect(refeito.params).toContain(CONTA);
    });

    it('sem troca de fuso, o período dos contatos fica como está', async () => {
      const { service, db } = montar();
      db.select.mockReturnValueOnce(consulta([{ nome: 'Padaria', cnpj: null, timezone: 'America/Sao_Paulo' }]));
      db.update.mockReturnValueOnce(
        consulta([{ id: CONTA, nome: 'Padaria Nova', cnpj: null, timezone: 'America/Sao_Paulo', status: 'ativa' }]),
      );

      await service.atualizar({ nome: 'Padaria Nova', timezone: 'America/Sao_Paulo' }, dono);

      expect(db.execute).not.toHaveBeenCalled();
    });

    it('recusa CNPJ com dígito verificador errado', async () => {
      const { service, db } = montar();

      await expect(
        service.atualizar({ cnpj: '12.345.678/0001-00' }, dono),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(db.update).not.toHaveBeenCalled();
    });

    it('recusa corpo sem nenhum campo', async () => {
      const { service, db } = montar();

      await expect(service.atualizar({}, dono)).rejects.toBeInstanceOf(BadRequestException);
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('atualizarUsuario', () => {
    it('não deixa o dono suspender a si mesmo', async () => {
      const { service, db, registrar } = montar();

      await expect(
        service.atualizarUsuario(DONO, { status: 'suspenso' }, dono),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // A regra vale antes da ida ao banco: nem consulta o alvo.
      expect(db.select).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
      expect(registrar).not.toHaveBeenCalled();
    });

    it('não deixa suspender o dono da conta', async () => {
      const { service, db, registrar } = montar();
      // O ator é outro dono hipotético; o alvo é o dono da conta.
      db.select.mockReturnValueOnce(
        consulta([
          {
            id: OPERADOR,
            nome: 'Titular',
            email: 'titular@empresa.com.br',
            papel: 'dono',
            status: 'ativo',
          },
        ]),
      );

      await expect(
        service.atualizarUsuario(OPERADOR, { status: 'suspenso' }, dono),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(db.update).not.toHaveBeenCalled();
      expect(registrar).not.toHaveBeenCalled();
    });

    it('suspende operador, derruba a sessão e audita', async () => {
      const { service, db, registrar } = montar();
      db.select.mockReturnValueOnce(
        consulta([
          {
            id: OPERADOR,
            nome: 'Ana',
            email: 'ana@empresa.com.br',
            papel: 'operador',
            status: 'ativo',
          },
        ]),
      );
      db.update.mockReturnValueOnce(
        consulta([
          {
            id: OPERADOR,
            nome: 'Ana',
            email: 'ana@empresa.com.br',
            papel: 'operador',
            status: 'suspenso',
            ultimoLoginEm: null,
            criadoEm: new Date('2026-09-01T12:00:00.000Z'),
          },
        ]),
      );

      const alterado = await service.atualizarUsuario(OPERADOR, { status: 'suspenso' }, dono);

      expect(alterado.status).toBe('suspenso');
      expect(registrar.mock.calls[0][0]).toMatchObject({
        acao: 'usuario.suspenso',
        detalhe: expect.objectContaining({ sessaoDerrubada: true }),
      });
    });
  });

  describe('removerUsuario', () => {
    it('não deixa remover o próprio acesso', async () => {
      const { service, db } = montar();

      await expect(service.removerUsuario(DONO, dono)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(db.delete).not.toHaveBeenCalled();
    });

    it('não deixa remover o dono da conta', async () => {
      const { service, db } = montar();
      db.select.mockReturnValueOnce(
        consulta([
          {
            id: OPERADOR,
            nome: 'Titular',
            email: 'titular@empresa.com.br',
            papel: 'dono',
          },
        ]),
      );

      await expect(service.removerUsuario(OPERADOR, dono)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(db.delete).not.toHaveBeenCalled();
    });

    it('remove o operador e audita nome e e-mail (a linha some do banco)', async () => {
      const { service, db, registrar } = montar();
      db.select.mockReturnValueOnce(
        consulta([
          {
            id: OPERADOR,
            nome: 'Ana',
            email: 'ana@empresa.com.br',
            papel: 'operador',
          },
        ]),
      );
      db.delete.mockReturnValueOnce(consulta([{ id: OPERADOR }]));

      const resposta = await service.removerUsuario(OPERADOR, dono);

      expect(resposta).toEqual({ mensagem: 'Acesso removido.' });
      expect(registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          acao: 'usuario.removido',
          entidadeId: OPERADOR,
          detalhe: expect.objectContaining({ nome: 'Ana', email: 'ana@empresa.com.br' }),
        }),
      );
    });

    it('não audita remoção que não aconteceu (delete sem linha)', async () => {
      const { service, db, registrar } = montar();
      db.select.mockReturnValueOnce(
        consulta([
          { id: OPERADOR, nome: 'Ana', email: 'ana@empresa.com.br', papel: 'operador' },
        ]),
      );
      // Linha já removida em outra aba: o delete roda e não pega nada.
      db.delete.mockReturnValueOnce(consulta([]));

      await expect(service.removerUsuario(OPERADOR, dono)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(registrar).not.toHaveBeenCalled();
    });

    it('falha do banco ao remover vira erro NOSSO (500), com o motivo real no log', async () => {
      const { service, db, registrar } = montar();
      const logado = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      db.select.mockReturnValueOnce(
        consulta([
          { id: OPERADOR, nome: 'Ana', email: 'ana@empresa.com.br', papel: 'operador' },
        ]),
      );
      // É assim que a trigger de append-only se manifestava quando a auditoria
      // ainda tinha FK `on delete set null` para usuario: o delete virava um
      // UPDATE na trilha, e o cliente recebia 500 sem explicação nenhuma.
      db.delete.mockReturnValueOnce(
        consultaQueFalha(
          Object.assign(new Error('auditoria é append-only (tentativa de UPDATE na linha 22)'), {
            code: 'P0001',
          }),
        ),
      );

      const erro = await service.removerUsuario(OPERADOR, dono).catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(InternalServerErrorException);
      expect((erro as Error).message).toContain('Tente de novo em instantes');
      expect(registrar).not.toHaveBeenCalled();
      // A regra da casa: o motivo real (código e mensagem do Postgres) tem de
      // estar no log, senão o diagnóstico custa horas.
      expect(String(logado.mock.calls[0]?.[0])).toContain('code P0001');
      expect(String(logado.mock.calls[0]?.[0])).toContain('append-only');

      logado.mockRestore();
    });
  });
});
