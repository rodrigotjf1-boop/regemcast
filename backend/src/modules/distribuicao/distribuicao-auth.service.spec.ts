/**
 * Testes do login de operador.
 *
 * O `JwtService` aqui é o REAL, não um dublê. As garantias mais importantes
 * deste arquivo — token de cliente não vale como operador, pré-sessão não abre
 * o console — dependem da assinatura de fato ser verificada. Um dublê que
 * devolvesse o payload sem conferir faria estes testes passarem com a defesa
 * desligada.
 */
import { ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

const ENV = {
  producao: false,
  sessao: { segredo: 'segredo-do-cliente-com-tamanho-suficiente-para-teste', ttlHoras: 12 },
  distribuicao: { totpChave: 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=', cookieNome: 'regemcast_dist', ttlHoras: 8 },
  meta: { tokenChave: 'outra-chave' },
};
jest.mock('../../config/env', () => ({ env: ENV }));

import { gerarHashSenha } from '../auth/argon2';
import { cifrarToken } from '../meta/cripto';
import { DistribuicaoAuthService, segredoDaDistribuicao } from './distribuicao-auth.service';
import { codigoDoPasso, deBase32, novoSegredo, passoDe } from '../../common/totp';

const OPERADOR_ID = '40000000-0000-4000-8000-000000000004';
const META = { ip: '127.0.0.1', userAgent: 'jest' };

interface OperadorFalso {
  id: string;
  nome: string;
  email: string;
  senhaHash: string;
  totpSegredoCifrado: string | null;
  totpAtivo: boolean;
  status: string;
  tokenVersao: number;
  tentativasFalhas: number;
  bloqueadoAte: Date | null;
}

let senhaHash: string;

beforeAll(async () => {
  senhaHash = await gerarHashSenha('senha-correta-123');
});

function montar(parcial: Partial<OperadorFalso> = {}) {
  const operador: OperadorFalso = {
    id: OPERADOR_ID,
    nome: 'Rodrigo',
    email: 'rodrigo@dmsregem.com',
    senhaHash,
    totpSegredoCifrado: null,
    totpAtivo: false,
    status: 'ativo',
    tokenVersao: 1,
    tentativasFalhas: 0,
    bloqueadoAte: null,
    ...parcial,
  };

  /** Tudo que foi passado a set() e values() — o que de fato iria para o banco. */
  const gravacoes: unknown[] = [];

  const cadeia = (linhas: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'limit', 'returning']) c[m] = () => c;
    c.set = (v: unknown) => {
      gravacoes.push(v);
      return c;
    };
    c.values = (v: unknown) => {
      gravacoes.push(v);
      return c;
    };
    c.then = (r: (v: unknown[]) => void) => r(linhas);
    return c;
  };

  const db = {
    select: jest.fn(() => cadeia([operador])),
    update: jest.fn(() => cadeia([])),
    insert: jest.fn(() => cadeia([])),
    execute: jest.fn().mockResolvedValue({ rows: [] }),
  };
  const ctx = { comEscopoSistema: <T>(_m: string, fn: (d: typeof db) => Promise<T>) => fn(db) };
  const jwt = new JwtService({});

  return { service: new DistribuicaoAuthService(ctx as never, jwt), jwt, db, operador, gravacoes };
}

// --------------------------------------------------------- confusão de token

