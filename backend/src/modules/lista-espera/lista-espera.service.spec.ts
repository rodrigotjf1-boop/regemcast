/**
 * Testes da fila de entrada.
 *
 * Não há Postgres aqui, então o banco é um dublê que faz duas coisas:
 *   1. guarda o SQL renderizado de cada `where` (é como a janela de 7 dias é
 *      verificada — a constante precisa estar NA CONSULTA, não só no código);
 *   2. implementa de verdade o `on conflict do nothing` por e-mail, que é a
 *      regra de idempotência do cadastro público.
 *
 * O `jest.mock` do env vem antes de tudo de propósito: `config/env` é
 * fail-fast e derrubaria a suíte por falta de DATABASE_URL, que teste unitário
 * não tem por que ter.
 */
jest.mock('../../config/env', () => ({
  env: {
    producao: false,
    rede: { appUrl: 'https://app.regemcast.test' },
  },
}));

import {
  ConflictException,
  ExecutionContext,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

import { env } from '../../config/env';
import type { ContextoDb, Db } from '../../db/contexto';
import type { AuditoriaService, EntradaAuditoria } from '../auditoria/auditoria.service';
import { DistTokenGuard, TAMANHO_MINIMO_DIST_TOKEN } from './dist-token.guard';
import type { CriarListaEsperaDto } from './dto/criar-lista-espera.dto';
import { ListaEsperaService, type OrigemRequest } from './lista-espera.service';
import { TETO_CONVITES_JANELA } from './lista-espera.status';

// --------------------------------------------------------------- dublê do banco

const dialeto = new PgDialect();

/** Devolve o SQL como o Postgres o veria — é sobre isso que asseguramos. */
function renderizar(pedaco: unknown): string {
  if (!pedaco) return '';
  try {
    return dialeto.sqlToQuery(pedaco as SQL).sql;
  } catch {
    return String(pedaco);
  }
}

type TipoConsulta = 'select' | 'insert' | 'update' | 'execute';

interface Registro {
  tipo: TipoConsulta;
  where: string;
  bruto?: string;
  valores?: Record<string, unknown>;
  comConflito?: boolean;
}

class Encadeada {
  private readonly registro: Registro;

  constructor(private readonly banco: BancoFalso, tipo: TipoConsulta) {
    this.registro = { tipo, where: '' };
    banco.consultas.push(this.registro);
  }

  from(): this {
    return this;
  }

  values(v: Record<string, unknown>): this {
    this.registro.valores = v;
    return this;
  }

  set(v: Record<string, unknown>): this {
    this.registro.valores = v;
    return this;
  }

  onConflictDoNothing(): this {
    this.registro.comConflito = true;
    return this;
  }

  where(condicao: unknown): this {
    this.registro.where = renderizar(condicao);
    return this;
  }

  orderBy(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  offset(): this {
    return this;
  }

  returning(): this {
    return this;
  }

  then(
    aoResolver?: (linhas: unknown[]) => unknown,
    aoRejeitar?: (erro: unknown) => unknown,
  ): Promise<unknown> {
    return this.banco.resolver(this.registro).then(aoResolver, aoRejeitar);
  }
}

class BancoFalso {
  readonly consultas: Registro[] = [];
  /** E-mails já gravados: é o índice único da tabela, em memória. */
  readonly emails = new Set<string>();
  private readonly respostas: unknown[][] = [];
  private sequencia = 1;

  select(): Encadeada {
    return new Encadeada(this, 'select');
  }

  insert(): Encadeada {
    return new Encadeada(this, 'insert');
  }

  update(): Encadeada {
    return new Encadeada(this, 'update');
  }

  execute(consulta: unknown): Promise<{ rows: unknown[] }> {
    this.consultas.push({ tipo: 'execute', where: '', bruto: renderizar(consulta) });
    return Promise.resolve({ rows: [] });
  }

  /** Enfileira o resultado da próxima consulta que não for insert. */
  responder(linhas: unknown[]): void {
    this.respostas.push(linhas);
  }

  resolver(registro: Registro): Promise<unknown[]> {
    if (registro.tipo === 'insert' && registro.comConflito) {
      const email = String(registro.valores?.email ?? '');
      // É o comportamento real do `on conflict do nothing ... returning`:
      // linha repetida devolve vazio, sem estourar e sem sobrescrever.
      if (this.emails.has(email)) return Promise.resolve([]);
      this.emails.add(email);
      return Promise.resolve([{ id: `id-${this.sequencia++}` }]);
    }
    return Promise.resolve(this.respostas.shift() ?? []);
  }

  comoDb(): Db {
    return this as unknown as Db;
  }

  selects(): Registro[] {
    return this.consultas.filter((c) => c.tipo === 'select');
  }
}

// ------------------------------------------------------------------ montagem

const ORIGEM: OrigemRequest = { ip: '203.0.113.10', userAgent: 'jest' };
const ID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

function montar() {
  const banco = new BancoFalso();
  const registrar = jest.fn(async (_entrada: EntradaAuditoria): Promise<void> => undefined);

  const ctx = {
    comEscopoSistema: <T>(_motivo: string, fn: (db: Db) => Promise<T>): Promise<T> =>
      fn(banco.comoDb()),
  } as unknown as ContextoDb;

  const auditoria = { registrar } as unknown as AuditoriaService;
  const servico = new ListaEsperaService(ctx, auditoria);

  return { banco, registrar, servico };
}

function dto(parcial: Partial<CriarListaEsperaDto> = {}): CriarListaEsperaDto {
  return {
    nome: '  Maria Souza  ',
    email: '  Maria@Exemplo.COM  ',
    telefone: '11987654321',
    ...parcial,
  } as CriarListaEsperaDto;
}

// ------------------------------------------------------- cadastro idempotente

describe('cadastro público na lista de espera', () => {
  it('e-mail repetido não cria linha nova nem muda a resposta', async () => {
    const { banco, registrar, servico } = montar();

    const primeira = await servico.cadastrar(dto(), ORIGEM);
    const segunda = await servico.cadastrar(dto(), ORIGEM);

    // Mesma resposta, byte a byte: a rota é anônima e não pode servir de
    // consulta de "fulano já se inscreveu?".
    expect(segunda).toEqual(primeira);
    expect(segunda.mensagem).not.toMatch(/já|existe|cadastrad|duplicad/i);

    // Uma linha só, e as duas tentativas passaram pelo on conflict.
    const inserts = banco.consultas.filter((c) => c.tipo === 'insert');
    expect(inserts).toHaveLength(2);
    expect(inserts.every((i) => i.comConflito === true)).toBe(true);
    expect(banco.emails.size).toBe(1);

    // Internamente a diferença existe — só não vaza para fora.
    expect(registrar.mock.calls.map((c) => c[0].acao)).toEqual([
      'lista_espera.cadastro',
      'lista_espera.cadastro_repetido',
    ]);
  });

  it('a resposta tem UM campo só — não há onde um "já existe" se esconder', async () => {
    const { servico } = montar();

    const primeira = await servico.cadastrar(dto(), ORIGEM);
    const segunda = await servico.cadastrar(dto(), ORIGEM);

    // Trava a FORMA, não só o texto: um `jaCadastrado: true` acrescentado sem
    // pensar daqui a seis meses reprova aqui em vez de virar um oráculo de
    // e-mails numa rota anônima.
    expect(Object.keys(primeira)).toEqual(['mensagem']);
    expect(Object.keys(segunda)).toEqual(['mensagem']);
    expect(JSON.stringify(segunda)).toBe(JSON.stringify(primeira));
  });

  it('normaliza e-mail e telefone antes de gravar', async () => {
    const { banco, servico } = montar();

    await servico.cadastrar(dto(), ORIGEM);

    const [insert] = banco.consultas.filter((c) => c.tipo === 'insert');
    expect(insert.valores?.email).toBe('maria@exemplo.com');
    expect(insert.valores?.nome).toBe('Maria Souza');
    // E.164 com "+": sem ele o mesmo assinante entra duas vezes na base.
    expect(insert.valores?.telefoneE164).toBe('+5511987654321');
  });

  it('telefone inválido entra como nulo em vez de sujar a coluna', async () => {
    const { banco, servico } = montar();

    await servico.cadastrar(dto({ telefone: '123' }), ORIGEM);

    const [insert] = banco.consultas.filter((c) => c.tipo === 'insert');
    expect(insert.valores?.telefoneE164).toBeNull();
  });

  it('não registra o telefone inteiro na auditoria', async () => {
    const { registrar, servico } = montar();

    await servico.cadastrar(dto(), ORIGEM);

    const detalhe = JSON.stringify(registrar.mock.calls[0][0].detalhe);
    expect(detalhe).not.toContain('987654');
    expect(detalhe).toContain('ma***@exemplo.com');
  });
});

// ------------------------------------------------------------ janela da Meta

describe('capacidade da janela da Meta', () => {
  it('conta só os convites dos últimos 7 dias', async () => {
    const { banco, servico } = montar();
    // O driver devolve TEXTO para expressão calculada (não há coluna para o
    // Drizzle mapear), e é assim que a linha chega de verdade do Postgres.
    banco.responder([{ enviados: 4, proximaVagaIso: '2026-09-18T12:00:00Z' }]);

    const capacidade = await servico.capacidade();

    expect(capacidade).toEqual({
      enviados7d: 4,
      teto: TETO_CONVITES_JANELA,
      restantes: 6,
      proximaVagaEm: new Date('2026-09-18T12:00:00.000Z'),
    });
    // Precisa ser Date de verdade: o caminho de janela cheia chama
    // `.toISOString()` nela, e uma string ali vira 500 no lugar do 409.
    expect(capacidade.proximaVagaEm).toBeInstanceOf(Date);

    // A janela precisa estar NA CONSULTA: filtrar em JS traria a tabela
    // inteira e, pior, usaria o relógio do processo em vez do do banco.
    const [consulta] = banco.selects();
    expect(consulta.where).toContain('convidada_em');
    expect(consulta.where).toContain('now()');
    expect(consulta.where).toContain("interval '7 days'");
  });

  it('a janela é ROLLING, no relógio do banco — não é mês-calendário', async () => {
    const { banco, servico } = montar();
    banco.responder([{ enviados: 0, proximaVagaIso: null }]);

    await servico.capacidade();

    const [consulta] = banco.selects();
    // A forma exata importa. `convidada_em >= now() - interval '7 days'` é uma
    // janela que anda com o relógio; `date_trunc('month', now())` zeraria a
    // contagem todo dia 1º e liberaria 10 convites novos enquanto os 10
    // anteriores ainda contam para a Meta.
    expect(consulta.where.replace(/\s+/g, ' ')).toContain(
      `"convidada_em" >= now() - interval '7 days'`,
    );
    expect(consulta.where).not.toMatch(/date_trunc|current_date|month/i);
    // E é `convidada_em`, não `criado_em`: o teto da Meta conta convite
    // emitido, não pedido recebido.
    expect(consulta.where).not.toContain('criado_em');
  });

  it('janela cheia não devolve vaga negativa', async () => {
    const { banco, servico } = montar();
    banco.responder([{ enviados: 12, proximaVagaIso: '2026-09-18T12:00:00Z' }]);

    const capacidade = await servico.capacidade();

    expect(capacidade.enviados7d).toBe(12);
    expect(capacidade.restantes).toBe(0);
  });

  it('janela vazia não tem próxima vaga', async () => {
    const { banco, servico } = montar();
    banco.responder([{ enviados: 0, proximaVagaIso: null }]);

    const capacidade = await servico.capacidade();

    expect(capacidade.restantes).toBe(TETO_CONVITES_JANELA);
    expect(capacidade.proximaVagaEm).toBeNull();
  });
});

// ------------------------------------------------------------------ convite

describe('convite', () => {
  function prepararConvite(banco: BancoFalso, enviados: number, status = 'aguardando') {
    banco.responder([{ id: ID, email: 'maria@exemplo.com', status }]); // a linha
    banco.responder([{ enviados, proximaVagaIso: '2026-09-20T00:00:00Z' }]);
    banco.responder([
      { id: ID, status: 'convidada', conviteExpiraEm: new Date('2026-09-20T00:00:00.000Z') },
    ]);
  }

  it('grava só o hash do token e devolve o link uma vez', async () => {
    const { banco, registrar, servico } = montar();
    prepararConvite(banco, 3);

    const resposta = await servico.convidar(ID, {}, ORIGEM);

    const token = resposta.link.split('/').pop() ?? '';
    expect(resposta.link.startsWith('https://app.regemcast.test/convite/')).toBe(true);
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const update = banco.consultas.find((c) => c.tipo === 'update');
    expect(update?.valores?.conviteTokenHash).toBe(
      createHash('sha256').update(token, 'utf8').digest('hex'),
    );
    // O token em claro não pode existir em lugar nenhum além do link.
    expect(JSON.stringify(registrar.mock.calls)).not.toContain(token);
  });

  it('trava a emissão e desconta a própria linha no reenvio', async () => {
    const { banco, servico } = montar();
    prepararConvite(banco, 9, 'convidada');

    await servico.convidar(ID, {}, ORIGEM);

    // Sem a trava, dois convites simultâneos leem o mesmo "restantes".
    const trava = banco.consultas.find((c) => c.tipo === 'execute');
    expect(trava?.bruto).toContain('pg_advisory_xact_lock');

    // A contagem da janela exclui a linha que está sendo reconvidada.
    const janela = banco.selects().find((c) => c.where.includes("interval '7 days'"));
    expect(janela?.where).toContain('<>');
  });

  it('janela cheia bloqueia o convite com o motivo', async () => {
    const { banco, servico } = montar();
    prepararConvite(banco, TETO_CONVITES_JANELA);

    await expect(servico.convidar(ID, {}, ORIGEM)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('forcar passa por cima do teto e fica marcado na auditoria', async () => {
    const { banco, registrar, servico } = montar();
    prepararConvite(banco, TETO_CONVITES_JANELA);

    await servico.convidar(ID, { forcar: true }, ORIGEM);

    const entrada = registrar.mock.calls[0][0];
    expect(entrada.acao).toBe('lista_espera.convidada');
    expect(entrada.atorTipo).toBe('distribuicao');
    expect(entrada.detalhe?.forcado).toBe(true);
  });

  it('pedido inexistente é 404, não 500', async () => {
    const { banco, servico } = montar();
    banco.responder([]); // a linha não existe

    await expect(servico.convidar(ID, {}, ORIGEM)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('quem já virou conta não recebe convite', async () => {
    const { banco, servico } = montar();
    banco.responder([{ id: ID, email: 'maria@exemplo.com', status: 'convertida' }]);

    await expect(servico.convidar(ID, {}, ORIGEM)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

// ------------------------------------------------------------------- recusa

describe('recusa', () => {
  it('invalida o convite em aberto ao recusar', async () => {
    const { banco, servico } = montar();
    banco.responder([{ id: ID, email: 'maria@exemplo.com', status: 'convidada' }]);
    banco.responder([{ id: ID, status: 'recusada' }]);

    await servico.recusar(ID, { observacao: ' Fora do público-alvo. ' }, ORIGEM);

    const update = banco.consultas.find((c) => c.tipo === 'update');
    // Sem isto, quem recebeu o link ontem abre conta hoje.
    expect(update?.valores?.conviteTokenHash).toBeNull();
    expect(update?.valores?.conviteExpiraEm).toBeNull();
    expect(update?.valores?.observacao).toBe('Fora do público-alvo.');
  });
});

// ------------------------------------------------------- portão do console

describe('DistTokenGuard', () => {
  const TOKEN = 'a'.repeat(TAMANHO_MINIMO_DIST_TOKEN);
  const guarda = new DistTokenGuard();
  const anterior = process.env.DIST_TOKEN;

  function contexto(cabecalhos: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ headers: cabecalhos }) }),
    } as unknown as ExecutionContext;
  }

  /** O env é o dublê do `jest.mock` lá em cima: dá para alternar o ambiente. */
  const ambiente = env as unknown as { producao: boolean };

  afterEach(() => {
    if (anterior === undefined) delete process.env.DIST_TOKEN;
    else process.env.DIST_TOKEN = anterior;
    ambiente.producao = false;
  });

  it('DIST_TOKEN ausente não abre a rota — responde 503', () => {
    delete process.env.DIST_TOKEN;

    expect(() => guarda.canActivate(contexto({ 'x-dist-token': TOKEN }))).toThrow(
      ServiceUnavailableException,
    );
    // Nem com o header vazio, nem sem header: fail-closed dos dois lados.
    expect(() => guarda.canActivate(contexto({}))).toThrow(ServiceUnavailableException);
  });

  it('o 503 diz QUAL variável falta, e como gerá-la', () => {
    delete process.env.DIST_TOKEN;

    // "Console de distribuição não configurado" sem dizer o quê manda quem
    // está operando procurar no código. O NOME da variável não é segredo — o
    // valor é, e esse nunca sai daqui.
    expect(() => guarda.canActivate(contexto({}))).toThrow(/DIST_TOKEN/);
    expect(() => guarda.canActivate(contexto({}))).toThrow(/openssl rand -hex 32/);
    expect(() => guarda.canActivate(contexto({}))).toThrow(
      new RegExp(String(TAMANHO_MINIMO_DIST_TOKEN)),
    );
  });

  it('DIST_TOKEN só de espaço conta como ausente', () => {
    process.env.DIST_TOKEN = '   ';

    expect(() => guarda.canActivate(contexto({ 'x-dist-token': '   ' }))).toThrow(
      ServiceUnavailableException,
    );
  });

  it('em produção, DIST_TOKEN curto é erro de configuração, não porta aberta', () => {
    process.env.DIST_TOKEN = 'curto';
    ambiente.producao = true;

    expect(() => guarda.canActivate(contexto({ 'x-dist-token': 'curto' }))).toThrow(
      ServiceUnavailableException,
    );
  });

  it('em dev, DIST_TOKEN curto avisa mas ainda exige o token certo', () => {
    process.env.DIST_TOKEN = 'curto';
    ambiente.producao = false;

    expect(guarda.canActivate(contexto({ 'x-dist-token': 'curto' }))).toBe(true);
    // Curto não quer dizer "qualquer um entra".
    expect(() => guarda.canActivate(contexto({ 'x-dist-token': 'outro' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('token certo entra; token errado, ausente ou repetido recebe 401', () => {
    process.env.DIST_TOKEN = TOKEN;

    expect(guarda.canActivate(contexto({ 'x-dist-token': TOKEN }))).toBe(true);

    expect(() =>
      guarda.canActivate(contexto({ 'x-dist-token': 'b'.repeat(TOKEN.length) })),
    ).toThrow(UnauthorizedException);
    expect(() => guarda.canActivate(contexto({}))).toThrow(UnauthorizedException);
    // Tamanho diferente não pode estourar o timingSafeEqual.
    expect(() => guarda.canActivate(contexto({ 'x-dist-token': 'b' }))).toThrow(
      UnauthorizedException,
    );
    // Header repetido chega como array: recusamos em vez de escolher um.
    expect(() =>
      guarda.canActivate(contexto({ 'x-dist-token': [TOKEN, 'outro'] })),
    ).toThrow(UnauthorizedException);
  });
});
