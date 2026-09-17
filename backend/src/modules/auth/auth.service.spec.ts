import './ambiente-de-teste';

import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { createHash } from 'node:crypto';

import { AuthGuard, type RequestAutenticado } from '../../common/auth.guard';
import type { ContextoDb, Db } from '../../db/contexto';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import { AuthService } from './auth.service';
import type { AceitarConviteDto } from './dto/aceitar-convite.dto';
import type { LoginDto } from './dto/login.dto';
import type { TrocarSenhaDto } from './dto/trocar-senha.dto';

/**
 * Banco falso: um Proxy que devolve a si mesmo para qualquer método
 * encadeado (select/from/where/limit/insert/update/returning) e resolve, a
 * cada await, a próxima resposta da fila. Isso deixa o teste focado no QUE a
 * regra decide, sem simular o dialeto inteiro do Drizzle.
 */
interface Chamada {
  metodo: string;
  args: unknown[];
}

interface DbFalso {
  db: Db;
  chamadas: Chamada[];
}

function criarDbFalso(...respostas: unknown[]): DbFalso {
  const fila = [...respostas];
  const chamadas: Chamada[] = [];

  const proxy: unknown = new Proxy(
    {},
    {
      get(_alvo, prop) {
        if (prop === 'then') {
          const valor = fila.shift();
          return (resolver: (v: unknown) => void, rejeitar: (e: unknown) => void) => {
            if (valor instanceof Error) rejeitar(valor);
            else resolver(valor ?? []);
          };
        }
        if (typeof prop === 'symbol') return undefined;
        return (...args: unknown[]) => {
          chamadas.push({ metodo: prop, args });
          return proxy;
        };
      },
    },
  );

  return { db: proxy as Db, chamadas };
}

function contextoFalso(dbf: DbFalso): ContextoDb {
  const ctx = {
    get db() {
      return dbf.db;
    },
    get contaId() {
      return 'conta-1';
    },
    contaObrigatoria: () => 'conta-1',
    comConta: <T>(_conta: string, fn: (db: Db) => Promise<T>) => fn(dbf.db),
    comEscopoSistema: <T>(_motivo: string, fn: (db: Db) => Promise<T>) => fn(dbf.db),
  };
  return ctx as unknown as ContextoDb;
}

function montar(dbf: DbFalso) {
  const auditoria = {
    registrar: jest.fn().mockResolvedValue(undefined),
    registrarForaDeContexto: jest.fn().mockResolvedValue(undefined),
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('jwt-de-teste') };
  const servico = new AuthService(
    contextoFalso(dbf),
    jwt as unknown as JwtService,
    auditoria as unknown as AuditoriaService,
    {} as never,
    {} as never,
    {} as never,
  );
  return { servico, auditoria, jwt };
}

const SENHA_CERTA = 'senha certa 2026';
let hashCerto: string;

const usuarioAtivo = (extra: Record<string, unknown> = {}) => ({
  id: 'usuario-1',
  contaId: 'conta-1',
  nome: 'Ana Prado',
  email: 'ana@empresa.com.br',
  senhaHash: hashCerto,
  papel: 'dono',
  status: 'ativo',
  tokenVersao: 1,
  doisFatores: 'nenhum',
  bloqueadoAte: null,
  ...extra,
});

beforeAll(async () => {
  hashCerto = await argon2.hash(SENHA_CERTA);
}, 30_000);

