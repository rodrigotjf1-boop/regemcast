/**
 * Testes do onboarding da conta de WhatsApp.
 *
 * O que está sob teste aqui é o caminho que **não dá para conferir olhando**:
 * a coexistência e o número dedicado seguem passos diferentes, e errar a
 * bifurcação não quebra o build nem estoura teste nenhum — só falha na frente
 * do cliente, no meio do onboarding, com mensagem da Meta que não explica
 * nada.
 *
 * As três regras que estes testes trancam:
 *
 *   1. **Coexistência não chama `/register`.** O número já foi registrado pelo
 *      app do celular; chamar de novo devolve erro e aborta a conexão.
 *   2. **Número dedicado não pede sincronização.** Não há app de onde copiar, e
 *      o pedido cairia com erro.
 *   3. **Sem `phone_number_id`, descobre pela WABA.** A Meta documenta que pode
 *      não mandar esse campo na coexistência. Abortar aí deixaria o cliente com
 *      a conta conectada e nenhum número — parece que deu certo e nada funciona.
 *
 * O banco entra como dublê. Nada aqui toca Postgres nem rede.
 */
import { Logger } from '@nestjs/common';

// `config/env` é fail-fast no import: sem DATABASE_URL o módulo derruba o
// processo só de ser carregado, e a cadeia deste teste passa por ele. A chave
// precisa ser base64 de 32 bytes porque o token é cifrado de verdade.
jest.mock('../../config/env', () => ({
  env: {
    meta: {
      appId: '123',
      appSecret: 'segredo',
      configId: '456',
      graphVersao: 'v23.0',
      tokenChave: Buffer.alloc(32, 7).toString('base64'),
    },
  },
}));

import { MetaService } from './meta.service';

const CONTA = '11111111-1111-4111-8111-111111111111';
const USUARIO = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'EAAG-token-do-cliente-que-nunca-pode-vazar';

/** Uma escrita que o dublê registrou, para o teste poder afirmar sobre ela. */
interface Escrita {
  tipo: 'update' | 'insert';
  valores: Record<string, unknown>;
}

type Encadeavel = Record<string, unknown>;

/**
 * Encadeamento mínimo do query builder do Drizzle: todo método devolve o
 * próprio objeto, que é "thenable" — então `await db.select().from(x)` resolve
 * nas linhas combinadas. `set` e `values` guardam o payload no diário, que é o
 * que permite afirmar *o que* foi gravado, e não apenas que gravou.
 */
