/**
 * A porta MCP inteira, por HTTP, do jeito que o Liame chama: o portão (token,
 * conta, limite), o controlador (o token não passa da porta) e o servidor do SDK
 * oficial (só as ferramentas do escopo, dentro da conta do token, sem telefone
 * nas leituras). Só os serviços das telas e o reconhecimento do token são
 * dublês; o resto é o código que roda em produção, numa app Nest de verdade.
 *
 * É a rede de proteção da F2 do Hub DMS: quando a porta passar a aceitar também
 * o token do DMS ID, estes testes dizem que o token de hoje (`rct_it_`) segue
 * igual.
 */
jest.mock('../../config/env', () => ({ env: {} }));

import {
  ForbiddenException,
  Module,
  NotFoundException,
  UnauthorizedException,
  type INestApplication,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';

import { ErroFilter } from '../../common/erro.filter';
import { ContextoDb } from '../../db/contexto';
import type { ChamadaRegistrada, ErroDoProduto } from '../../dms/integracao-dms';
import { autorDaIntegracao, type AutorDaIntegracao } from '../auditoria/autor-integracao';
import { AvisoService } from '../aviso/aviso.service';
import { CampanhaService } from '../campanha/campanha.service';
import { ContaService } from '../conta/conta.service';
import { ContatoService } from '../contato/contato.service';
import { PublicosService } from '../contato/publicos.service';
import { SegmentacaoService } from '../contato/segmentacao.service';
import { ConversaAnuncioService } from '../meta/anuncio.service';
import { MODELO_APROVADO, MetaService } from '../meta/meta.service';
import { SaudeService } from '../meta/saude.service';
import { ModeloService } from '../modelo/modelo.service';
import { OrcamentoService } from '../orcamento/orcamento.service';
import { HubService } from '../hub/hub.service';
import { DmsIdService } from './dms-id.service';
import { IntegracaoGuard, LIMITE_POR_MINUTO } from './integracao.guard';
import { escoposEfetivos, gerarToken, type ClasseDoToken } from './integracao.regras';
import { IntegracaoService, type IntegracaoAutenticada } from './integracao.service';
import { McpController } from './mcp.controller';
import { FERRAMENTAS, McpServidor } from './mcp.servidor';
import { RegistroDaPorta } from './registro-da-porta.middleware';

// Identificadores visivelmente fictícios: o repositório é público (V34).
const CONTA_ID = '00000000-0000-4000-8000-000000000001';
const CAMPANHA_ID = '00000000-0000-4000-8000-000000000002';
const LISTA_ID = '00000000-0000-4000-8000-000000000003';
const TELEFONE = '+5521900000000';
const NOME_DE_CONTATO = 'Fulana de Teste';

const TODOS_OS_ESCOPOS = [
  'conta.ler',
  'campanhas.ler',
  'publicos.ler',
  'modelos.ler',
  'orcamento.ler',
  'conversas.anuncio.ler',
  'modelos.rascunhar',
  'campanhas.rascunhar',
  'campanhas.disparar',
];
const LEITURAS = ['conta_situacao', 'campanhas_listar', 'campanha_detalhar', 'publicos_listar', 'publico_estimar', 'modelos_listar', 'orcamento_ler'];
const DISPARO = ['campanha_disparo_planejar', 'campanha_disparar', 'campanha_pausar'];
const ARGUMENTOS: Record<string, Record<string, unknown>> = {
  campanha_detalhar: { id: CAMPANHA_ID },
  publico_estimar: { origem: 'base' },
};

/** O que vem junto em cada registro das telas e NUNCA pode sair pela porta (só pela ferramenta de conversas). */
const PESSOAL = { telefone: TELEFONE, contatos: [{ nome: NOME_DE_CONTATO, telefone: TELEFONE }] };

/** Um token como o banco guarda: a classe e os escopos GUARDADOS (o portão aplica `escoposEfetivos`, como o serviço). */
type TokenGuardado = { id: string; classe: ClasseDoToken; nome: string; produto: string; escopos: string[]; revogado?: boolean; contaSuspensa?: boolean };

function servicosDeTela() {
  const resumoCampanha = {
    id: CAMPANHA_ID,
    nome: 'Promoção de teste',
    status: 'concluida',
    pausaMotivo: null,
    modeloNome: 'promo_teste',
    modeloCategoria: 'marketing',
    publicoRotulo: null,
    listaNome: 'Lista de teste',
    total: 10,
    porStatus: { enviada: 2, entregue: 3, lida: 4, falhou: 1 },
    respondidas: 2,
    criadoEm: new Date('2026-10-01T12:00:00Z'),
    iniciadaEm: new Date('2026-10-01T12:05:00Z'),
    concluidaEm: new Date('2026-10-01T13:00:00Z'),
    ...PESSOAL,
  };
  return {
    saude: {
      daConta: jest.fn(async () => ({
        sinal: 'pode_enviar',
        titulo: 'Pode enviar',
        resumo: 'Tudo certo com o número.',
        lidaEm: new Date('2026-10-15T12:00:00Z'),
        itens: [{ rotulo: 'Número', problemas: [], ...PESSOAL }],
        ...PESSOAL,
      })),
    },
    conta: {
      resumo: jest.fn(async () => ({
        conta: { nome: 'Loja de teste', timezone: 'America/Sao_Paulo', ...PESSOAL },
        plano: { nome: 'Plano de teste' },
        assinatura: { status: 'ativa', cicloFim: '2026-11-01T00:00:00.000Z' },
        gratisPeloRegem: false,
        uso: { disparos: 10, teto: 5000, restantes: 4990 },
        ...PESSOAL,
      })),
    },
    campanhas: {
      listar: jest.fn(async () => [resumoCampanha]),
      detalhe: jest.fn(async () => ({
        ...resumoCampanha,
        pausaTexto: null,
        pausaErro: null,
        pausaAte: null,
        espera: null,
        falhasPorMotivo: [{ total: 1, erro: { titulo: 'Número sem WhatsApp', explicacao: 'O número não tem WhatsApp.', acao: null }, ...PESSOAL }],
        custo: null,
        descansoDias: 7,
      })),
      previaDoPublico: jest.fn(async () => ({ total: 8, descanso: { emDescanso: 2, dias: 7 }, custo: null, ...PESSOAL })),
    },
    contatos: { listas: jest.fn(async () => [{ id: LISTA_ID, nome: 'Lista de teste', descricao: null, total: 10, usadaEm: null, ...PESSOAL }]) },
    publicos: { resumo: jest.fn(async () => ({ publicos: [{ id: 'clientes_fieis', nome: 'Clientes fiéis', regra: '3 compras ou mais', total: 4, ...PESSOAL }] })) },
    segmentos: { resumo: jest.fn(async () => ({ segmentos: [{ id: 'novos', nome: 'Novos', regra: 'Primeira compra', total: 3, ...PESSOAL }] })) },
    meta: {
      modelos: jest.fn(async () => [
        {
          id: 'modelo-1',
          nome: 'promo_teste',
          idioma: 'pt_BR',
          categoria: 'MARKETING',
          status: MODELO_APROVADO,
          exige: { semSuporte: [] },
          qualidade: 'GREEN',
          variaveis: 1,
          cabecalho: null,
          corpo: 'Olá, {{1}}! Temos novidades.',
          rodape: null,
          botoes: [],
          alertas: [],
          ...PESSOAL,
        },
      ]),
    },
    orcamento: {
      ler: jest.fn(async () => ({
        moeda: 'BRL',
        tetos: { dia: 1000, semana: null, mes: null },
        periodos: [{ periodo: 'dia', rotulo: 'Hoje', tetoCentavos: 1000, gastoCentavos: 100, percentual: 10, texto: 'R$ 1,00 de R$ 10,00', sinal: 'ok', ...PESSOAL }],
        avisos: [],
        ...PESSOAL,
      })),
    },
    anuncios: { listar: jest.fn(async () => ({ itens: [], proximo_cursor: null, tem_mais: false })) },
    modelos: {},
    avisos: {},
  };
}

type Porta = {
  app: INestApplication;
  base: string;
  servicos: ReturnType<typeof servicosDeTela>;
  contas: string[];
  autores: (AutorDaIntegracao | null)[];
  autenticar: jest.Mock;
  token(guardado: Omit<TokenGuardado, 'id' | 'nome' | 'produto'> & Partial<Pick<TokenGuardado, 'nome' | 'produto'>>): string;
};

async function subirPorta(): Promise<Porta> {
  const servicos = servicosDeTela();
  const contas: string[] = [];
  const autores: (AutorDaIntegracao | null)[] = [];
  // A conta em que cada ferramenta roda, e quem a auditoria veria como autor.
  const ctx = {
    comConta: jest.fn(async (contaId: string, fn: () => Promise<unknown>) => {
      contas.push(contaId);
      autores.push(autorDaIntegracao());
      return fn();
    }),
  };
  const tokens = new Map<string, TokenGuardado>();
  // O reconhecimento do token como o serviço faz: inexistente e revogado dão a MESMA recusa; conta suspensa, 403.
  const autenticar = jest.fn(async (token: string): Promise<IntegracaoAutenticada> => {
    const t = tokens.get(token);
    if (!t || t.revogado) throw new UnauthorizedException('Token de integração inválido ou revogado.');
    if (t.contaSuspensa) throw new ForbiddenException('A conta deste token está suspensa ou cancelada.');
    return {
      tokenId: t.id,
      contaId: CONTA_ID,
      contaNome: 'Loja de teste',
      contaFuso: 'America/Sao_Paulo',
      produto: t.produto,
      classe: t.classe,
      nome: t.nome,
      escopos: escoposEfetivos(t.escopos, t.classe),
    };
  });

  // Um módulo como o IntegracaoModule: o middleware do registro entra depois da leitura do corpo, como em produção.
  @Module({
    controllers: [McpController],
    providers: [
      McpServidor,
      IntegracaoGuard,
      // O de verdade, com o env sem `dmsId`: a via do DMS ID desligada, como nasce em produção.
      DmsIdService,
      // O de verdade, com o env sem `hub`: desligado, como nasce em produção (os testes do hub o espiam).
      HubService,
      { provide: getStorageToken(), useClass: ThrottlerStorageService },
      { provide: IntegracaoService, useValue: { autenticar, revogarPeloProprio: jest.fn() } },
      { provide: ContextoDb, useValue: ctx },
      { provide: SaudeService, useValue: servicos.saude },
      { provide: ContaService, useValue: servicos.conta },
      { provide: CampanhaService, useValue: servicos.campanhas },
      { provide: ContatoService, useValue: servicos.contatos },
      { provide: PublicosService, useValue: servicos.publicos },
      { provide: SegmentacaoService, useValue: servicos.segmentos },
      { provide: MetaService, useValue: servicos.meta },
      { provide: OrcamentoService, useValue: servicos.orcamento },
      { provide: ConversaAnuncioService, useValue: servicos.anuncios },
      { provide: ModeloService, useValue: servicos.modelos },
      { provide: AvisoService, useValue: servicos.avisos },
    ],
  })
  class PortaDeTeste implements NestModule {
    configure(consumidor: MiddlewareConsumer): void {
      consumidor.apply(RegistroDaPorta).forRoutes(McpController);
    }
  }
  const modulo = await Test.createTestingModule({ imports: [PortaDeTeste] }).compile();
  const app = modulo.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ErroFilter());
  await app.listen(0, '127.0.0.1');

  let n = 0;
  return {
    app,
    base: `${await app.getUrl()}/api/v1`,
    servicos,
    contas,
    autores,
    autenticar,
    token(g) {
      n += 1;
      const token = gerarToken();
      tokens.set(token, { id: `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`, nome: 'Liame (teste)', produto: 'liame', ...g });
      return token;
    },
  };
}