describe('AuthService.login', () => {
  it('recusa senha errada com a mesma frase de e-mail inexistente', async () => {
    const dbf = criarDbFalso([usuarioAtivo()]);
    const { servico, auditoria } = montar(dbf);

    const erro = await servico
      .login({ email: 'ana@empresa.com.br', senha: 'senha errada' } as LoginDto, {})
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(UnauthorizedException);
    expect((erro as Error).message).toBe('E-mail ou senha incorretos.');
    // A negativa é gravada fora da transação — se fosse dentro, o throw
    // levaria o registro junto no rollback.
    expect(auditoria.registrarForaDeContexto).toHaveBeenCalledWith(
      expect.objectContaining({ acao: 'usuario.login_negado', entidadeId: 'usuario-1' }),
    );
    expect(auditoria.registrar).not.toHaveBeenCalled();
  }, 20_000);

  it('responde igual quando o e-mail não existe (sem entregar quem tem conta)', async () => {
    const dbf = criarDbFalso([]);
    const { servico, auditoria } = montar(dbf);

    const erro = await servico
      .login({ email: 'ninguem@empresa.com.br', senha: SENHA_CERTA } as LoginDto, {})
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(UnauthorizedException);
    expect((erro as Error).message).toBe('E-mail ou senha incorretos.');
    expect(auditoria.registrarForaDeContexto).toHaveBeenCalledWith(
      expect.objectContaining({ acao: 'usuario.login_negado', atorUsuarioId: null }),
    );
  }, 20_000);

  it('bloqueia usuário suspenso mesmo com a senha certa', async () => {
    const dbf = criarDbFalso([usuarioAtivo({ status: 'suspenso' })]);
    const { servico, auditoria, jwt } = montar(dbf);

    const erro = await servico
      .login({ email: 'ana@empresa.com.br', senha: SENHA_CERTA } as LoginDto, {})
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(UnauthorizedException);
    expect((erro as Error).message).toBe('Este acesso foi suspenso. Fale com o dono da conta.');
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(auditoria.registrarForaDeContexto).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: 'usuario.login_negado',
        detalhe: expect.objectContaining({ motivo: 'usuario-suspenso' }),
      }),
    );
  }, 20_000);

  it('bloqueia quando a conta está suspensa, sem emitir token', async () => {
    const dbf = criarDbFalso(
      [usuarioAtivo()],
      [{ id: 'conta-1', nome: 'Padaria Aurora', timezone: 'America/Sao_Paulo', status: 'suspensa' }],
    );
    const { servico, jwt } = montar(dbf);

    const erro = await servico
      .login({ email: 'ana@empresa.com.br', senha: SENHA_CERTA } as LoginDto, {})
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(UnauthorizedException);
    expect((erro as Error).message).toContain('Esta conta está suspensa');
    expect(jwt.signAsync).not.toHaveBeenCalled();
  }, 20_000);

  it('emite a sessão e audita quando tudo confere', async () => {
    const dbf = criarDbFalso(
      [usuarioAtivo()],
      [{ id: 'conta-1', nome: 'Padaria Aurora', timezone: 'America/Sao_Paulo', status: 'ativa' }],
      [],
    );
    const { servico, auditoria, jwt } = montar(dbf);

    const resultado = await servico.login(
      { email: 'ana@empresa.com.br', senha: SENHA_CERTA } as LoginDto,
      { ip: '203.0.113.7', userAgent: 'jest' },
    );

    // O token sai à parte, para o controller gravar o cookie httpOnly. O que
    // vai no CORPO da resposta não pode ter token: devolvê-lo no JSON anula o
    // httpOnly, porque aí qualquer XSS lê a resposta do login.
    if (resultado.tipo !== 'sessao') throw new Error('esperava sessão direto');
    const emitida = resultado.sessao;
    expect(emitida.token).toBe('jwt-de-teste');
    expect(emitida.resposta).not.toHaveProperty('token');
    expect(emitida.resposta.usuario.papel).toBe('dono');
    expect(emitida.resposta.conta.status).toBe('ativa');
    expect(jwt.signAsync).toHaveBeenCalledWith(
      { sub: 'usuario-1', conta: 'conta-1', ver: 1 },
      expect.objectContaining({ expiresIn: expect.any(String) }),
    );
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ acao: 'usuario.login', contaId: 'conta-1' }),
    );
  }, 20_000);

  it('com duas etapas ligadas, senha certa NÃO abre sessão nem registra entrada', async () => {
    const dbf = criarDbFalso(
      [usuarioAtivo({ doisFatores: 'app' })],
      [{ id: 'conta-1', nome: 'Padaria Aurora', timezone: 'America/Sao_Paulo', status: 'ativa' }],
      [],
    );
    const { servico, auditoria, jwt } = montar(dbf);

    const resultado = await servico.login(
      { email: 'ana@empresa.com.br', senha: SENHA_CERTA } as LoginDto,
      {},
    );

    // Senha vazada sozinha não pode virar sessão: nenhum token assinado e
    // nenhuma entrada registrada antes do código.
    expect(resultado.tipo).toBe('segunda_etapa');
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(auditoria.registrar).not.toHaveBeenCalledWith(expect.objectContaining({ acao: 'usuario.login' }));
  }, 20_000);

  it('acesso travado por códigos errados recusa até com a senha certa', async () => {
    const dbf = criarDbFalso(
      [usuarioAtivo({ doisFatores: 'email', bloqueadoAte: new Date(Date.now() + 10 * 60_000) })],
      [{ id: 'conta-1', nome: 'Padaria Aurora', timezone: 'America/Sao_Paulo', status: 'ativa' }],
      [],
    );
    const { servico, jwt } = montar(dbf);

    await expect(
      servico.login({ email: 'ana@empresa.com.br', senha: SENHA_CERTA } as LoginDto, {}),
    ).rejects.toThrow(/travado/);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  }, 20_000);
});