describe('separação entre sessão de cliente e de operador', () => {
  it('um token assinado com o segredo do CLIENTE não vale como operador', async () => {
    // O ataque: alguém com uma conta comum pega o próprio token e o apresenta ao
    // console. Mesmo com payload idêntico ao de operador, a assinatura é outra.
    const m = montar({ totpAtivo: true });
    const tokenDeCliente = await m.jwt.signAsync(
      { sub: OPERADOR_ID, tipo: 'sessao', ver: 1 },
      { secret: ENV.sessao.segredo },
    );

    await expect(m.service.validarSessao(tokenDeCliente)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('o segredo da distribuição é diferente do segredo do cliente', () => {
    expect(segredoDaDistribuicao()).not.toBe(ENV.sessao.segredo);
  });

  it('um token de operador não valida com o segredo do cliente', async () => {
    const m = montar({ totpAtivo: true });
    const tokenDeOperador = await m.jwt.signAsync(
      { sub: OPERADOR_ID, tipo: 'sessao', ver: 1 },
      { secret: segredoDaDistribuicao() },
    );

    await expect(m.jwt.verifyAsync(tokenDeOperador, { secret: ENV.sessao.segredo })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------- duas etapas

describe('duas etapas, sempre', () => {
  it('a senha certa NUNCA emite sessão — só a pré-sessão do próximo passo', async () => {
    const m = montar({ totpAtivo: true });
    const r = await m.service.entrar('rodrigo@dmsregem.com', 'senha-correta-123', META);

    expect(r.etapa).toBe('codigo');
    const payload = await m.jwt.verifyAsync(r.preToken, { secret: segredoDaDistribuicao() });
    expect(payload.tipo).toBe('pre');
  });

  it('a pré-sessão NÃO abre o console', async () => {
    const m = montar({ totpAtivo: true });
    const { preToken } = await m.service.entrar('rodrigo@dmsregem.com', 'senha-correta-123', META);

    await expect(m.service.validarSessao(preToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('o primeiro login leva ao CADASTRO do código', async () => {
    const m = montar({ totpAtivo: false });
    const r = await m.service.entrar('rodrigo@dmsregem.com', 'senha-correta-123', META);
    expect(r.etapa).toBe('cadastrar_codigo');
  });

  it('a pré-sessão de uma etapa não serve para a outra', async () => {
    // Quem ainda não cadastrou o código não pode pular direto para "confirmar
    // código", nem o contrário.
    const m = montar({ totpAtivo: false });
    const { preToken } = await m.service.entrar('rodrigo@dmsregem.com', 'senha-correta-123', META);

    await expect(m.service.confirmarCodigo(preToken, '123456', META)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('com o código certo, abre a sessão', async () => {
    const segredo = novoSegredo();
    const m = montar({ totpAtivo: true, totpSegredoCifrado: cifrarToken(segredo, ENV.distribuicao.totpChave) });
    const { preToken } = await m.service.entrar('rodrigo@dmsregem.com', 'senha-correta-123', META);
    const codigo = codigoDoPasso(deBase32(segredo), passoDe(new Date()));
    // O banco aceita gravar o passo: é a primeira vez que este código aparece.
    m.db.execute.mockResolvedValueOnce({ rows: [{ id: m.operador.id }] });

    const sessao = await m.service.confirmarCodigo(preToken, codigo, META);
    const payload = await m.jwt.verifyAsync(sessao, { secret: segredoDaDistribuicao() });
    expect(payload.tipo).toBe('sessao');
  });

  it('o mesmo código não abre uma segunda sessão (uso único)', async () => {
    const segredo = novoSegredo();
    const m = montar({ totpAtivo: true, totpSegredoCifrado: cifrarToken(segredo, ENV.distribuicao.totpChave) });
    const { preToken } = await m.service.entrar('rodrigo@dmsregem.com', 'senha-correta-123', META);
    const codigo = codigoDoPasso(deBase32(segredo), passoDe(new Date()));
    // O banco NÃO grava o passo: já existe um igual ou posterior.
    m.db.execute.mockResolvedValueOnce({ rows: [] });

    await expect(m.service.confirmarCodigo(preToken, codigo, META)).rejects.toThrow('já foi usado');
  });

  it('com o código errado, recusa e CONTA a falha', async () => {
    const segredo = novoSegredo();
    const m = montar({ totpAtivo: true, totpSegredoCifrado: cifrarToken(segredo, ENV.distribuicao.totpChave) });
    const { preToken } = await m.service.entrar('rodrigo@dmsregem.com', 'senha-correta-123', META);
    const certo = codigoDoPasso(deBase32(segredo), passoDe(new Date()));
    const errado = certo === '000000' ? '111111' : '000000';

    await expect(m.service.confirmarCodigo(preToken, errado, META)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // A contagem é o que alimenta a trava — sem ela, um milhão de combinações
    // cabem num robô.
    const sqlDaFalha = m.db.execute.mock.calls.map((c) => JSON.stringify(c[0])).join(' ');
    expect(sqlDaFalha).toContain('tentativas_falhas + 1');
  });

  it('sessão de operador sem duas etapas ativas é recusada (defesa em profundidade)', async () => {
    const m = montar({ totpAtivo: false });
    const sessao = await m.jwt.signAsync(
      { sub: OPERADOR_ID, tipo: 'sessao', ver: 1 },
      { secret: segredoDaDistribuicao() },
    );
    await expect(m.service.validarSessao(sessao)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

// ------------------------------------------------------------------ bloqueios

describe('bloqueios', () => {
  it('senha errada recusa sem dizer se o e-mail existe', async () => {
    const m = montar();
    const erro = await m.service.entrar('rodrigo@dmsregem.com', 'senha-errada', META).catch((e) => e);
    expect(erro).toBeInstanceOf(UnauthorizedException);
    expect(erro.message).toBe('E-mail ou senha não conferem.');
  });

  it('operador travado por tentativas não entra, nem com a senha certa', async () => {
    const m = montar({ bloqueadoAte: new Date(Date.now() + 10 * 60_000) });
    await expect(
      m.service.entrar('rodrigo@dmsregem.com', 'senha-correta-123', META),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('operador suspenso não entra', async () => {
    const m = montar({ status: 'suspenso' });
    await expect(
      m.service.entrar('rodrigo@dmsregem.com', 'senha-correta-123', META),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('versão mudou depois da sessão emitida: a sessão morre na hora', async () => {
    // É o que derruba um acesso na troca de senha ou na suspensão, sem esperar
    // o cookie expirar.
    const m = montar({ totpAtivo: true, tokenVersao: 2 });
    const antiga = await m.jwt.signAsync(
      { sub: OPERADOR_ID, tipo: 'sessao', ver: 1 },
      { secret: segredoDaDistribuicao() },
    );
    await expect(m.service.validarSessao(antiga)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

// ------------------------------------------------------------------- chaves

describe('chave do código de duas etapas', () => {
  it('sem DIST_TOTP_CHAVE, o cadastro RECUSA em vez de cair na chave da Meta', async () => {
    const original = ENV.distribuicao.totpChave;
    ENV.distribuicao.totpChave = '';
    try {
      const m = montar({ totpAtivo: false });
      const { preToken } = await m.service.entrar('rodrigo@dmsregem.com', 'senha-correta-123', META);
      await expect(m.service.iniciarCadastroDoCodigo(preToken)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    } finally {
      ENV.distribuicao.totpChave = original;
    }
  });

  it('o segredo é gravado CIFRADO, nunca em claro', async () => {
    const m = montar({ totpAtivo: false });
    const { preToken } = await m.service.entrar('rodrigo@dmsregem.com', 'senha-correta-123', META);
    const { segredo } = await m.service.iniciarCadastroDoCodigo(preToken);

    // O que de fato foi para o banco.
    const doSegredo = m.gravacoes.find(
      (g) => typeof g === 'object' && g !== null && 'totpSegredoCifrado' in g,
    ) as { totpSegredoCifrado: string } | undefined;

    expect(doSegredo).toBeDefined();
    // Em claro, quem lê o banco gera os códigos e a segunda etapa some.
    expect(doSegredo!.totpSegredoCifrado).not.toContain(segredo);
    expect(doSegredo!.totpSegredoCifrado.length).toBeGreaterThan(segredo.length);
    // E NÃO ativa as duas etapas antes da confirmação: segredo nunca confirmado
    // não protege nada, e ativá-lo trancaria para fora quem escaneou errado.
    expect(JSON.stringify(m.gravacoes)).not.toContain('"totpAtivo":true');
  });
});