/** O corpo que a porta devolve: JSON-RPC do SDK, ou o erro do filtro global (`mensagem`). */
type Corpo = {
  result?: {
    tools?: Array<{ name: string }>;
    structuredContent?: unknown;
    isError?: boolean;
    content?: Array<{ type: string; text: string }>;
  };
  error?: { code: number; message: string };
  mensagem?: string;
};
type Resposta = { status: number; cabecalhos: Headers; texto: string; json: Corpo };

/** Um pedido MCP da revisão 2026-07-28, com os cabeçalhos e o envelope que o conector do Liame manda. */
async function pedir(p: Porta, token: string | null, metodo: string, params: Record<string, unknown> = {}, extra: Record<string, string> = {}): Promise<Resposta> {
  const cabecalhos: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-method': metodo,
    'mcp-protocol-version': '2026-07-28',
    ...extra,
  };
  if (typeof params.name === 'string') cabecalhos['mcp-name'] = params.name;
  if (token !== null) cabecalhos.authorization = extra.authorization ?? `Bearer ${token}`;
  const corpo = {
    jsonrpc: '2.0',
    id: 1,
    method: metodo,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'teste', version: '1' },
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  };
  return enviar(p, cabecalhos, corpo);
}

async function enviar(p: Porta, cabecalhos: Record<string, string>, corpo: unknown, metodoHttp = 'POST'): Promise<Resposta> {
  const r = await fetch(`${p.base}/mcp`, { method: metodoHttp, headers: cabecalhos, body: metodoHttp === 'POST' ? JSON.stringify(corpo) : undefined });
  const texto = await r.text();
  return { status: r.status, cabecalhos: r.headers, texto, json: lerJson(texto, r.headers.get('content-type') ?? '') };
}