describe('AuthService.sair', () => {
  const sessao = {
    id: 'usuario-1',
    contaId: 'conta-1',
    nome: 'Ana Prado',
    email: 'ana@empresa.com.br',
    papel: 'dono' as const,
  };

  it('incrementa token_versao — sair derruba até o token que alguém copiou', async () => {
    const dbf = criarDbFalso([]);
    const { servico, auditoria } = montar(dbf);

    const resposta = await servico.sair(sessao, { ip: '203.0.113.7', userAgent: 'jest' });

    expect(dbf.chamadas.some((c) => c.metodo === 'update')).toBe(true);
    const campos = dbf.chamadas.find((c) => c.metodo === 'set')?.args[0] as
      | Record<string, unknown>
      | undefined;
    // Só token_versao: sair não mexe em senha, status nem nome.
    expect(Object.keys(campos ?? {})).toEqual(['tokenVersao']);
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: 'usuario.logout',
        detalhe: { sessoesEncerradas: true },
      }),
    );
    expect(resposta.mensagem).toContain('encerradas');
  });
});

describe('AuthGuard', () => {
  function guardaCom(linha: Record<string, unknown>, payload: Record<string, unknown>) {
    const dbf = criarDbFalso([linha]);
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
    const jwt = { verifyAsync: jest.fn().mockResolvedValue(payload) } as unknown as JwtService;
    const guard = new AuthGuard(reflector, jwt, contextoFalso(dbf));

    const req = { headers: { authorization: 'Bearer qualquer' } } as unknown as RequestAutenticado;
    const contexto = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    return { guard, contexto, req };
  }

  it('derruba a sessão quando token_versao do banco não bate com o do token', async () => {
    // É este caminho que faz a troca de senha (que incrementa token_versao)
    // encerrar as sessões abertas na hora.
    const { guard, contexto } = guardaCom(
      {
        id: 'usuario-1',
        contaId: 'conta-1',
        nome: 'Ana',
        email: 'ana@empresa.com.br',
        papel: 'dono',
        status: 'ativo',
        tokenVersao: 2,
      },
      { sub: 'usuario-1', conta: 'conta-1', ver: 1 },
    );

    await expect(guard.canActivate(contexto)).rejects.toMatchObject({
      message: 'Sua sessão expirou. Entre de novo.',
    });
  });

  it('aceita quando a versão bate', async () => {
    const { guard, contexto, req } = guardaCom(
      {
        id: 'usuario-1',
        contaId: 'conta-1',
        nome: 'Ana',
        email: 'ana@empresa.com.br',
        papel: 'dono',
        status: 'ativo',
        tokenVersao: 7,
      },
      { sub: 'usuario-1', conta: 'conta-1', ver: 7 },
    );

    await expect(guard.canActivate(contexto)).resolves.toBe(true);
    expect(req.usuario?.contaId).toBe('conta-1');
  });
});

