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
import { BadRequestException, Logger } from '@nestjs/common';

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

import { cifrarToken } from './cripto';
import { traduzirErroMeta } from './erros-meta';
import { ErroGraph } from './graph.service';
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
    negocioDaWaba: jest.fn().mockResolvedValue('3237068579769279'),
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
    modelosDaWaba: jest.fn().mockResolvedValue({ data: [] }),
  };

  const registrar = jest.fn().mockResolvedValue(undefined);
  const agenda = { decidirNaConexao: jest.fn().mockResolvedValue(undefined) };

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
    agenda as unknown as ConstructorParameters<typeof MetaService>[3],
  );

  return { service, db, graph, registrar, diario, agenda };
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

describe('concluirOnboarding — a resposta sobre contatos e conversas', () => {
  it('é gravada ANTES do pedido de sincronização', async () => {
    const { service, graph, agenda } = montar();

    const r = await service.concluirOnboarding(CONTA, USUARIO, {
      code: 'codigo-de-30-segundos',
      wabaId: 'WABA1',
      phoneNumberId: 'PN1',
      coexistencia: true,
      integrar: true,
    });

    expect(agenda.decidirNaConexao).toHaveBeenCalledWith(expect.anything(), 'num-1', true, USUARIO);
    // A agenda só começa a chegar depois do pedido; a resposta tem de estar
    // gravada antes, senão o primeiro lote chegaria sem saber o que fazer.
    const ordemDaResposta = agenda.decidirNaConexao.mock.invocationCallOrder[0];
    const ordemDoPedido = graph.sincronizarDadosDoApp.mock.invocationCallOrder[0];
    expect(ordemDaResposta).toBeLessThan(ordemDoPedido);
    expect(r.integrarConversas).toBe(true);
  });

  it('"não" também é resposta — e o pedido de sincronização sai mesmo assim', async () => {
    const { service, graph, agenda } = montar();

    const r = await service.concluirOnboarding(CONTA, USUARIO, {
      code: 'codigo-de-30-segundos',
      wabaId: 'WABA1',
      phoneNumberId: 'PN1',
      coexistencia: true,
      integrar: false,
    });

    expect(agenda.decidirNaConexao).toHaveBeenCalledWith(expect.anything(), 'num-1', false, USUARIO);
    // Sem o pedido, a Meta desfaz a conexão em 24 horas. O "não" decide o
    // que guardamos, não se pedimos.
    expect(graph.sincronizarDadosDoApp).toHaveBeenCalledTimes(2);
    expect(r.integrarConversas).toBe(false);
  });

  it('sem resposta, nada é decidido: o cartão do número pergunta depois', async () => {
    const { service, agenda } = montar();

    const r = await service.concluirOnboarding(CONTA, USUARIO, {
      code: 'codigo-de-30-segundos',
      wabaId: 'WABA1',
      phoneNumberId: 'PN1',
      coexistencia: true,
    });

    expect(agenda.decidirNaConexao).not.toHaveBeenCalled();
    expect(r.integrarConversas).toBeNull();
  });

  it('número dedicado ignora a resposta: não há agenda de celular', async () => {
    const { service, agenda } = montar();

    const r = await service.concluirOnboarding(CONTA, USUARIO, {
      code: 'codigo-de-30-segundos',
      wabaId: 'WABA1',
      phoneNumberId: 'PN1',
      coexistencia: false,
      integrar: true,
    });

    expect(agenda.decidirNaConexao).not.toHaveBeenCalled();
    expect(r.integrarConversas).toBeNull();
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

describe('token inválido (190) — o erro precisa dizer de quem é a culpa', () => {
  /**
   * Defeito real, visto em produção: `ErroGraph` não é `HttpException`, então o
   * filtro global o convertia em 500 "algo deu errado do nosso lado" — que é
   * falso. A falha era token vencido, conserto de dez segundos, e a mensagem
   * mandava investigar o servidor.
   */
  function tokenVencido() {
    return new ErroGraph({ status: 401, codigo: 190, traduzido: traduzirErroMeta(190) });
  }

  it('no Embedded Signup vira 400 com explicação, não 500 mudo', async () => {
    const { service, graph } = montar();
    graph.dadosDaWaba.mockRejectedValue(tokenVencido());

    await expect(
      service.concluirOnboarding(CONTA, USUARIO, {
        code: 'codigo-de-30-segundos',
        wabaId: 'WABA1',
        phoneNumberId: 'PN1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('na conexão manual também, e a mensagem chega inteira a quem opera', async () => {
    const { service, db, diario, graph } = montar();
    db.select.mockReturnValueOnce(consulta([{ id: CONTA }], diario));
    graph.dadosDaWaba.mockRejectedValue(tokenVencido());

    const erro = await service
      .conectarManual(CONTA, { wabaId: 'WABA1', phoneNumberId: 'PN1', token: TOKEN })
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(BadRequestException);
    // Não basta ser 400: a frase precisa dizer o que fazer. Erro que só diz
    // "deu ruim" custa o mesmo tempo de investigação que erro nenhum.
    expect((erro as BadRequestException).message).toContain('conta de WhatsApp');
  });
});

describe('conectarManual — a porta da distribuição', () => {
  it('recusa conta inexistente sem falar com a Meta', async () => {
    const { service, graph } = montar();

    await expect(
      service.conectarManual(CONTA, { wabaId: 'WABA1', token: TOKEN }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // A ordem importa: validar a conta ANTES de qualquer chamada externa. Do
    // contrário, um contaId errado viraria tráfego para a Meta em nome de
    // ninguém — e o erro só apareceria depois, confuso.
    expect(graph.dadosDaWaba).not.toHaveBeenCalled();
    expect(graph.assinarWebhook).not.toHaveBeenCalled();
  });

  it('conecta sem Embedded Signup e audita como sistema', async () => {
    const { service, db, diario, registrar, graph } = montar();
    db.select.mockReturnValueOnce(consulta([{ id: CONTA }], diario));

    const r = await service.conectarManual(CONTA, {
      wabaId: 'WABA1',
      phoneNumberId: 'PN1',
      token: TOKEN,
    });

    // Nenhum `code` é trocado: o token já veio pronto.
    expect(graph.trocarCodePorToken).not.toHaveBeenCalled();
    // Mas o resto do caminho é o mesmo do signup — webhook assinado inclusive.
    expect(graph.assinarWebhook).toHaveBeenCalledWith('WABA1', TOKEN);
    expect(r.wabaId).toBe('WABA1');

    const entrada = registrar.mock.calls[0][0];
    expect(entrada.atorTipo).toBe('sistema');
    expect(entrada.atorUsuarioId).toBeNull();
    expect(JSON.stringify(entrada)).not.toContain(TOKEN);
  });

  it('não inventa prazo de validade para um token informado à mão', async () => {
    const { service, db, diario } = montar();
    db.select.mockReturnValueOnce(consulta([{ id: CONTA }], diario));

    await service.conectarManual(CONTA, {
      wabaId: 'WABA1',
      phoneNumberId: 'PN1',
      token: TOKEN,
    });

    // Chutar uma data seria pior que não ter: o aviso de vencimento na tela
    // passaria a mentir, e o cliente confiaria nele.
    expect(ultimaEscritaCom(diario, 'tokenExpiraEm')?.tokenExpiraEm).toBeNull();
  });

  it('o token informado é cifrado antes de tocar o banco', async () => {
    const { service, db, diario } = montar();
    db.select.mockReturnValueOnce(consulta([{ id: CONTA }], diario));

    await service.conectarManual(CONTA, {
      wabaId: 'WABA1',
      phoneNumberId: 'PN1',
      token: TOKEN,
    });

    const guardado = ultimaEscritaCom(diario, 'tokenCifrado')?.tokenCifrado as string;
    expect(guardado).not.toContain(TOKEN);
    expect(guardado.startsWith('v1.')).toBe(true);
  });
});

describe('jaRegistrado — número que a Meta já registrou', () => {
  it('pula o /register e marca o número como pronto', async () => {
    const { service, db, diario, graph } = montar();
    db.select.mockReturnValueOnce(consulta([{ id: CONTA }], diario));

    const r = await service.conectarManual(CONTA, {
      wabaId: 'WABA1',
      phoneNumberId: 'PN1',
      token: TOKEN,
      jaRegistrado: true,
    });

    // Chamar /register num número já registrado devolve erro de PIN, e a tela
    // passaria a mostrar "Registro pendente" num número que envia normalmente.
    expect(graph.registrarNumero).not.toHaveBeenCalled();
    expect(r.registrado).toBe(true);
    expect(ultimaEscritaCom(diario, 'status')?.status).toBe('registrado');
  });

  it('sem a declaração, tenta registrar como sempre', async () => {
    const { service, db, diario, graph } = montar();
    db.select.mockReturnValueOnce(consulta([{ id: CONTA }], diario));

    await service.conectarManual(CONTA, {
      wabaId: 'WABA1',
      phoneNumberId: 'PN1',
      token: TOKEN,
    });

    // O padrão é o comportamento antigo: quem não declara nada não ganha
    // atalho. Um "já registrado" implícito esconderia número realmente pendente.
    expect(graph.registrarNumero).toHaveBeenCalledTimes(1);
  });

  it('a declaração fica na trilha de auditoria', async () => {
    const { service, db, diario, registrar } = montar();
    db.select.mockReturnValueOnce(consulta([{ id: CONTA }], diario));

    await service.conectarManual(CONTA, {
      wabaId: 'WABA1',
      phoneNumberId: 'PN1',
      token: TOKEN,
      jaRegistrado: true,
    });

    // É declaração de quem conectou, não fato verificado por nós. Se um dia um
    // número aparecer pronto sem estar, é aqui que se descobre quem disse.
    expect(registrar.mock.calls[0][0].detalhe).toMatchObject({
      jaRegistradoDeclarado: true,
    });
  });
});

describe('modelos de mensagem', () => {
  /** Linha de `wa_conta` como o `tokenDaConta` espera encontrar. */
  function contaConectada() {
    return {
      tokenCifrado: cifrarToken(TOKEN, Buffer.alloc(32, 7).toString('base64')),
      wabaId: 'WABA1',
    };
  }

  it('conta o MAIOR índice de variável, não quantas vezes aparecem', async () => {
    const { service, db, diario, graph } = montar();
    db.select.mockReturnValueOnce(consulta([contaConectada()], diario));
    graph.modelosDaWaba.mockResolvedValue({
      data: [
        {
          id: '1',
          name: 'promo',
          language: 'pt_BR',
          status: 'APPROVED',
          category: 'MARKETING',
          components: [
            { type: 'BODY', text: 'Oi {{1}}, o pedido {{2}} chegou. Até logo, {{1}}!' },
          ],
        },
      ],
    });

    const [m] = await service.modelos(CONTA);

    /*
     * Três ocorrências, duas variáveis. Contar ocorrências faria o disparo
     * mandar três valores e a Meta recusar com 132000 — defeito que existe no
     * Regem e que este teste impede de atravessar para cá.
     */
    expect(m!.variaveis).toBe(2);
  });

  it('traduz status e categoria para português', async () => {
    const { service, db, diario, graph } = montar();
    db.select.mockReturnValueOnce(consulta([contaConectada()], diario));
    graph.modelosDaWaba.mockResolvedValue({
      data: [
        {
          id: '1',
          name: 'aviso',
          language: 'pt_BR',
          status: 'PENDING',
          category: 'UTILITY',
          components: [{ type: 'BODY', text: 'Seu pedido saiu para entrega.' }],
        },
      ],
    });

    const [m] = await service.modelos(CONTA);

    expect(m!.status).toBe('em análise');
    expect(m!.categoria).toBe('utilidade');
    expect(m!.variaveis).toBe(0);
  });

  it('status novo da Meta aparece cru, em vez de virar "desconhecido"', async () => {
    const { service, db, diario, graph } = montar();
    db.select.mockReturnValueOnce(consulta([contaConectada()], diario));
    graph.modelosDaWaba.mockResolvedValue({
      data: [{ id: '1', name: 'x', status: 'ALGO_QUE_A_META_INVENTOU', components: [] }],
    });

    const [m] = await service.modelos(CONTA);

    // Esconder informação atrás de "desconhecido" não ajuda ninguém a agir;
    // mostrar o nome cru é feio e verdadeiro.
    expect(m!.status).toBe('algo_que_a_meta_inventou');
  });

  it('cabeçalho de mídia diz o formato, já que não tem texto', async () => {
    const { service, db, diario, graph } = montar();
    db.select.mockReturnValueOnce(consulta([contaConectada()], diario));
    graph.modelosDaWaba.mockResolvedValue({
      data: [
        {
          id: '1',
          name: 'banner',
          components: [
            { type: 'HEADER', format: 'IMAGE' },
            { type: 'BODY', text: 'Promoção da semana' },
            { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Ver ofertas' }] },
          ],
        },
      ],
    });

    const [m] = await service.modelos(CONTA);

    expect(m!.cabecalho).toBe('(image)');
    expect(m!.botoes).toEqual(['Ver ofertas']);
  });

  it('sem conta conectada, explica em vez de estourar', async () => {
    const { service, graph } = montar();

    await expect(service.modelos(CONTA)).rejects.toBeInstanceOf(BadRequestException);
    expect(graph.modelosDaWaba).not.toHaveBeenCalled();
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

/**
 * A página de pagamento da conta na Meta. O endereço precisa do negócio dono
 * da conta (`business_id`), que ficou sem ser guardado até 01/10/2026 — por
 * isso a tela do WhatsApp descobre na primeira abertura, e nunca cai por isso.
 */
describe('o negócio dono da conta e o endereço do pagamento', () => {
  const lida = (extra: Record<string, unknown> = {}) => ({
    wabaId: '1578591514280771',
    nome: 'Padaria Aurora',
    moeda: null,
    statusRevisao: 'APPROVED',
    conectadaEm: null,
    webhookAssinadoEm: null,
    tokenExpiraEm: null,
    businessId: null,
    ...extra,
  });
  const ENDERECO =
    'https://business.facebook.com/billing_hub/accounts/details/?business_id=3237068579769279&asset_id=1578591514280771&account_type=whatsapp-business-account';

  it('a conexão guarda o negócio que o Embedded Signup devolveu, sem perguntar à Meta', async () => {
    const { service, graph, diario } = montar();

    await service.concluirOnboarding(CONTA, USUARIO, {
      code: 'codigo-de-30-segundos',
      wabaId: 'WABA1',
      phoneNumberId: 'PN1',
      businessId: '999888777',
    });

    expect(ultimaEscritaCom(diario, 'businessId')?.businessId).toBe('999888777');
    expect(graph.negocioDaWaba).not.toHaveBeenCalled();
  });

  it('sem o negócio no signup, pergunta à Meta — e a conexão não cai se ela não responder', async () => {
    const { service, graph, diario } = montar();
    graph.negocioDaWaba.mockRejectedValue(new Error('campo recusado'));

    const r = await service.concluirOnboarding(CONTA, USUARIO, { code: 'codigo-de-30-segundos', wabaId: 'WABA1', phoneNumberId: 'PN1' });

    expect(r.wabaId).toBe('WABA1');
    expect(graph.negocioDaWaba).toHaveBeenCalledWith('WABA1', TOKEN);
    expect(ultimaEscritaCom(diario, 'businessId')?.businessId).toBeNull();
  });

  it('situação: com o negócio guardado, devolve o endereço e não chama a Meta', async () => {
    const { service, db, graph, diario } = montar();
    db.select
      .mockReturnValueOnce(consulta([lida({ businessId: '3237068579769279' })], diario))
      .mockReturnValueOnce(consulta([], diario));

    const r = await service.situacao(CONTA);

    expect(r.conectado && r.conta.pagamentoUrl).toBe(ENDERECO);
    expect(graph.negocioDaWaba).not.toHaveBeenCalled();
    // O identificador do negócio não vai para a tela: ela só precisa do endereço.
    expect(JSON.stringify(r)).not.toContain('businessId');
  });

  it('situação: conta antiga, sem o negócio — pergunta à Meta uma vez, guarda e devolve o endereço', async () => {
    const { service, db, graph, diario } = montar();
    db.select
      .mockReturnValueOnce(consulta([lida()], diario)) // a conta
      .mockReturnValueOnce(consulta([{ tokenCifrado: cifrarToken(TOKEN, Buffer.alloc(32, 7).toString('base64')), wabaId: '1578591514280771' }], diario)) // o token
      .mockReturnValueOnce(consulta([], diario)); // os números

    const r = await service.situacao(CONTA);

    expect(graph.negocioDaWaba).toHaveBeenCalledWith('1578591514280771', TOKEN);
    expect(ultimaEscritaCom(diario, 'businessId')?.businessId).toBe('3237068579769279');
    expect(r.conectado && r.conta.pagamentoUrl).toBe(ENDERECO);
  });

  it('situação: a Meta não responde — a tela abre do mesmo jeito, só sem o botão', async () => {
    const { service, db, graph, diario } = montar();
    graph.negocioDaWaba.mockRejectedValue(new Error('tempo esgotado'));
    db.select
      .mockReturnValueOnce(consulta([lida()], diario))
      .mockReturnValueOnce(consulta([{ tokenCifrado: cifrarToken(TOKEN, Buffer.alloc(32, 7).toString('base64')), wabaId: '1578591514280771' }], diario))
      .mockReturnValueOnce(consulta([], diario));

    const r = await service.situacao(CONTA);

    expect(r.conectado).toBe(true);
    expect(r.conectado && r.conta.pagamentoUrl).toBeNull();
    expect(diario.some((e) => 'businessId' in e.valores)).toBe(false);
  });

  it('pagamentoUrl (para o erro da campanha): só o que está guardado, sem chamar a Meta', async () => {
    const { service, db, graph, diario } = montar();
    db.select.mockReturnValueOnce(consulta([{ wabaId: '1578591514280771', businessId: '3237068579769279' }], diario));
    expect(await service.pagamentoUrl(CONTA)).toBe(ENDERECO);

    db.select.mockReturnValueOnce(consulta([{ wabaId: '1578591514280771', businessId: null }], diario));
    expect(await service.pagamentoUrl(CONTA)).toBeNull();

    db.select.mockReturnValueOnce(consulta([], diario));
    expect(await service.pagamentoUrl(CONTA)).toBeNull();
    expect(graph.negocioDaWaba).not.toHaveBeenCalled();
  });
});
