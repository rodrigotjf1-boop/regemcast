/**
 * A via do DMS ID da porta MCP (Hub DMS, F2, etapa A2), por HTTP, numa app Nest
 * de verdade: o portão, o filtro do Padrão, os metadados do recurso e a troca.
 *
 * O DMS ID é de mentira, mas assina de verdade (ES384, a chave EC P-384 que o
 * Logto usa) e publica as chaves num servidor HTTP: o token é conferido pelo
 * código de produção (`DmsIdService` com o pacote comum). Só o banco é dublê —
 * e o dublê decide com as MESMAS regras do serviço (`ligacao.regras.ts`); o SQL
 * do serviço tem o teste dele com Postgres (`integracao.ligacao.pg.spec.ts`).
 *
 * O primeiro teste roda o kit de conformidade do hub (`scripts/dms/`, cópia
 * igual à do hub) contra a porta: é a prova que o Padrão pede antes de abrir.
 */
jest.mock('../../config/env', () => ({ env: { dmsId: { ligado: true, emissor: '', recurso: '', aplicativos: {} } } }));

import { Module, UnauthorizedException, type INestApplication, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ErroFilter } from '../../common/erro.filter';
import { env } from '../../config/env';
import { ContextoDb } from '../../db/contexto';
import { ErroProblema, gerarChave, prefixoVisivel, type ChamadaRegistrada } from '../../dms/integracao-dms';
import { autorDaIntegracao, type AutorDaIntegracao } from '../auditoria/autor-integracao';
import { AvisoService } from '../aviso/aviso.service';
import { CampanhaService } from '../campanha/campanha.service';
import { ContaService } from '../conta/conta.service';
import { ContatoService } from '../contato/contato.service';
import { PublicosService } from '../contato/publicos.service';
import { SegmentacaoService } from '../contato/segmentacao.service';
import { ConversaAnuncioService } from '../meta/anuncio.service';
import { MetaService } from '../meta/meta.service';
import { SaudeService } from '../meta/saude.service';
import { ModeloService } from '../modelo/modelo.service';
import { OrcamentoService } from '../orcamento/orcamento.service';
import { HubService } from '../hub/hub.service';
import { DmsIdController } from './dms-id.controller';
import { DmsIdService } from './dms-id.service';
import { IntegracaoGuard, LIMITE_POR_MINUTO } from './integracao.guard';
import { escoposEfetivos, gerarToken } from './integracao.regras';
import { IntegracaoService, type IntegracaoAutenticada } from './integracao.service';
import { CAMINHO_DO_MANIFESTO, CAMINHO_DOS_METADADOS, LIGACAO_INVALIDA, ligacaoVale, permissoesDaLigacao, ROTAS_FORA_DO_PREFIXO, TROCA_RECUSADA } from './ligacao.regras';
import { ManifestoController } from './manifesto.controller';
import { manifestoDaPorta, PORTA_MCP } from './manifesto';
import { McpController } from './mcp.controller';
import { McpServidor } from './mcp.servidor';
import { RegistroDaPorta } from './registro-da-porta.middleware';

// Identificadores visivelmente fictícios: o repositório é público.
const CONTA_ID = '00000000-0000-4000-8000-000000000001';
const APP_A = 'aplicativo-a-de-teste';
const APP_B = 'aplicativo-b-de-teste';
const KIT = join(__dirname, '..', '..', '..', 'scripts', 'dms', 'kit-conformidade.mts');
const COPIA_DO_PACOTE = join(__dirname, '..', '..', 'dms', 'integracao-dms.ts');
const ARQUIVO_DO_MANIFESTO = join(__dirname, '..', '..', '..', '..', 'docs', 'dms-manifesto.json');

const configDmsId = env.dmsId as { ligado: boolean; emissor: string; recurso: string; aplicativos: Record<string, string> };

/** O DMS ID de mentira: a chave ES384, as chaves públicas por HTTP e a emissão do token. */
type DmsIdFalso = {
  servidor: Server;
  emissor: string;
  emitir(o: { aplicativo?: string; scope?: string; destino?: string; expiraEmSeg?: number }): string;
};