describe('AuthService.trocarSenha', () => {
  const sessao = {
    id: 'usuario-1',
    contaId: 'conta-1',
    nome: 'Ana Prado',
    email: 'ana@empresa.com.br',
    papel: 'dono' as const,
  };

  it('incrementa token_versao (encerra todas as sessões) e audita', async () => {
    const dbf = criarDbFalso([{ id: 'usuario-1', senhaHash: hashCerto }], []);
    const { servico, auditoria } = montar(dbf);

    const resposta = await servico.trocarSenha(
      sessao,
      { senhaAtual: SENHA_CERTA, senhaNova: 'outra senha 2027' } as TrocarSenhaDto,
      {},
    );

    const campos = dbf.chamadas.find((c) => c.metodo === 'set')?.args[0] as
      | Record<string, unknown>
      | undefined;
    expect(campos).toBeDefined();
    expect(Object.keys(campos ?? {})).toEqual(
      expect.arrayContaining(['senhaHash', 'tokenVersao']),
    );
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ acao: 'usuario.senha_alterada' }),
    );
    expect(resposta.mensagem).toContain('sessões abertas foram encerradas');
  }, 30_000);

  it('recusa quando a senha atual está errada, sem gravar nada', async () => {
    const dbf = criarDbFalso([{ id: 'usuario-1', senhaHash: hashCerto }]);
    const { servico, auditoria } = montar(dbf);

    await expect(
      servico.trocarSenha(
        sessao,
        { senhaAtual: 'chute', senhaNova: 'outra senha 2027' } as TrocarSenhaDto,
        {},
      ),
    ).rejects.toMatchObject({ message: 'A senha atual está incorreta.' });
    expect(dbf.chamadas.some((c) => c.metodo === 'update')).toBe(false);
    expect(auditoria.registrar).not.toHaveBeenCalled();
  }, 20_000);
});

describe('AuthService — convite', () => {
  const TOKEN = 'a'.repeat(64);
  const hashDoToken = createHash('sha256').update(TOKEN).digest('hex');

  const conviteBase = (extra: Record<string, unknown> = {}) => ({
    id: 'lista-1',
    email: 'ana@empresa.com.br',
    nome: 'Ana Prado',
    empresa: 'Padaria Aurora',
    status: 'convidada',
    conviteTokenHash: hashDoToken,
    conviteExpiraEm: new Date(Date.now() + 86_400_000),
    ...extra,
  });

  it('recusa convite expirado na prévia', async () => {
    const dbf = criarDbFalso([conviteBase({ conviteExpiraEm: new Date(Date.now() - 1_000) })]);
    const { servico } = montar(dbf);

    await expect(servico.previaConvite(TOKEN)).rejects.toMatchObject({
      message: 'Convite inválido ou expirado.',
    });
  });

  it('recusa convite expirado ao aceitar, sem criar conta', async () => {
    const dbf = criarDbFalso([conviteBase({ conviteExpiraEm: new Date(Date.now() - 1_000) })]);
    const { servico, auditoria } = montar(dbf);

    await expect(
      servico.aceitarConvite(
        {
          token: TOKEN,
          nome: 'Ana Prado',
          senha: 'senha nova 2026',
          nomeEmpresa: 'Padaria Aurora',
        } as AceitarConviteDto,
        {},
      ),
    ).rejects.toMatchObject({ message: 'Convite inválido ou expirado.' });

    expect(dbf.chamadas.some((c) => c.metodo === 'insert')).toBe(false);
    expect(auditoria.registrar).not.toHaveBeenCalled();
  }, 30_000);

  it('recusa convite já convertido com a mesma frase genérica', async () => {
    const dbf = criarDbFalso([conviteBase({ status: 'convertida' })]);
    const { servico } = montar(dbf);

    await expect(servico.previaConvite(TOKEN)).rejects.toMatchObject({
      message: 'Convite inválido ou expirado.',
    });
  });

  it('devolve os dados do convite válido para a tela de cadastro', async () => {
    const dbf = criarDbFalso([conviteBase()]);
    const { servico } = montar(dbf);

    await expect(servico.previaConvite(TOKEN)).resolves.toEqual({
      email: 'ana@empresa.com.br',
      nome: 'Ana Prado',
      empresa: 'Padaria Aurora',
    });
  });
});