/** JSON direto, ou a resposta JSON-RPC dentro de um fluxo SSE. */
function lerJson(texto: string, tipo: string): Corpo {
  let json = texto;
  if (tipo.startsWith('text/event-stream')) {
    const dados = texto.split(/\r?\n/).filter((l) => l.startsWith('data:'));
    json = dados.length ? dados[dados.length - 1]!.slice(5) : '';
  }
  try {
    return JSON.parse(json) as Corpo;
  } catch {
    return {};
  }
}

const chamar = (p: Porta, token: string, nome: string, args: Record<string, unknown> = ARGUMENTOS[nome] ?? {}) =>
  pedir(p, token, 'tools/call', { name: nome, arguments: args });

const nomesDaLista = async (p: Porta, token: string) => {
  const r = await pedir(p, token, 'tools/list');
  expect(r.status).toBe(200);
  return (r.json.result?.tools ?? []).map((t) => t.name).sort();
};

describe('a porta MCP, por HTTP, como o Liame chama', () => {
  let p: Porta;
  beforeEach(async () => {
    p = await subirPorta();
  });
  afterEach(async () => {
    await p.app.close();
  });

  describe('o portão', () => {
    it('sem token: 401 com WWW-Authenticate Bearer, e o banco nem é consultado', async () => {
      const r = await pedir(p, null, 'tools/list');
      expect(r.status).toBe(401);
      expect(r.cabecalhos.get('www-authenticate')).toBe('Bearer');
      expect(r.json.mensagem).toBe('Informe o token de integração no cabeçalho Authorization.');
      expect(p.autenticar).not.toHaveBeenCalled();
    });

    it('o que não tem a cara de um token nosso também não chega ao banco', async () => {
      for (const authorization of ['Bearer abc', 'Bearer rct_it_curto', 'Basic cmN0X2l0Xw==', `Bearer ${gerarToken()} sobra`]) {
        const r = await pedir(p, 'qualquer', 'tools/list', {}, { authorization });
        expect(r.status).toBe(401);
      }
      expect(p.autenticar).not.toHaveBeenCalled();
    });

    it('token inexistente e token revogado: a MESMA resposta 401, com error="invalid_token"', async () => {
      const revogado = p.token({ classe: 'dms', escopos: ['conta.ler'], revogado: true });
      const inexistente = await pedir(p, gerarToken(), 'tools/list');
      const doRevogado = await pedir(p, revogado, 'tools/list');
      expect(inexistente.status).toBe(401);
      expect(inexistente.cabecalhos.get('www-authenticate')).toBe('Bearer error="invalid_token"');
      expect([doRevogado.status, doRevogado.cabecalhos.get('www-authenticate'), doRevogado.texto]).toEqual([
        inexistente.status,
        inexistente.cabecalhos.get('www-authenticate'),
        inexistente.texto,
      ]);
    });

    it('conta suspensa ou cancelada: 403, sem pedir outro token (sem invalid_token)', async () => {
      const r = await pedir(p, p.token({ classe: 'dms', escopos: ['conta.ler'], contaSuspensa: true }), 'tools/list');
      expect(r.status).toBe(403);
      expect(r.cabecalhos.get('www-authenticate')).toBeNull();
      expect(r.json.mensagem).toBe('A conta deste token está suspensa ou cancelada.');
    });

    it(`o limite é por token: a chamada ${LIMITE_POR_MINUTO + 1} do minuto recebe 429 com Retry-After, e outro token segue`, async () => {
      const a = p.token({ classe: 'dms', escopos: ['conta.ler'] });
      const b = p.token({ classe: 'dms', escopos: ['conta.ler'] });
      for (let i = 0; i < LIMITE_POR_MINUTO; i += 1) expect((await pedir(p, a, 'tools/list')).status).toBe(200);
      const passou = await pedir(p, a, 'tools/list');
      expect(passou.status).toBe(429);
      expect(Number(passou.cabecalhos.get('retry-after'))).toBeGreaterThanOrEqual(1);
      expect((await pedir(p, b, 'tools/list')).status).toBe(200);
    });

    it('GET e DELETE: 405 com Allow: POST (servidor sem estado, sem sessão para abrir ou fechar)', async () => {
      for (const metodo of ['GET', 'DELETE']) {
        const r = await enviar(p, { accept: 'application/json, text/event-stream' }, null, metodo);
        expect(r.status).toBe(405);
        expect(r.cabecalhos.get('allow')).toBe('POST');
      }
    });

    it('o corpo que o leitor recusa antes do portão (charset que ele não lê): 415, nunca 500', async () => {
      const token = p.token({ classe: 'dms', escopos: ['conta.ler'] });
      const r = await enviar(
        p,
        { 'content-type': 'application/json; charset=latin1', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      );
      expect(r.status).toBe(415);
      expect(r.json.mensagem).toMatch(/JSON, em UTF-8/);
      expect(p.autenticar).not.toHaveBeenCalled();
    });
  });

  describe('o controlador', () => {
    it('o token e o cookie ficam na porta: o SDK recebe o pedido sem eles e a autorização sem o token em claro', async () => {
      const servidor = p.app.get(McpServidor);
      const original = servidor.handler.fetch.bind(servidor.handler);
      const vistos: { cabecalhos: Headers; token: string | undefined }[] = [];
      jest.spyOn(servidor.handler, 'fetch').mockImplementation((pedido, opcoes) => {
        vistos.push({ cabecalhos: pedido.headers, token: opcoes?.authInfo?.token });
        return original(pedido, opcoes);
      });
      const token = p.token({ classe: 'dms', escopos: ['conta.ler'] });
      const r = await pedir(p, token, 'tools/list', {}, { cookie: 'rc_sessao=nao-pode-passar' });
      expect(r.status).toBe(200);
      expect(vistos).toHaveLength(1);
      const { cabecalhos, token: tokenNoSdk } = vistos[0]!;
      expect(cabecalhos.get('authorization')).toBeNull();
      expect(cabecalhos.get('cookie')).toBeNull();
      expect(cabecalhos.get('mcp-method')).toBe('tools/list');
      expect(tokenNoSdk).toBe('oculto');
      expect(JSON.stringify([...cabecalhos])).not.toContain(token);
    });
  });

  describe('o servidor: o que cada token enxerga', () => {
    it('a lista mostra só o que o escopo libera', async () => {
      expect(await nomesDaLista(p, p.token({ classe: 'dms', escopos: ['conta.ler'] }))).toEqual(['conta_situacao', 'integracao_revogar', 'integracao_situacao']);
      expect(await nomesDaLista(p, p.token({ classe: 'dms', escopos: TODOS_OS_ESCOPOS }))).toEqual(FERRAMENTAS.map((f) => f.nome).sort());
    });

    it('cliente de fora nunca vê o disparo, nem com a permissão gravada no banco (linha adulterada)', async () => {
      const nomes = await nomesDaLista(p, p.token({ classe: 'externo', escopos: TODOS_OS_ESCOPOS }));
      for (const nome of DISPARO) expect(nomes).not.toContain(nome);
      expect(nomes).toContain('campanha_rascunhar');
    });

    it('chamar direto a ferramenta que o token não pode usar: "não encontrada" (-32602), e o serviço nem roda', async () => {
      const r = await chamar(p, p.token({ classe: 'dms', escopos: ['conta.ler'] }), 'orcamento_ler');
      expect(r.status).toBe(200);
      expect(r.json.error?.code).toBe(-32602);
      expect(r.json.error?.message).toMatch(/not found/);
      expect(p.servicos.orcamento.ler).not.toHaveBeenCalled();
      expect(p.contas).toEqual([]);
    });

    it('integracao_situacao diz a conta, o fuso, o produto, a classe e as permissões — e nunca o token', async () => {
      const token = p.token({ classe: 'dms', escopos: ['conta.ler', 'campanhas.ler'] });
      const r = await chamar(p, token, 'integracao_situacao');
      expect(r.status).toBe(200);
      expect(r.json.result?.structuredContent).toEqual({
        contaId: CONTA_ID,
        conta: 'Loja de teste',
        fuso: 'America/Sao_Paulo',
        produto: 'liame',
        classe: 'dms',
        token: 'Liame (teste)',
        permissoes: [
          { id: 'conta.ler', rotulo: 'Situação da conta', descricao: expect.any(String) },
          { id: 'campanhas.ler', rotulo: 'Campanhas e resultados', descricao: expect.any(String) },
        ],
        limitePorMinuto: LIMITE_POR_MINUTO,
      });
      expect(r.texto).not.toContain(token);
      expect(r.texto).not.toContain('rct_it_');
    });
  });

  describe('as leituras', () => {
    it('toda leitura roda dentro da conta do token, com a integração como autora do que for auditado', async () => {
      const token = p.token({ classe: 'dms', escopos: TODOS_OS_ESCOPOS });
      for (const nome of [...LEITURAS, 'conversas_anuncio_listar']) {
        const r = await chamar(p, token, nome);
        expect([nome, r.status, r.json.result?.isError ?? false]).toEqual([nome, 200, false]);
      }
      expect(p.contas).toEqual(Array(LEITURAS.length + 1).fill(CONTA_ID));
      for (const autor of p.autores) {
        expect(autor).toEqual({ tokenId: expect.any(String), produto: 'liame', nome: 'Liame (teste)', classe: 'dms' });
      }
    });

    it('nenhuma leitura devolve telefone nem nome de contato, mesmo quando o serviço da tela traz (só a de conversas, com o escopo dela)', async () => {
      const token = p.token({ classe: 'dms', escopos: TODOS_OS_ESCOPOS });
      for (const nome of LEITURAS) {
        const r = await chamar(p, token, nome);
        expect([nome, r.status]).toEqual([nome, 200]);
        expect([nome, r.texto.includes(TELEFONE), r.texto.includes(NOME_DE_CONTATO)]).toEqual([nome, false, false]);
      }
    });

    it('recusa de regra volta como erro da ferramenta, com a frase do serviço; erro inesperado vira "erro interno", sem o detalhe', async () => {
      const token = p.token({ classe: 'dms', escopos: ['campanhas.ler'] });
      p.servicos.campanhas.detalhe.mockRejectedValueOnce(new NotFoundException('Campanha não encontrada.'));
      const regra = await chamar(p, token, 'campanha_detalhar');
      expect(regra.status).toBe(200);
      expect(regra.json.result?.isError).toBe(true);
      expect(regra.json.result?.content?.[0]?.text).toBe('Campanha não encontrada.');

      p.servicos.campanhas.detalhe.mockRejectedValueOnce(new Error('conexão recusada em 10.0.0.9: senha do banco'));
      const inesperado = await chamar(p, token, 'campanha_detalhar');
      expect(inesperado.json.result?.isError).toBe(true);
      expect(inesperado.json.result?.content?.[0]?.text).toBe('Erro interno. Tente de novo em instantes.');
      expect(inesperado.texto).not.toContain('senha do banco');
    });
  });

  it('cliente da geração 2025 (sem o envelope _meta) é atendido pelo mesmo endereço, também sem estado', async () => {
    const token = p.token({ classe: 'dms', escopos: ['conta.ler'] });
    const r = await enviar(
      p,
      { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: `Bearer ${token}` },
      { jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} },
    );
    expect(r.status).toBe(200);
    expect((r.json.result?.tools ?? []).map((t) => t.name).sort()).toEqual(['conta_situacao', 'integracao_revogar', 'integracao_situacao']);
  });

  describe('o hub da DMS: registro central, chave própria e lista de parada', () => {
    /** O HubService de verdade da porta (desligado), espiado: ligado, guardando o que mandaria ao hub. */
    function ligarHub() {
      const hub = p.app.get(HubService);
      jest.spyOn(hub, 'ligado', 'get').mockReturnValue(true);
      const registros: ChamadaRegistrada[] = [];
      const erros: ErroDoProduto[] = [];
      jest.spyOn(hub, 'registrar').mockImplementation((c) => void registros.push(c));
      jest.spyOn(hub, 'erro').mockImplementation((e) => void erros.push(e));
      return { hub, registros, erros };
    }
    /** O registro sai quando a resposta termina, um instante depois de o cliente ler o corpo. */
    async function esperarRegistros(registros: unknown[], n: number) {
      const fim = Date.now() + 2000;
      while (registros.length < n) {
        if (Date.now() > fim) throw new Error(`esperava ${n} registros, chegaram ${registros.length}`);
        await new Promise((pronto) => setTimeout(pronto, 5));
      }
    }
    const doPedido = (registros: ChamadaRegistrada[], r: Resposta) => registros.find((x) => x.codigo === r.cabecalhos.get('request-id'));

    it('desligado, como nasce: nada vai ao hub, e o pedido ganha o código (request-id)', async () => {
      const registrar = jest.spyOn(p.app.get(HubService), 'registrar');
      const r = await pedir(p, p.token({ classe: 'dms', escopos: ['conta.ler'] }), 'tools/list');
      expect(r.status).toBe(200);
      expect(r.cabecalhos.get('request-id')).toMatch(/^rc_[0-9a-f]{16}$/);
      await new Promise((pronto) => setTimeout(pronto, 50));
      expect(registrar).not.toHaveBeenCalled();
    });

    it('ligado: cada chamada vira um registro com quem chamou, a ferramenta, o resultado e a duração, sem conteúdo', async () => {
      const { registros } = ligarHub();
      const token = p.token({ classe: 'dms', escopos: ['orcamento.ler'] });
      const r = await chamar(p, token, 'orcamento_ler');
      expect(r.status).toBe(200);
      await esperarRegistros(registros, 1);
      expect(registros).toEqual([
        {
          codigo: r.cabecalhos.get('request-id'),
          ocorrido_em: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
          credencial: 'token_integracao',
          ligacao_prefixo: token.slice(0, 15),
          aplicativo: 'liame',
          conta: CONTA_ID,
          conta_nome: 'Loja de teste',
          ferramenta: 'orcamento_ler',
          resultado: 'aceita',
          status_http: 200,
          duracao_ms: expect.any(Number),
        },
      ]);
      const texto = JSON.stringify(registros);
      expect(texto).not.toContain(token);
      expect(texto).not.toContain(TELEFONE);
    });

    it('a recusa do portão é registrada como recusada, com o problema do Padrão', async () => {
      const { registros } = ligarHub();
      const desconhecido = gerarToken();
      const semToken = await pedir(p, null, 'tools/list');
      const inexistente = await pedir(p, desconhecido, 'tools/list');
      const suspensa = await pedir(p, p.token({ classe: 'dms', escopos: ['conta.ler'], contaSuspensa: true }), 'tools/list');
      expect([semToken.status, inexistente.status, suspensa.status]).toEqual([401, 401, 403]);
      await esperarRegistros(registros, 3);
      expect(doPedido(registros, semToken)).toMatchObject({ resultado: 'recusada', problema: 'token-invalido', status_http: 401, ferramenta: 'tools/list' });
      expect(doPedido(registros, semToken)).not.toHaveProperty('ligacao_prefixo');
      expect(doPedido(registros, inexistente)).toMatchObject({ resultado: 'recusada', problema: 'token-invalido', ligacao_prefixo: desconhecido.slice(0, 15) });
      expect(doPedido(registros, inexistente)).not.toHaveProperty('conta');
      expect(doPedido(registros, suspensa)).toMatchObject({ resultado: 'recusada', problema: 'conta-bloqueada', status_http: 403 });
    });

    it('a ferramenta que recusa por regra responde 200 e o registro diz recusada; o erro nosso diz erro e vai à lista de erros com o código do pedido', async () => {
      const { registros, erros } = ligarHub();
      const token = p.token({ classe: 'dms', escopos: ['campanhas.ler'] });
      p.servicos.campanhas.detalhe.mockRejectedValueOnce(new NotFoundException('Campanha não encontrada.'));
      const regra = await chamar(p, token, 'campanha_detalhar');
      p.servicos.campanhas.detalhe.mockRejectedValueOnce(new Error(`falhou ao gravar ${TELEFONE}`));
      const inesperado = await chamar(p, token, 'campanha_detalhar');
      expect([regra.status, inesperado.status]).toEqual([200, 200]);
      await esperarRegistros(registros, 2);
      expect(doPedido(registros, regra)).toMatchObject({ resultado: 'recusada', problema: 'nao-encontrado', status_http: 200, ferramenta: 'campanha_detalhar' });
      expect(doPedido(registros, inesperado)).toMatchObject({ resultado: 'erro', problema: 'erro-interno', status_http: 200 });
      // a mensagem chega crua ao HubService: quem limpa é o cliente do pacote, ao anotar (hub.service.spec.ts)
      expect(erros).toEqual([
        { origem: 'backend', tipo: 'Error', mensagem: `falhou ao gravar ${TELEFONE}`, lugar: 'mcp · campanha_detalhar', codigo: inesperado.cabecalhos.get('request-id') },
      ]);
    });

    it('a ferramenta fora do escopo (o SDK recusa com -32602 dentro do 200): recusada no registro, e a resposta sai igual', async () => {
      const { registros } = ligarHub();
      const r = await chamar(p, p.token({ classe: 'dms', escopos: ['conta.ler'] }), 'orcamento_ler');
      expect(r.status).toBe(200);
      expect(r.json.error?.code).toBe(-32602);
      await esperarRegistros(registros, 1);
      expect(doPedido(registros, r)).toMatchObject({ resultado: 'recusada', problema: 'parametro-invalido', status_http: 200, ferramenta: 'orcamento_ler' });
    });

    it('a chave própria ACEITAR_INTEGRACOES=false: 503 integracao-parada no formato do Padrão, sem ir ao banco', async () => {
      jest.spyOn(p.app.get(HubService), 'aceitaIntegracoes', 'get').mockReturnValue(false);
      const r = await pedir(p, p.token({ classe: 'dms', escopos: ['conta.ler'] }), 'tools/list');
      expect(r.status).toBe(503);
      expect(r.cabecalhos.get('content-type')).toMatch(/^application\/problem\+json/);
      expect(r.cabecalhos.get('retry-after')).toBe('60');
      expect(JSON.parse(r.texto)).toEqual({
        type: 'https://dev.dmstecnologias.com/erros/integracao-parada',
        title: 'Integração parada',
        status: 503,
        detail: 'Esta integração está parada pela DMS no momento. Tente de novo mais tarde.',
        request_id: r.cabecalhos.get('request-id'),
      });
      expect(p.autenticar).not.toHaveBeenCalled();
    });

    it('a lista de parada: a ferramenta parada recusa com 503 e as outras seguem; a parada recebe o aplicativo, o prefixo e a ferramenta', async () => {
      const { hub, registros } = ligarHub();
      const parado = jest
        .spyOn(hub, 'parado')
        .mockImplementation((c) => (c.ferramenta === 'orcamento_ler' ? { nivel: 'ferramenta', produto: 'regemcast', alvo: 'orcamento_ler' } : null));
      const token = p.token({ classe: 'dms', escopos: ['orcamento.ler', 'conta.ler'] });
      const parada = await chamar(p, token, 'orcamento_ler');
      expect(parada.status).toBe(503);
      expect(JSON.parse(parada.texto).type).toMatch(/\/integracao-parada$/);
      expect(p.servicos.orcamento.ler).not.toHaveBeenCalled();
      expect(parado).toHaveBeenCalledWith({ aplicativo: 'liame', ligacaoPrefixo: token.slice(0, 15), ferramenta: 'orcamento_ler' });
      expect((await chamar(p, token, 'conta_situacao')).status).toBe(200);
      await esperarRegistros(registros, 2);
      expect(doPedido(registros, parada)).toMatchObject({ resultado: 'recusada', problema: 'integracao-parada', status_http: 503, ferramenta: 'orcamento_ler' });
    });

    it('a parada da ligação (pelo prefixo do token) e a do aplicativo valem para toda ferramenta', async () => {
      const { hub } = ligarHub();
      const a = p.token({ classe: 'dms', escopos: ['conta.ler'] });
      const b = p.token({ classe: 'dms', escopos: ['conta.ler'] });
      const parado = jest
        .spyOn(hub, 'parado')
        .mockImplementation((c) => (c.ligacaoPrefixo === a.slice(0, 15) ? { nivel: 'ligacao', produto: 'regemcast', alvo: a.slice(0, 15) } : null));
      expect((await pedir(p, a, 'tools/list')).status).toBe(503);
      expect((await pedir(p, b, 'tools/list')).status).toBe(200);
      parado.mockImplementation((c) => (c.aplicativo === 'liame' ? { nivel: 'aplicativo', produto: null, alvo: 'liame' } : null));
      expect((await pedir(p, b, 'tools/list')).status).toBe(503);
    });

    it('o lote da geração 2025: uma ferramenta parada no lote recusa o pedido inteiro', async () => {
      const { hub } = ligarHub();
      jest
        .spyOn(hub, 'parado')
        .mockImplementation((c) => (c.ferramenta === 'campanha_disparar' ? { nivel: 'ferramenta', produto: 'regemcast', alvo: 'campanha_disparar' } : null));
      const token = p.token({ classe: 'dms', escopos: TODOS_OS_ESCOPOS });
      const r = await enviar(
        p,
        { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: `Bearer ${token}` },
        [
          { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'orcamento_ler', arguments: {} } },
          { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'campanha_disparar', arguments: {} } },
        ],
      );
      expect(r.status).toBe(503);
      expect(p.servicos.orcamento.ler).not.toHaveBeenCalled();
    });
  });
});