function consulta(linhas: unknown[], diario: Escrita[], tipo?: 'update' | 'insert'): Encadeavel {
  const alvo: Encadeavel = {};
  for (const metodo of ['from', 'leftJoin', 'innerJoin', 'where', 'orderBy', 'limit', 'returning']) {
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

function montar() {
  const diario: Escrita[] = [];

  const db = {
    select: jest.fn(() => consulta([], diario)),
    update: jest.fn(() => consulta([], diario, 'update')),
    insert: jest.fn(() => consulta([], diario, 'insert')),
    delete: jest.fn(() => consulta([], diario)),
  };

  // Nenhuma conta nem número preexistente: os dois `select ... limit 1` de
  // `gravarWaConta`/`gravarNumero` voltam vazios, e os inserts devolvem id.
  db.insert
    .mockReturnValueOnce(consulta([{ id: 'wa-conta-1' }], diario, 'insert'))
    .mockReturnValueOnce(consulta([{ id: 'num-1' }], diario, 'insert'));

  const graph = {
    trocarCodePorToken: jest.fn().mockResolvedValue({ token: TOKEN, expiraEm: 5_184_000 }),
    dadosDaWaba: jest.fn().mockResolvedValue({
      id: 'WABA1',
      name: 'Padaria Aurora',
      currency: 'BRL',
      account_review_status: 'APPROVED',
    }),
    assinarWebhook: jest.fn().mockResolvedValue(undefined),
    numerosDaWaba: jest.fn().mockResolvedValue({
      data: [
        {
          id: 'PN1',
          display_phone_number: '+55 11 90000-0000',
          verified_name: 'Padaria Aurora',
          quality_rating: 'GREEN',
          messaging_limit_tier: 'TIER_1K',
        },
      ],
    }),
    registrarNumero: jest.fn().mockResolvedValue(undefined),
    sincronizarDadosDoApp: jest.fn().mockResolvedValue(undefined),
  };

  const registrar = jest.fn().mockResolvedValue(undefined);

  const ctx = {
    db,
    contaId: CONTA,
    contaObrigatoria: () => CONTA,
    comConta: (_id: string, fn: (d: unknown) => Promise<unknown>) => fn(db),
    comEscopoSistema: (_motivo: string, fn: (d: unknown) => Promise<unknown>) => fn(db),
  };

  const service = new MetaService(
    ctx as unknown as ConstructorParameters<typeof MetaService>[0],
    graph as unknown as ConstructorParameters<typeof MetaService>[1],
    { registrar, registrarForaDeContexto: jest.fn() } as unknown as ConstructorParameters<
      typeof MetaService
    >[2],
  );

  return { service, db, graph, registrar, diario };
}

/** Última escrita que mexeu no campo pedido. */
function ultimaEscritaCom(diario: Escrita[], campo: string): Record<string, unknown> | undefined {
  return [...diario].reverse().find((e) => campo in e.valores)?.valores;
}

beforeAll(() => {
  // O serviço loga erro esperado em alguns testes; o ruído não ajuda ninguém.
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterAll(() => jest.restoreAllMocks());

describe('concluirOnboarding — coexistência', () => {
  it('não chama /register e pede as duas sincronizações, nesta ordem', async () => {
    const { service, graph } = montar();

    const r = await service.concluirOnboarding(CONTA, USUARIO, {
      code: 'codigo-de-30-segundos',
      wabaId: 'WABA1',
      phoneNumberId: 'PN1',
      coexistencia: true,
    });

    // A regra que o teste tranca: o app do celular já registrou o número.
    expect(graph.registrarNumero).not.toHaveBeenCalled();

    expect(graph.sincronizarDadosDoApp).toHaveBeenCalledTimes(2);
    expect(graph.sincronizarDadosDoApp).toHaveBeenNthCalledWith(
      1,
      'PN1',
      'smb_app_state_sync',
      TOKEN,
    );
    expect(graph.sincronizarDadosDoApp).toHaveBeenNthCalledWith(2, 'PN1', 'history', TOKEN);

    expect(r.coexistencia).toBe(true);
    // "Registrado" porque o app do celular registrou — não porque nós
    // registramos. Se isto voltasse false, a tela mostraria pendência que o
    // cliente não tem como resolver.
    expect(r.registrado).toBe(true);
  });

  it('marca a sincronização como "sincronizando" e avisa para manter o app aberto', async () => {
    const { service, diario } = montar();

    const r = await service.concluirOnboarding(CONTA, USUARIO, {
      code: 'codigo-de-30-segundos',
      wabaId: 'WABA1',
      phoneNumberId: 'PN1',
      coexistencia: true,
    });

    expect(ultimaEscritaCom(diario, 'sincronizacao')?.sincronizacao).toBe('sincronizando');
    expect(r.pendencias.some((p) => p.includes('WhatsApp Business aberto'))).toBe(true);
  });

  it('descobre o número pela WABA quando a Meta não manda o phone_number_id', async () => {
    const { service, graph } = montar();

    const r = await service.concluirOnboarding(CONTA, USUARIO, {
      code: 'codigo-de-30-segundos',
      wabaId: 'WABA1',
      coexistencia: true,
    });

    expect(r.phoneNumberId).toBe('PN1');
    expect(graph.sincronizarDadosDoApp).toHaveBeenCalledWith('PN1', 'history', TOKEN);
    // Nada de pendência dizendo que o número não foi informado: ele FOI
    // descoberto, e assustar o cliente à toa é defeito de produto.
    expect(r.pendencias.some((p) => p.includes('não informou qual número'))).toBe(false);
  });

  it('sincronização recusada não derruba o onboarding: marca "falhou" e explica', async () => {
    const { service, graph, diario } = montar();
    graph.sincronizarDadosDoApp.mockRejectedValue(new Error('recusado'));

    const r = await service.concluirOnboarding(CONTA, USUARIO, {
      code: 'codigo-de-30-segundos',
      wabaId: 'WABA1',
      phoneNumberId: 'PN1',
      coexistencia: true,
    });

    // A conta continua conectada — perder a conexão inteira porque a cópia
    // falhou seria trocar um problema pequeno por um grande.
    expect(r.wabaId).toBe('WABA1');
    expect(ultimaEscritaCom(diario, 'sincronizacao')?.sincronizacao).toBe('falhou');
    expect(r.pendencias.length).toBeGreaterThan(0);
  });
});

describe('concluirOnboarding — número dedicado', () => {
  it('registra o número e não pede sincronização nenhuma', async () => {
    const { service, graph } = montar();

    const r = await service.concluirOnboarding(CONTA, USUARIO, {
      code: 'codigo-de-30-segundos',
      wabaId: 'WABA1',
      phoneNumberId: 'PN1',
      coexistencia: false,
    });

    expect(graph.registrarNumero).toHaveBeenCalledTimes(1);
    expect(graph.sincronizarDadosDoApp).not.toHaveBeenCalled();
    expect(r.coexistencia).toBe(false);
    expect(r.registrado).toBe(true);
  });

  it('sem o campo `coexistencia`, o padrão é número dedicado', async () => {
    const { service, graph } = montar();

    await service.concluirOnboarding(CONTA, USUARIO, {
      code: 'codigo-de-30-segundos',
      wabaId: 'WABA1',
      phoneNumberId: 'PN1',
    });

    // Fail-closed na direção certa: assumir coexistência por engano pularia o
    // registro e o cliente só descobriria no primeiro disparo, com erro 133010.
    expect(graph.registrarNumero).toHaveBeenCalledTimes(1);
    expect(graph.sincronizarDadosDoApp).not.toHaveBeenCalled();
  });
});

describe('concluirOnboarding — o que vai para a auditoria', () => {
  it('registra o que foi conectado e nunca o token', async () => {
    const { service, registrar } = montar();

    await service.concluirOnboarding(CONTA, USUARIO, {
      code: 'codigo-de-30-segundos',
      wabaId: 'WABA1',
      phoneNumberId: 'PN1',
      coexistencia: true,
    });

    expect(registrar).toHaveBeenCalledTimes(1);
    const entrada = registrar.mock.calls[0][0];
    expect(entrada.acao).toBe('whatsapp.conectado');
    expect(entrada.detalhe).toMatchObject({ wabaId: 'WABA1', coexistencia: true });

    // O teste que importa: o token não pode estar em lugar nenhum do registro.
    expect(JSON.stringify(entrada)).not.toContain(TOKEN);
  });

  it('o token é gravado cifrado, nunca em claro', async () => {
    const { service, diario } = montar();

    await service.concluirOnboarding(CONTA, USUARIO, {
      code: 'codigo-de-30-segundos',
      wabaId: 'WABA1',
      phoneNumberId: 'PN1',
      coexistencia: true,
    });

    const guardado = ultimaEscritaCom(diario, 'tokenCifrado')?.tokenCifrado as string;
    expect(guardado).toBeTruthy();
    expect(guardado).not.toContain(TOKEN);
    expect(guardado.startsWith('v1.')).toBe(true);
  });
});

describe('retomarSincronizacao', () => {
  it('sem token da conta, não chama a Meta e diz por quê', async () => {
    const { service, graph } = montar();

    const estado = await service.retomarSincronizacao(CONTA, 'num-1', 'PN1');

    expect(estado).toBe('sem_token');
    expect(graph.sincronizarDadosDoApp).not.toHaveBeenCalled();
  });
});