async function subirDmsIdFalso(): Promise<DmsIdFalso> {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-384' });
  const kid = 'chave-de-teste';
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'ES384' };
  const servidor = createServer((req, res) => {
    if (req.url !== '/oidc/jwks') {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto));
  const emissor = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/oidc`;
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return {
    servidor,
    emissor,
    emitir({ aplicativo = APP_A, scope = 'orcamento.ler conta.ler', destino, expiraEmSeg = 3600 }) {
      const agora = Math.floor(Date.now() / 1000);
      const cabeca = b64({ alg: 'ES384', typ: 'at+jwt', kid });
      const corpo = b64({ iss: emissor, aud: destino ?? configDmsId.recurso, sub: aplicativo, client_id: aplicativo, scope, iat: agora, exp: agora + expiraEmSeg, jti: randomUUID() });
      const assinatura = sign('sha384', Buffer.from(`${cabeca}.${corpo}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      return `${cabeca}.${corpo}.${assinatura}`;
    },
  };
}

/** Uma ligação como o banco guarda. */
type LigacaoGuardada = { id: string; aplicativo: string; classe: string; escopos: string[]; revogadoEm: Date | null; contaSuspensa?: boolean };

function orcamento() {
  return {
    ler: jest.fn(async () => ({
      moeda: 'BRL',
      tetos: { dia: 1000, semana: null, mes: null },
      periodos: [{ periodo: 'dia', rotulo: 'Hoje', tetoCentavos: 1000, gastoCentavos: 100, percentual: 10, texto: 'R$ 1,00 de R$ 10,00', sinal: 'ok' }],
      avisos: [],
    })),
  };
}

type Porta = {
  app: INestApplication;
  origem: string;
  contas: string[];
  autores: (AutorDaIntegracao | null)[];
  trocar: jest.Mock;
  ligacao(l: Omit<LigacaoGuardada, 'id' | 'revogadoEm'> & Partial<Pick<LigacaoGuardada, 'id' | 'revogadoEm'>>): string;
  token(id: string, escopos: string[], revogado?: boolean): string;
};

async function subirPorta(): Promise<Porta> {
  const contas: string[] = [];
  const autores: (AutorDaIntegracao | null)[] = [];
  const ctx = {
    comConta: jest.fn(async (contaId: string, fn: () => Promise<unknown>) => {
      contas.push(contaId);
      autores.push(autorDaIntegracao());
      return fn();
    }),
  };
  const ligacoes = new Map<string, LigacaoGuardada>();
  const tokens = new Map<string, { id: string; escopos: string[]; revogado: boolean }>();
  const quem = (id: string, escopos: string[]): IntegracaoAutenticada => ({
    tokenId: id,
    contaId: CONTA_ID,
    contaNome: 'Loja de teste',
    contaFuso: 'America/Sao_Paulo',
    produto: 'liame',
    classe: 'dms',
    nome: 'Liame (teste)',
    escopos,
  });
  // As decisões do serviço, com as regras dele: ligação que não vale dá SEMPRE a mesma recusa.
  const autenticarLigacao = jest.fn(async (segredo: string | null, doToken: { aplicativo: string; permissoes: string[] }, aplicativos: Record<string, string>) => {
    const l = segredo ? ligacoes.get(segredo) : undefined;
    if (!ligacaoVale(l, doToken.aplicativo, aplicativos)) throw new ErroProblema('ligacao-invalida', LIGACAO_INVALIDA);
    if (l.contaSuspensa) throw new ErroProblema('conta-bloqueada', 'A conta desta ligação está suspensa ou cancelada.');
    return quem((l as LigacaoGuardada).id, permissoesDaLigacao(l, doToken.permissoes));
  });
  const autenticar = jest.fn(async (token: string) => {
    const t = tokens.get(token);
    if (!t || t.revogado) throw new UnauthorizedException('Token de integração inválido ou revogado.');
    return quem(t.id, escoposEfetivos(t.escopos, 'dms'));
  });
  const trocar = jest.fn();

  // Um módulo como o IntegracaoModule: o middleware do registro entra depois da leitura do corpo, como em produção.
  @Module({
    controllers: [McpController, DmsIdController, ManifestoController],
    providers: [
      McpServidor,
      IntegracaoGuard,
      DmsIdService,
      // O de verdade, com o env sem `hub`: desligado, como nasce em produção (os testes da parada o espiam).
      HubService,
      { provide: getStorageToken(), useClass: ThrottlerStorageService },
      { provide: IntegracaoService, useValue: { autenticar, autenticarLigacao, trocarPorLigacao: trocar, revogarPeloProprio: jest.fn() } },
      { provide: ContextoDb, useValue: ctx },
      { provide: OrcamentoService, useValue: orcamento() },
      ...[SaudeService, ContaService, CampanhaService, ContatoService, PublicosService, SegmentacaoService, MetaService, ConversaAnuncioService, ModeloService, AvisoService].map(
        (provide) => ({ provide, useValue: {} }),
      ),
    ],
  })
  class PortaDeTeste implements NestModule {
    configure(consumidor: MiddlewareConsumer): void {
      consumidor.apply(RegistroDaPorta).forRoutes(McpController);
    }
  }
  const modulo = await Test.createTestingModule({ imports: [PortaDeTeste] }).compile();
  const app = modulo.createNestApplication({ logger: false });
  // Como no main.ts: os metadados e o manifesto fora do prefixo.
  app.setGlobalPrefix('api/v1', { exclude: ROTAS_FORA_DO_PREFIXO });
  app.useGlobalFilters(new ErroFilter());
  await app.listen(0, '127.0.0.1');
  const origem = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  configDmsId.recurso = `${origem}/api/v1/mcp`;

  let n = 0;
  const novoId = () => `00000000-0000-4000-9000-${String((n += 1)).padStart(12, '0')}`;
  return {
    app,
    origem,
    contas,
    autores,
    trocar,
    ligacao(l) {
      const { chave } = gerarChave('lg', 'regemcast');
      ligacoes.set(chave, { id: novoId(), revogadoEm: null, ...l });
      return chave;
    },
    token(id, escopos, revogado = false) {
      const token = gerarToken();
      tokens.set(token, { id, escopos, revogado });
      return token;
    },
  };
}

type Resposta = { status: number; tipo: string; cabecalhos: Headers; corpo: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function chamarMcp(p: Porta, o: { token?: string; ligacao?: string; metodo?: string; nome?: string }): Promise<Resposta> {
  const metodo = o.metodo ?? 'tools/call';
  const cabecalhos: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-method': metodo,
    'mcp-protocol-version': PORTA_MCP.versao,
  };
  if (o.nome) cabecalhos['mcp-name'] = o.nome;
  if (o.token !== undefined) cabecalhos.authorization = `Bearer ${o.token}`;
  if (o.ligacao !== undefined) cabecalhos['DMS-Ligacao'] = o.ligacao;
  const params: Record<string, unknown> = {
    _meta: {
      'io.modelcontextprotocol/protocolVersion': PORTA_MCP.versao,
      'io.modelcontextprotocol/clientInfo': { name: 'teste', version: '1' },
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  };
  if (o.nome) Object.assign(params, { name: o.nome, arguments: {} });
  const r = await fetch(`${p.origem}/api/v1/mcp`, { method: 'POST', headers: cabecalhos, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: metodo, params }) });
  return ler(r);
}

async function ler(r: globalThis.Response): Promise<Resposta> {
  const texto = await r.text();
  const tipo = r.headers.get('content-type') ?? '';
  let json = texto;
  if (tipo.startsWith('text/event-stream')) json = texto.split(/\r?\n/).filter((l) => l.startsWith('data:')).pop()?.slice(5) ?? '';
  let corpo: unknown = null;
  try {
    corpo = json ? JSON.parse(json) : null;
  } catch {
    corpo = texto;
  }
  return { status: r.status, tipo, cabecalhos: r.headers, corpo };
}

/** Roda o kit do hub (Node com a remoção de tipos) e devolve o código de saída e o que ele imprimiu. */
function rodarKit(config: unknown, credenciais: Record<string, string>): Promise<{ codigo: number | null; saida: string }> {
  const pasta = mkdtempSync(join(tmpdir(), 'kit-dms-'));
  const arquivo = join(pasta, 'config.json');
  writeFileSync(arquivo, JSON.stringify(config));
  return new Promise((pronto) => {
    const filho = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', KIT, arquivo], {
      env: { ...process.env, ...credenciais },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let saida = '';
    filho.stdout.on('data', (d) => (saida += d));
    filho.stderr.on('data', (d) => (saida += d));
    filho.on('close', (codigo) => {
      rmSync(pasta, { recursive: true, force: true });
      pronto({ codigo, saida });
    });
  });
}

describe('a porta MCP pela via do DMS ID', () => {
  let dmsId: DmsIdFalso;
  let p: Porta;

  beforeAll(async () => {
    dmsId = await subirDmsIdFalso();
  });
  afterAll(async () => {
    await new Promise((fim) => dmsId.servidor.close(fim));
  });
  beforeEach(async () => {
    Object.assign(configDmsId, { ligado: true, emissor: dmsId.emissor, aplicativos: { liame: APP_A, gogem: APP_B } });
    p = await subirPorta();
  });
  afterEach(async () => {
    await p.app.close();
  });

  it('passa no kit de conformidade do hub, no modo do DMS ID', async () => {
    const config = {
      modo: 'dms_id',
      produto: 'regemcast',
      base: p.origem,
      porta: 'mcp',
      leitura: {
        caminho: '/api/v1/mcp',
        permissao: 'orcamento.ler',
        cabecalhos: { 'mcp-method': 'tools/call', 'mcp-name': 'orcamento_ler', 'mcp-protocol-version': PORTA_MCP.versao },
        corpo: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'orcamento_ler',
            arguments: {},
            _meta: {
              'io.modelcontextprotocol/protocolVersion': PORTA_MCP.versao,
              'io.modelcontextprotocol/clientInfo': { name: 'kit-dms', version: '1' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        },
      },
      limite: { chamadas: LIMITE_POR_MINUTO + 1 },
      copiaDoPacote: COPIA_DO_PACOTE,
      credenciais: {
        token: 'KIT_TOKEN',
        ligacao: 'KIT_LIGACAO',
        tokenOutroDestino: 'KIT_TOKEN_OUTRO_DESTINO',
        tokenVencido: 'KIT_TOKEN_VENCIDO',
        tokenSemPermissao: 'KIT_TOKEN_SEM_PERMISSAO',
        tokenOutroAplicativo: 'KIT_TOKEN_OUTRO_APLICATIVO',
        ligacaoRevogada: 'KIT_LIGACAO_REVOGADA',
        ligacaoSemPermissao: 'KIT_LIGACAO_SEM_PERMISSAO',
      },
    };
    const r = await rodarKit(config, {
      KIT_TOKEN: dmsId.emitir({}),
      KIT_LIGACAO: p.ligacao({ aplicativo: APP_A, classe: 'dms', escopos: ['conta.ler', 'orcamento.ler'] }),
      KIT_TOKEN_OUTRO_DESTINO: dmsId.emitir({ destino: 'https://outro-produto.exemplo.test/api/v1/mcp' }),
      KIT_TOKEN_VENCIDO: dmsId.emitir({ expiraEmSeg: -120 }),
      KIT_TOKEN_SEM_PERMISSAO: dmsId.emitir({ scope: '' }),
      KIT_TOKEN_OUTRO_APLICATIVO: dmsId.emitir({ aplicativo: APP_B }),
      KIT_LIGACAO_REVOGADA: p.ligacao({ aplicativo: APP_A, classe: 'dms', escopos: ['orcamento.ler'], revogadoEm: new Date('2026-10-01T00:00:00Z') }),
      KIT_LIGACAO_SEM_PERMISSAO: p.ligacao({ aplicativo: APP_A, classe: 'dms', escopos: ['conta.ler'] }),
    });
    const linhas = r.saida.split(/\r?\n/).filter((l) => /^[✔✘–] /.test(l));
    expect({ codigo: r.codigo, falhas: linhas.filter((l) => l.startsWith('✘')), saida: linhas.length ? '' : r.saida }).toEqual({ codigo: 0, falhas: [], saida: '' });
    // As 17 conferências do modo com a porta MCP, todas com ✔. Puladas, só as opcionais do kit da 0.7.2: as três da parte F
    // da F4 (a classe, a ligação suspensa e a parada) e as sete que são da porta REST (a conta, o cursor e a escrita).
    expect(linhas.filter((l) => l.startsWith('✔'))).toHaveLength(17);
    expect(linhas.filter((l) => l.startsWith('–')).map((l) => l.split(':')[0])).toEqual([
      '– dmsid-acima-da-classe',
      '– dmsid-ligacao-suspensa',
      '– dmsid-parada-ligada',
      '– dmsid-mesma-conta-ve',
      '– dmsid-outra-conta-nao-ve',
      '– dmsid-cursor-invalido',
      '– dmsid-cursor-de-outra-conta',
      '– dmsid-escrita-sem-idempotencia',
      '– dmsid-idempotencia-repete',
      '– dmsid-idempotencia-outro-corpo',
    ]);
  }, 60_000);

  it('o manifesto da porta (Padrão §13): sem credencial, fora do prefixo, o mesmo que o código monta', async () => {
    const r = await fetch(`${p.origem}/${CAMINHO_DO_MANIFESTO}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/json');
    expect(r.headers.get('cache-control')).toContain('max-age=300');
    expect(await r.json()).toEqual(JSON.parse(JSON.stringify(manifestoDaPorta())));
    // fora do prefixo: debaixo de /api/v1 ele não existe
    expect((await fetch(`${p.origem}/api/v1/${CAMINHO_DO_MANIFESTO}`)).status).toBe(404);
  });

  it('passa no kit de conformidade do hub, no modo do manifesto: pela porta, sem credencial, e pelo arquivo do repositório', async () => {
    for (const fonte of [{ base: p.origem }, { arquivo: ARQUIVO_DO_MANIFESTO }]) {
      const r = await rodarKit({ modo: 'manifesto', produto: 'regemcast', ...fonte, copiaDoPacote: COPIA_DO_PACOTE }, {});
      const linhas = r.saida.split(/\r?\n/).filter((l) => /^[✔✘–] /.test(l));
      expect({ fonte, codigo: r.codigo, falhas: linhas.filter((l) => l.startsWith('✘')), saida: r.codigo === 0 ? '' : r.saida }).toEqual({ fonte, codigo: 0, falhas: [], saida: '' });
      expect(linhas.map((l) => l.split(':')[0])).toEqual(['✔ copia-do-pacote', '✔ manifesto-chega', '✔ manifesto-formato', '✔ manifesto-do-produto']);
    }
  }, 60_000);

  it('a ferramenta roda na conta da ligação, com o id dela como autor, e só com as permissões que a ligação E o token têm', async () => {
    const ligacao = p.ligacao({ aplicativo: APP_A, classe: 'dms', escopos: ['orcamento.ler', 'campanhas.ler'] });
    const token = dmsId.emitir({ scope: 'orcamento.ler conta.ler' });

    const lista = await chamarMcp(p, { token, ligacao, metodo: 'tools/list' });
    expect(lista.status).toBe(200);
    expect((lista.corpo.result.tools as Array<{ name: string }>).map((t) => t.name).sort()).toEqual(['integracao_revogar', 'integracao_situacao', 'orcamento_ler']);

    const r = await chamarMcp(p, { token, ligacao, nome: 'orcamento_ler' });
    expect(r.status).toBe(200);
    expect(r.corpo.result.isError).toBeUndefined();
    expect(p.contas).toEqual([CONTA_ID]);
    expect(p.autores[0]).toEqual(expect.objectContaining({ tokenId: '00000000-0000-4000-9000-000000000001', produto: 'liame' }));
  });

  it('nem o token nem o segredo da ligação passam da porta para o SDK', async () => {
    const fetchDoSdk = jest.spyOn(p.app.get(McpServidor).handler, 'fetch');
    const ligacao = p.ligacao({ aplicativo: APP_A, classe: 'dms', escopos: ['orcamento.ler'] });
    await chamarMcp(p, { token: dmsId.emitir({}), ligacao, nome: 'orcamento_ler' });
    const pedido = fetchDoSdk.mock.calls[0]![0] as Request;
    expect(pedido.headers.get('authorization')).toBeNull();
    expect(pedido.headers.get('dms-ligacao')).toBeNull();
    expect(pedido.headers.get('mcp-method')).toBe('tools/call');
  });

  it('o limite por minuto é um só pelas duas vias: a ligação herda o id do token', async () => {
    const id = '00000000-0000-4000-9000-000000000099';
    const rctIt = p.token(id, ['orcamento.ler']);
    for (let i = 0; i < LIMITE_POR_MINUTO; i += 1) {
      const r = await chamarMcp(p, { token: rctIt, metodo: 'tools/list' });
      expect(r.status).toBe(200);
    }
    const ligacao = p.ligacao({ id, aplicativo: APP_A, classe: 'dms', escopos: ['orcamento.ler'] });
    const r = await chamarMcp(p, { token: dmsId.emitir({}), ligacao, metodo: 'tools/list' });
    expect(r.status).toBe(429);
    expect(r.tipo).toMatch(/^application\/problem\+json/);
    expect(r.corpo).toEqual(expect.objectContaining({ type: 'https://dev.dmstecnologias.com/erros/limite-de-chamadas', status: 429 }));
    expect(Number(r.cabecalhos.get('retry-after'))).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('sem token, o desafio vai sem código de erro (RFC 6750); com o token torto, invalid_token', async () => {
    const ligacao = p.ligacao({ aplicativo: APP_A, classe: 'dms', escopos: ['orcamento.ler'] });
    const metadados = `resource_metadata="${p.origem}/${CAMINHO_DOS_METADADOS}"`;

    const semToken = await chamarMcp(p, { ligacao, nome: 'orcamento_ler' });
    expect(semToken.status).toBe(401);
    expect(semToken.cabecalhos.get('www-authenticate')).toMatch(new RegExp(`^Bearer ${metadados.replace(/[.?/]/g, '\\$&')}, scope="conta\\.ler `));
    expect(semToken.cabecalhos.get('www-authenticate')).not.toContain('error=');

    const torto = await chamarMcp(p, { token: 'nao.e.token', ligacao, nome: 'orcamento_ler' });
    expect(torto.status).toBe(401);
    expect(torto.cabecalhos.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it('conta suspensa: 403 conta-bloqueada, no formato do Padrão', async () => {
    const ligacao = p.ligacao({ aplicativo: APP_A, classe: 'dms', escopos: ['orcamento.ler'], contaSuspensa: true });
    const r = await chamarMcp(p, { token: dmsId.emitir({}), ligacao, nome: 'orcamento_ler' });
    expect(r.status).toBe(403);
    expect(r.corpo.type).toBe('https://dev.dmstecnologias.com/erros/conta-bloqueada');
  });

  it('com a via ligada, o rct_it_ segue com as respostas de sempre', async () => {
    const ok = await chamarMcp(p, { token: p.token('00000000-0000-4000-9000-000000000050', ['orcamento.ler']), nome: 'orcamento_ler' });
    expect(ok.status).toBe(200);
    expect(ok.corpo.result.isError).toBeUndefined();

    const revogado = await chamarMcp(p, { token: p.token('00000000-0000-4000-9000-000000000051', ['orcamento.ler'], true), nome: 'orcamento_ler' });
    expect(revogado.status).toBe(401);
    expect(revogado.cabecalhos.get('www-authenticate')).toBe('Bearer error="invalid_token"');
    expect(revogado.corpo).toEqual({ mensagem: 'Token de integração inválido ou revogado.' });
  });

  it('os metadados do recurso saem na raiz do domínio, apontando o DMS ID, e não debaixo de /api/v1', async () => {
    const r = await ler(await fetch(`${p.origem}/${CAMINHO_DOS_METADADOS}`));
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({
      resource: `${p.origem}/api/v1/mcp`,
      authorization_servers: [dmsId.emissor],
      scopes_supported: expect.arrayContaining(['orcamento.ler', 'campanhas.disparar']),
      bearer_methods_supported: ['header'],
      resource_name: 'RegemCast (porta MCP)',
    });
    expect(r.corpo.scopes_supported).toHaveLength(9);
    expect((await fetch(`${p.origem}/api/v1/${CAMINHO_DOS_METADADOS}`)).status).toBe(404);
  });

  describe('a troca do rct_it_ pela ligação', () => {
    const trocar = (o: { token?: string; corpo?: unknown }) =>
      fetch(`${p.origem}/api/v1/dms-id/ligacao`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) },
        body: JSON.stringify(o.corpo ?? {}),
      }).then(ler);

    it('com o token do DMS ID válido, entrega o que o serviço devolve, sem cache', async () => {
      const entregue = { ligacao: 'dms_lg_regemcast_x', prefixo: 'dms_lg_regemcast_x', conta_id: CONTA_ID, conta: 'Loja de teste', permissoes: ['orcamento.ler'], segredo_em: '2026-10-16T00:00:00.000Z' };
      p.trocar.mockResolvedValue(entregue);
      const rctIt = gerarToken();
      const r = await trocar({ token: dmsId.emitir({}), corpo: { token_integracao: rctIt } });
      expect(r.status).toBe(200);
      expect(r.corpo).toEqual(entregue);
      expect(r.cabecalhos.get('cache-control')).toBe('no-store');
      expect(p.trocar).toHaveBeenCalledWith(rctIt, APP_A, { liame: APP_A, gogem: APP_B });
    });

    it('sem token, ou com o token sem permissão do RegemCast: recusa antes de chegar ao serviço', async () => {
      const semToken = await trocar({ corpo: { token_integracao: gerarToken() } });
      expect(semToken.status).toBe(401);
      expect(semToken.corpo.type).toBe('https://dev.dmstecnologias.com/erros/token-invalido');
      expect(semToken.cabecalhos.get('www-authenticate')).toContain('resource_metadata="');
      expect(semToken.cabecalhos.get('www-authenticate')).not.toContain('error=');

      const semPermissao = await trocar({ token: dmsId.emitir({ scope: '' }), corpo: { token_integracao: gerarToken() } });
      expect(semPermissao.status).toBe(403);
      expect(semPermissao.corpo.type).toBe('https://dev.dmstecnologias.com/erros/escopo-insuficiente');
      expect(p.trocar).not.toHaveBeenCalled();
    });

    it('a recusa do serviço sai no formato do Padrão, com o desafio', async () => {
      p.trocar.mockRejectedValue(new ErroProblema('ligacao-invalida', TROCA_RECUSADA));
      const r = await trocar({ token: dmsId.emitir({}), corpo: { token_integracao: 'qualquer' } });
      expect(r.status).toBe(401);
      expect(r.tipo).toMatch(/^application\/problem\+json/);
      expect(r.corpo).toEqual({ type: 'https://dev.dmstecnologias.com/erros/ligacao-invalida', title: 'Ligação inválida', status: 401, detail: TROCA_RECUSADA });
      expect(r.cabecalhos.get('www-authenticate')).toContain('resource_metadata="');
    });
  });

  describe('o hub da DMS pela via do DMS ID', () => {
    it('ligado, o registro leva a credencial dms_id e o prefixo visível da ligação, nunca o segredo nem o token', async () => {
      const hub = p.app.get(HubService);
      jest.spyOn(hub, 'ligado', 'get').mockReturnValue(true);
      const registros: ChamadaRegistrada[] = [];
      jest.spyOn(hub, 'registrar').mockImplementation((c) => void registros.push(c));
      const ligacao = p.ligacao({ aplicativo: APP_A, classe: 'dms', escopos: ['orcamento.ler'] });
      const token = dmsId.emitir({});
      const r = await chamarMcp(p, { token, ligacao, nome: 'orcamento_ler' });
      expect(r.status).toBe(200);
      const fim = Date.now() + 2000;
      while (!registros.length && Date.now() < fim) await new Promise((pronto) => setTimeout(pronto, 5));
      expect(registros).toHaveLength(1);
      expect(registros[0]).toMatchObject({
        codigo: r.cabecalhos.get('request-id'),
        credencial: 'dms_id',
        ligacao_prefixo: prefixoVisivel(ligacao),
        aplicativo: 'liame',
        ferramenta: 'orcamento_ler',
        resultado: 'aceita',
        status_http: 200,
      });
      expect(JSON.stringify(registros)).not.toContain(ligacao);
      expect(JSON.stringify(registros)).not.toContain(token);
    });

    it('a parada da ligação (pelo prefixo dms_lg_…) e a chave própria recusam com 503 integracao-parada e o request_id', async () => {
      const hub = p.app.get(HubService);
      const ligacao = p.ligacao({ aplicativo: APP_A, classe: 'dms', escopos: ['orcamento.ler'] });
      const outra = p.ligacao({ aplicativo: APP_A, classe: 'dms', escopos: ['orcamento.ler'] });
      const token = dmsId.emitir({});
      const parado = jest
        .spyOn(hub, 'parado')
        .mockImplementation((c) => (c.ligacaoPrefixo === prefixoVisivel(ligacao) ? { nivel: 'ligacao', produto: 'regemcast', alvo: prefixoVisivel(ligacao) } : null));
      const r = await chamarMcp(p, { token, ligacao, nome: 'orcamento_ler' });
      expect(r.status).toBe(503);
      expect(r.tipo).toMatch(/^application\/problem\+json/);
      expect(r.corpo).toMatchObject({ type: 'https://dev.dmstecnologias.com/erros/integracao-parada', status: 503, request_id: r.cabecalhos.get('request-id') });
      expect(parado).toHaveBeenCalledWith({ aplicativo: 'liame', ligacaoPrefixo: prefixoVisivel(ligacao), ferramenta: 'orcamento_ler' });
      expect((await chamarMcp(p, { token, ligacao: outra, nome: 'orcamento_ler' })).status).toBe(200);

      jest.spyOn(hub, 'aceitaIntegracoes', 'get').mockReturnValue(false);
      const desligada = await chamarMcp(p, { token, ligacao: outra, nome: 'orcamento_ler' });
      expect(desligada.status).toBe(503);
      expect(desligada.cabecalhos.get('retry-after')).toBe('60');
      expect(desligada.corpo.type).toBe('https://dev.dmstecnologias.com/erros/integracao-parada');
    });
  });

  it('desligada, a via some: metadados e troca em 404, e a porta volta à recusa de sempre sem token', async () => {
    configDmsId.ligado = false;
    expect((await fetch(`${p.origem}/${CAMINHO_DOS_METADADOS}`)).status).toBe(404);
    expect((await fetch(`${p.origem}/api/v1/dms-id/ligacao`, { method: 'POST' })).status).toBe(404);

    const ligacao = p.ligacao({ aplicativo: APP_A, classe: 'dms', escopos: ['orcamento.ler'] });
    const r = await chamarMcp(p, { token: dmsId.emitir({}), ligacao, nome: 'orcamento_ler' });
    expect(r.status).toBe(401);
    expect(r.cabecalhos.get('www-authenticate')).toBe('Bearer');
    expect(r.corpo).toEqual({ mensagem: 'Informe o token de integração no cabeçalho Authorization.' });
  });
});
