/**
 * A autorização por clique do Hub DMS (B1) de ponta a ponta, por HTTP, numa app
 * Nest com os controladores e o serviço de verdade, contra o Postgres de verdade
 * (como `regemcast_app`, com a RLS valendo):
 *
 * o pedido empurrado (com o token do DMS ID) → a página → a senha (com a trava)
 * → o código → a troca → a ligação, e o que pode dar errado em cada passo: pedido
 * vencido ou usado, quem não é o dono, outra empresa, código reutilizado (desliga
 * a ligação), verificador errado, corrida de duas trocas, pedir mais permissões.
 *
 * O DMS ID é de mentira mas assina de verdade (ES384). A sessão do Regemcast é
 * um guarda de teste que põe o usuário no pedido; o resto (interceptador da
 * conta, filtros, validação) é o de produção.
 *
 * Precisa de um banco DESCARTÁVEL com as migrations; sem as duas variáveis, pula
 * (o CI não tem banco): REGEMCAST_TESTE_PG_URL (como regemcast_app) e
 * REGEMCAST_TESTE_PG_SUPER (o dono do banco, só para montar contas).
 * Identificadores visivelmente fictícios: o repositório é público (V34).
 */
jest.mock('../../config/env', () => ({
  env: {
    dmsId: { ligado: true, emissor: '', recurso: 'https://castapi.exemplo/api/v1/mcp', aplicativos: { liame: 'aplicativo-a-de-teste', gogem: 'aplicativo-b-de-teste' } },
    autorizacao: { ligada: true, empresa: 'Empresa Exemplo Ltda', cnpj: '33444555000100', enderecosDeVolta: { liame: ['https://liame.exemplo/v1/oauth/callback'] } },
    rede: { apiUrl: 'https://castapi.exemplo', appUrl: 'https://cast.exemplo' },
  },
}));

import { Injectable, ValidationPipe, type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';

import { ErroFilter } from '../../common/erro.filter';
import { PUBLICO } from '../../common/publico.decorator';
import { env } from '../../config/env';
import { ContextoDb } from '../../db/contexto';
import { ContextoInterceptor } from '../../db/contexto.interceptor';
import * as schema from '../../db/schema';
import { ErroProblema } from '../../dms/integracao-dms';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { gerarHashSenha } from '../auth/argon2';
import { HubService } from '../hub/hub.service';
import { AutorizacaoPortaController } from './autorizacao-porta.controller';
import { AutorizacaoController } from './autorizacao.controller';
import { AutorizacaoService } from './autorizacao.service';
import { AvisoDeLigacao } from './aviso-de-ligacao.service';
import { DmsIdService } from './dms-id.service';
import { IntegracaoService } from './integracao.service';

const URL_APP = process.env.REGEMCAST_TESTE_PG_URL;
const URL_SUPER = process.env.REGEMCAST_TESTE_PG_SUPER;
const descrever = URL_APP && URL_SUPER ? describe : describe.skip;

const APP_A = 'aplicativo-a-de-teste';
const APP_B = 'aplicativo-b-de-teste';
const VOLTA = 'https://liame.exemplo/v1/oauth/callback';
const SENHA = 'senha-certa-de-teste';
const NECESSARIAS = 'conta.ler campanhas.ler publicos.ler modelos.ler orcamento.ler';
const TODAS_DO_TOKEN = 'conta.ler campanhas.ler publicos.ler modelos.ler orcamento.ler conversas.anuncio.ler';

const configDmsId = env.dmsId as { emissor: string };
const configAutorizacao = env.autorizacao as { ligada: boolean };

/** A sessão do Regemcast nos testes: o usuário vem num cabeçalho. Rota pública passa sem ele. */
@Injectable()
class SessaoDeTeste implements CanActivate {
  constructor(private readonly refletor: Reflector) {}
  canActivate(contexto: ExecutionContext): boolean {
    if (this.refletor.getAllAndOverride<boolean>(PUBLICO, [contexto.getHandler(), contexto.getClass()])) return true;
    const req = contexto.switchToHttp().getRequest<{ headers: Record<string, string>; usuario?: unknown }>();
    const bruto = req.headers['x-usuario-teste'];
    if (!bruto) return false;
    req.usuario = JSON.parse(bruto);
    return true;
  }
}

async function subirDmsIdFalso(): Promise<{ servidor: Server; emitir(o?: { aplicativo?: string; scope?: string; destino?: string }): string }> {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-384' });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'chave-de-teste', use: 'sig', alg: 'ES384' };
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
  configDmsId.emissor = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/oidc`;
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return {
    servidor,
    emitir({ aplicativo = APP_A, scope = TODAS_DO_TOKEN, destino = 'https://castapi.exemplo/api/v1/mcp' } = {}) {
      const agora = Math.floor(Date.now() / 1000);
      const cabeca = b64({ alg: 'ES384', typ: 'at+jwt', kid: 'chave-de-teste' });
      const corpo = b64({ iss: configDmsId.emissor, aud: destino, sub: aplicativo, client_id: aplicativo, scope, iat: agora, exp: agora + 600, jti: randomUUID() });
      const assinatura = sign('sha384', Buffer.from(`${cabeca}.${corpo}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      return `${cabeca}.${corpo}.${assinatura}`;
    },
  };
}

descrever('a autorização por clique, por HTTP, no Postgres', () => {
  let poolApp: Pool;
  let poolSuper: Pool;
  let ctx: ContextoDb;
  let app: INestApplication;
  let origem: string;
  let dmsId: Awaited<ReturnType<typeof subirDmsIdFalso>>;
  let hashDaSenha: string;
  const hub = { aceitaIntegracoes: true, ligado: false, parado: jest.fn((): unknown => null) };
  const avisos = { ligacaoPorClique: jest.fn(async () => undefined), ligacaoMigrada: jest.fn(async () => undefined) };

  beforeAll(async () => {
    poolApp = new Pool({ connectionString: URL_APP, max: 8 });
    poolSuper = new Pool({ connectionString: URL_SUPER, max: 2 });
    ctx = new ContextoDb(drizzle(poolApp, { schema }));
    dmsId = await subirDmsIdFalso();
    hashDaSenha = await gerarHashSenha(SENHA);

    const modulo = await Test.createTestingModule({
      controllers: [AutorizacaoController, AutorizacaoPortaController],
      providers: [
        AutorizacaoService,
        DmsIdService,
        { provide: ContextoDb, useValue: ctx },
        { provide: AuditoriaService, useValue: new AuditoriaService(ctx) },
        { provide: HubService, useValue: hub },
        { provide: AvisoDeLigacao, useValue: avisos },
        { provide: APP_GUARD, useClass: SessaoDeTeste },
        { provide: APP_INTERCEPTOR, useClass: ContextoInterceptor },
      ],
    }).compile();
    app = modulo.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }));
    app.useGlobalFilters(new ErroFilter());
    await app.listen(0, '127.0.0.1');
    origem = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  });
  afterAll(async () => {
    await app?.close();
    dmsId?.servidor.close();
    await poolApp?.end();
    await poolSuper?.end();
  });
  beforeEach(() => {
    hub.parado.mockReturnValue(null);
    hub.aceitaIntegracoes = true;
    configAutorizacao.ligada = true;
    avisos.ligacaoPorClique.mockClear();
  });

  // ------------------------------------------------------------------ ajudantes

  type Pessoa = { id: string; contaId: string; nome: string; email: string; papel: 'dono' | 'operador'; escopo: 'web' };

  async function novaConta(cnpj: string | null = '11222333000100'): Promise<{ contaId: string; dono: Pessoa; operador: Pessoa }> {
    const contaId = randomUUID();
    // Um CNPJ, uma conta (índice único): cada conta do teste ganha o dela, fictício, quando pede.
    const cnpjDaConta = cnpj === '11222333000100' ? `9${randomBytes(6).readUIntBE(0, 6).toString().padStart(13, '0').slice(0, 13)}` : cnpj;
    await poolSuper.query('insert into conta (id, nome, status, cnpj) values ($1, $2, $3, $4)', [contaId, 'Hamburgueria Exemplo', 'ativa', cnpjDaConta]);
    const pessoa = async (papel: 'dono' | 'operador', nome: string): Promise<Pessoa> => {
      const id = randomUUID();
      const email = `${papel}-${id.slice(0, 8)}@exemplo.test`;
      await poolSuper.query('insert into usuario (id, conta_id, nome, email, senha_hash, papel, status) values ($1, $2, $3, $4, $5, $6, $7)', [id, contaId, nome, email, hashDaSenha, papel, 'ativo']);
      return { id, contaId, nome, email, papel, escopo: 'web' };
    };
    return { contaId, dono: await pessoa('dono', 'Paulo Exemplo'), operador: await pessoa('operador', 'Bia Exemplo') };
  }

  async function cnpjDa(contaId: string): Promise<string | null> {
    return (await poolSuper.query('select cnpj from conta where id = $1', [contaId])).rows[0]?.cnpj ?? null;
  }

  function pkce() {
    const verificador = randomBytes(32).toString('base64url');
    return { verificador, desafio: createHash('sha256').update(verificador).digest('base64url') };
  }

  async function postar(caminho: string, corpo: Record<string, string>, token?: string) {
    return fetch(`${origem}${caminho}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: new URLSearchParams(corpo).toString(),
    });
  }

  async function pedir(o: { scope?: string; cnpj?: string | null; token?: string } = {}) {
    const { verificador, desafio } = pkce();
    const state = `estado-${randomUUID()}`;
    const r = await postar(
      '/integracao/autorizacao/pedido',
      {
        response_type: 'code',
        client_id: APP_A,
        redirect_uri: VOLTA,
        scope: o.scope ?? `${NECESSARIAS} conversas.anuncio.ler`,
        state,
        code_challenge: desafio,
        code_challenge_method: 'S256',
        conta_nome: 'Hamburgueria Exemplo',
        conta_cnpj: o.cnpj ?? '',
        conta_email: 'quem.pede@exemplo.test',
      },
      o.token ?? dmsId.emitir(),
    );
    expect(r.status).toBe(201);
    const { request_uri } = (await r.json()) as { request_uri: string };
    return { requestUri: request_uri, verificador, state };
  }

  const tela = async (quem: Pessoa, requestUri: string, clientId = APP_A) =>
    fetch(`${origem}/integracoes/autorizacao?${new URLSearchParams({ client_id: clientId, request_uri: requestUri })}`, { headers: { 'x-usuario-teste': JSON.stringify(quem) } });

  const autorizar = async (quem: Pessoa, requestUri: string, o: { senha?: string; opcionais?: string[]; confirmo?: boolean } = {}) =>
    fetch(`${origem}/integracoes/autorizacao`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-usuario-teste': JSON.stringify(quem) },
      body: JSON.stringify({ clientId: APP_A, requestUri, senha: o.senha ?? SENHA, opcionais: o.opcionais ?? [], confirmoOutraEmpresa: o.confirmo ?? false }),
    });

  async function autorizado(quem: Pessoa, requestUri: string, o: { opcionais?: string[]; confirmo?: boolean } = {}) {
    const r = await autorizar(quem, requestUri, o);
    expect(r.status).toBe(200);
    const volta = new URL(((await r.json()) as { redirect: string }).redirect);
    return { volta, code: volta.searchParams.get('code')!, state: volta.searchParams.get('state')!, iss: volta.searchParams.get('iss')! };
  }

  const trocar = async (code: string, verificador: string, o: { redirect?: string; token?: string } = {}) =>
    postar('/integracao/autorizacao/token', { grant_type: 'authorization_code', code, code_verifier: verificador, redirect_uri: o.redirect ?? VOLTA, client_id: APP_A }, o.token ?? dmsId.emitir());

  async function ligado(quem: Pessoa, o: { scope?: string; opcionais?: string[] } = {}) {
    const p = await pedir({ scope: o.scope, cnpj: await cnpjDa(quem.contaId) });
    const a = await autorizado(quem, p.requestUri, { opcionais: o.opcionais });
    const r = await trocar(a.code, p.verificador);
    expect(r.status).toBe(200);
    return { ...p, ...a, entregue: (await r.json()) as { ligacao: string; conta_id: string; permissoes: string[] } };
  }

  const ligacoesAtivas = async (contaId: string) =>
    (await poolSuper.query('select * from integracao_ligacao where conta_id = $1 and revogado_em is null', [contaId])).rows as Record<string, unknown>[];

  const servico = () => new IntegracaoService(ctx, new AuditoriaService(ctx));

  // ------------------------------------------------------------------ o pedido

  describe('o pedido empurrado', () => {
    it('com o token do DMS ID, em formulário, devolve o número (uso único, 10 minutos) e guarda só o resumo dele', async () => {
      const { requestUri } = await pedir();
      expect(requestUri).toMatch(/^urn:ietf:params:oauth:request_uri:rct_[A-Za-z0-9_-]{43}$/);
      const linhas = await poolSuper.query("select * from integracao_pedido where aplicativo = $1 and criado_em > now() - interval '1 minute'", [APP_A]);
      expect(linhas.rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(linhas.rows)).not.toContain(requestUri);
    });

    it('sem token: 401 em problem+json, com o desafio do Bearer', async () => {
      const r = await postar('/integracao/autorizacao/pedido', { response_type: 'code' });
      expect(r.status).toBe(401);
      expect(r.headers.get('content-type')).toContain('application/problem+json');
      expect(r.headers.get('www-authenticate')).toMatch(/^Bearer /);
    });

    it('token emitido para outro destino: 401; aplicativo que não usa a página: 401 cliente-invalido; campo errado: 400', async () => {
      expect((await postar('/integracao/autorizacao/pedido', { response_type: 'code' }, dmsId.emitir({ destino: 'https://outro.exemplo/api/v1/mcp' }))).status).toBe(401);
      const fora = await postar('/integracao/autorizacao/pedido', { response_type: 'code' }, dmsId.emitir({ aplicativo: APP_B }));
      expect(fora.status).toBe(401);
      expect(((await fora.json()) as { type: string }).type).toMatch(/cliente-invalido$/);
      const torto = await postar('/integracao/autorizacao/pedido', { response_type: 'code', redirect_uri: 'https://outro.exemplo/volta' }, dmsId.emitir());
      expect(torto.status).toBe(400);
      expect(((await torto.json()) as { detail: string }).detail).toMatch(/redirect_uri/);
    });

    it('desligada: 404; aplicativo parado pela DMS: 503 integracao-parada', async () => {
      configAutorizacao.ligada = false;
      expect((await postar('/integracao/autorizacao/pedido', {}, dmsId.emitir())).status).toBe(404);
      configAutorizacao.ligada = true;
      hub.parado.mockReturnValue({ alvo: 'aplicativo' });
      const parado = await postar('/integracao/autorizacao/pedido', { response_type: 'code' }, dmsId.emitir());
      expect(parado.status).toBe(503);
      expect(((await parado.json()) as { type: string }).type).toMatch(/integracao-parada$/);
    });
  });

  // ------------------------------------------------------------------ a página

  describe('a página', () => {
    it('para o dono, mostra a tela inteira; a conta que pede com o mesmo CNPJ não é outra empresa', async () => {
      const { contaId, dono } = await novaConta();
      const { requestUri } = await pedir({ cnpj: await cnpjDa(contaId) });
      const r = await tela(dono, requestUri);
      expect(r.status).toBe(200);
      const corpo = (await r.json()) as { situacao: string; tela: { titulo: string; contaQuePede: { outraEmpresa: boolean }; necessarias: unknown[]; opcionais: { id: string }[]; aplicativo: { empresa: string } } };
      expect(corpo.situacao).toBe('escolha');
      expect(corpo.tela.titulo).toBe('O Liame quer acessar a sua conta do Regemcast');
      expect(corpo.tela.contaQuePede.outraEmpresa).toBe(false);
      expect(corpo.tela.necessarias).toHaveLength(5);
      expect(corpo.tela.opcionais.map((o) => o.id)).toEqual(['conversas.anuncio.ler']);
      expect(corpo.tela.aplicativo.empresa).toBe('Empresa Exemplo Ltda');
    });

    it('quem não é o dono vê a recusa com o nome do dono; pedido torto ou de outro aplicativo é inválido; parado é pausado', async () => {
      const { dono, operador } = await novaConta();
      const { requestUri } = await pedir();
      expect(await (await tela(operador, requestUri)).json()).toEqual(expect.objectContaining({ situacao: 'nao_dono', dono: 'Paulo Exemplo' }));
      expect(await (await tela(dono, `${requestUri}x`)).json()).toEqual({ situacao: 'invalido', aplicativo: expect.objectContaining({ nome: 'Liame' }) });
      expect(await (await tela(dono, requestUri, APP_B)).json()).toEqual({ situacao: 'invalido', aplicativo: null });
      hub.parado.mockReturnValue({ alvo: 'aplicativo' });
      expect(await (await tela(dono, requestUri)).json()).toEqual(expect.objectContaining({ situacao: 'pausado' }));
    });
  });

  // ------------------------------------------------------------------ autorizar

  describe('autorizar', () => {
    it('devolve o endereço cadastrado com o código, o state e o iss, grava a prova com o texto e gasta o pedido', async () => {
      const { contaId, dono } = await novaConta();
      const p = await pedir({ cnpj: await cnpjDa(contaId) });
      const a = await autorizado(dono, p.requestUri, { opcionais: ['conversas.anuncio.ler'] });
      expect(a.volta.origin + a.volta.pathname).toBe(VOLTA);
      expect(a.code).toMatch(/^rct_ac_/);
      expect(a.state).toBe(p.state);
      expect(a.iss).toBe('https://castapi.exemplo');

      const prova = (await poolSuper.query('select * from integracao_autorizacao where conta_id = $1', [contaId])).rows[0] as Record<string, unknown>;
      expect(prova).toEqual(expect.objectContaining({ usuario_id: dono.id, usuario_nome: 'Paulo Exemplo', texto_versao: 1, outra_empresa: false, ligacao_id: null }));
      expect(prova.escopos).toEqual(['conta.ler', 'campanhas.ler', 'publicos.ler', 'modelos.ler', 'orcamento.ler', 'conversas.anuncio.ler']);
      expect((prova.texto as { titulo: string }).titulo).toBe('O Liame quer acessar a sua conta do Regemcast');
      expect(JSON.stringify(prova)).not.toContain(a.code);
      // Nada nasce no clique: ainda não há ligação.
      expect(await ligacoesAtivas(contaId)).toHaveLength(0);
      // O pedido vale uma vez só: autorizar de novo dá 410, e a página o mostra como inválido.
      expect((await autorizar(dono, p.requestUri)).status).toBe(410);
      expect(await (await tela(dono, p.requestUri)).json()).toEqual(expect.objectContaining({ situacao: 'invalido' }));
      // A prova é só de acréscimo: a aplicação não apaga.
      await expect(poolApp.query('delete from integracao_autorizacao where conta_id = $1', [contaId])).rejects.toThrow(/permission denied/);
    });

    it('quem não é o dono recebe 403 e nada é gravado; recusar volta com access_denied e gasta o pedido', async () => {
      const { contaId, dono, operador } = await novaConta();
      const { requestUri, state } = await pedir();
      expect((await autorizar(operador, requestUri)).status).toBe(403);
      expect((await poolSuper.query('select count(*)::int as n from integracao_autorizacao where conta_id = $1', [contaId])).rows[0].n).toBe(0);

      const r = await fetch(`${origem}/integracoes/autorizacao/recusar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-usuario-teste': JSON.stringify(operador) },
        body: JSON.stringify({ clientId: APP_A, requestUri }),
      });
      expect(r.status).toBe(200);
      const volta = new URL(((await r.json()) as { redirect: string }).redirect);
      expect(Object.fromEntries(volta.searchParams)).toEqual({ error: 'access_denied', state, iss: 'https://castapi.exemplo' });
      expect((await autorizar(dono, requestUri)).status).toBe(410);
    });

    it('a conta de outra empresa só autoriza com a confirmação; a opcional que não foi pedida é recusada', async () => {
      const { dono } = await novaConta();
      const outra = await pedir({ cnpj: '44555666000100' });
      const sem = await autorizar(dono, outra.requestUri);
      expect(sem.status).toBe(400);
      expect(((await sem.json()) as { mensagem: string }).mensagem).toMatch(/outra empresa/);
      const intruso = await autorizar(dono, outra.requestUri, { confirmo: true, opcionais: ['campanhas.disparar'] });
      expect(intruso.status).toBe(400);
      expect((await autorizar(dono, outra.requestUri, { confirmo: true })).status).toBe(200);
    });

    it('cinco senhas erradas em 15 minutos travam a autorização (423), e travada nem a senha certa passa; a entrada na conta não muda', async () => {
      const { contaId, dono } = await novaConta();
      const { requestUri } = await pedir({ cnpj: await cnpjDa(contaId) });
      const respostas: number[] = [];
      let ultima = '';
      for (let i = 0; i < 5; i += 1) {
        const r = await autorizar(dono, requestUri, { senha: 'senha-errada' });
        respostas.push(r.status);
        ultima = ((await r.json()) as { mensagem: string }).mensagem;
      }
      expect(respostas).toEqual([422, 422, 422, 422, 423]);
      expect(ultima).toMatch(/travada por 15 minutos/);
      expect((await autorizar(dono, requestUri)).status).toBe(423);
      expect(await (await tela(dono, requestUri)).json()).toEqual(expect.objectContaining({ situacao: 'travada' }));
      const u = (await poolSuper.query('select tentativas_falhas, bloqueado_ate from usuario where id = $1', [dono.id])).rows[0];
      expect(u).toEqual({ tentativas_falhas: 0, bloqueado_ate: null });

      // Passada a trava, a senha certa autoriza e zera o contador.
      await poolSuper.query("update usuario set autorizacao_travada_ate = now() - interval '1 second' where id = $1", [dono.id]);
      expect((await autorizar(dono, requestUri)).status).toBe(200);
      expect((await poolSuper.query('select autorizacao_erros from usuario where id = $1', [dono.id])).rows[0].autorizacao_erros).toBe(0);
    });

    it('erro de senha mais velho que 15 minutos não conta para a trava', async () => {
      const { dono } = await novaConta();
      const { requestUri } = await pedir();
      for (let i = 0; i < 4; i += 1) await autorizar(dono, requestUri, { senha: 'senha-errada' });
      await poolSuper.query("update usuario set autorizacao_erro_em = now() - interval '16 minutes' where id = $1", [dono.id]);
      const r = await autorizar(dono, requestUri, { senha: 'senha-errada' });
      expect(r.status).toBe(422);
      expect(((await r.json()) as { mensagem: string }).mensagem).toMatch(/Mais 4 senhas erradas/);
    });

    it('pedido vencido: a página o mostra como inválido e autorizar dá 410, mesmo com a senha certa', async () => {
      const { contaId, dono } = await novaConta();
      const { requestUri } = await pedir({ cnpj: await cnpjDa(contaId) });
      await poolSuper.query("update integracao_pedido set vence_em = now() - interval '1 second' where vence_em > now() and aplicativo = $1", [APP_A]);
      expect(await (await tela(dono, requestUri)).json()).toEqual(expect.objectContaining({ situacao: 'invalido' }));
      expect((await autorizar(dono, requestUri)).status).toBe(410);
    });

    it('duas autorizações do mesmo pedido ao mesmo tempo: uma passa, a outra recebe 410', async () => {
      const { contaId, dono } = await novaConta();
      const { requestUri } = await pedir({ cnpj: await cnpjDa(contaId) });
      const status = (await Promise.all([autorizar(dono, requestUri), autorizar(dono, requestUri)])).map((r) => r.status).sort();
      expect(status).toEqual([200, 410]);
    });
  });

  // ------------------------------------------------------------------ a troca

  describe('a troca do código', () => {
    it('entrega o segredo da ligação, cria a ligação por clique ligada à autorização e avisa o dono', async () => {
      const { contaId, dono } = await novaConta();
      const l = await ligado(dono, { opcionais: ['conversas.anuncio.ler'] });
      expect(l.entregue).toEqual(expect.objectContaining({ ligacao: expect.stringMatching(/^dms_lg_regemcast_/), conta_id: contaId, conta: 'Hamburgueria Exemplo' }));
      expect(l.entregue.permissoes).toContain('conversas.anuncio.ler');

      const [lig] = await ligacoesAtivas(contaId);
      expect(lig).toEqual(expect.objectContaining({ aplicativo: APP_A, produto: 'liame', classe: 'dms', nome: 'Liame', origem_token_id: null }));
      const prova = (await poolSuper.query('select id, ligacao_id, codigo_usado_em from integracao_autorizacao where conta_id = $1', [contaId])).rows[0];
      expect(lig!.autorizacao_id).toBe(prova.id);
      expect(prova.ligacao_id).toBe(lig!.id);
      expect(JSON.stringify(lig)).not.toContain(l.entregue.ligacao);
      expect(avisos.ligacaoPorClique).toHaveBeenCalledWith(contaId, expect.objectContaining({ aplicativo: 'Liame', tipo: 'nova' }));

      // A ligação vale na porta MCP, pela via do DMS ID.
      const quem = await servico().autenticarLigacao(l.entregue.ligacao, { aplicativo: APP_A, permissoes: ['conta.ler', 'conversas.anuncio.ler'] }, { liame: APP_A });
      expect(quem).toEqual(expect.objectContaining({ contaId, escopos: ['conta.ler', 'conversas.anuncio.ler'] }));
    });

    it('o código usado de novo é recusado e desliga a ligação que ele criou', async () => {
      const { contaId, dono } = await novaConta();
      const l = await ligado(dono);
      const repetida = await trocar(l.code, l.verificador);
      expect(repetida.status).toBe(400);
      expect(((await repetida.json()) as { type: string }).type).toMatch(/autorizacao-invalida$/);
      expect(await ligacoesAtivas(contaId)).toHaveLength(0);
      const caiu = (await poolSuper.query('select revogado_por from integracao_ligacao where conta_id = $1', [contaId])).rows[0];
      expect(caiu.revogado_por).toBe('código de autorização usado duas vezes');
    });

    it('verificador errado ou endereço diferente gastam o código: a segunda tentativa, mesmo certa, não liga nada', async () => {
      const { contaId, dono } = await novaConta();
      const p = await pedir({ cnpj: await cnpjDa(contaId) });
      const a = await autorizado(dono, p.requestUri);
      expect((await trocar(a.code, pkce().verificador)).status).toBe(400);
      expect((await trocar(a.code, p.verificador)).status).toBe(400);

      const p2 = await pedir({ cnpj: await cnpjDa(contaId) });
      const a2 = await autorizado(dono, p2.requestUri);
      expect((await trocar(a2.code, p2.verificador, { redirect: 'https://liame.exemplo/outra' })).status).toBe(400);
      expect((await trocar(a2.code, p2.verificador)).status).toBe(400);
      expect(await ligacoesAtivas(contaId)).toHaveLength(0);
    });

    it('quem autorizou deixou de ser o dono antes da troca: a troca é recusada e nada liga', async () => {
      const { contaId, dono } = await novaConta();
      const p = await pedir({ cnpj: await cnpjDa(contaId) });
      const a = await autorizado(dono, p.requestUri);
      await poolSuper.query("update usuario set papel = 'operador' where id = $1", [dono.id]);
      expect((await trocar(a.code, p.verificador)).status).toBe(400);
      expect(await ligacoesAtivas(contaId)).toHaveLength(0);
    });

    it('conta suspensa entre o clique e a troca: 403 conta-bloqueada e nada liga', async () => {
      const { contaId, dono } = await novaConta();
      const p = await pedir({ cnpj: await cnpjDa(contaId) });
      const a = await autorizado(dono, p.requestUri);
      await poolSuper.query("update conta set status = 'suspensa' where id = $1", [contaId]);
      const r = await trocar(a.code, p.verificador);
      expect(r.status).toBe(403);
      expect(((await r.json()) as { type: string }).type).toMatch(/conta-bloqueada$/);
      expect(await ligacoesAtivas(contaId)).toHaveLength(0);
    });

    it('aplicativo parado pela DMS depois do clique: a troca é recusada (503) e nada liga', async () => {
      const { contaId, dono } = await novaConta();
      const p = await pedir({ cnpj: await cnpjDa(contaId) });
      const a = await autorizado(dono, p.requestUri);
      hub.parado.mockReturnValue({ alvo: 'aplicativo' });
      expect((await trocar(a.code, p.verificador)).status).toBe(503);
      hub.parado.mockReturnValue(null);
      expect(await ligacoesAtivas(contaId)).toHaveLength(0);
    });

    it('código vencido não liga; código de outro aplicativo é recusado pelo aplicativo do token', async () => {
      const { contaId, dono } = await novaConta();
      const p = await pedir({ cnpj: await cnpjDa(contaId) });
      const a = await autorizado(dono, p.requestUri);
      expect((await trocar(a.code, p.verificador, { token: dmsId.emitir({ aplicativo: APP_B }) })).status).toBe(401);
      await poolSuper.query("update integracao_autorizacao set codigo_vence_em = now() - interval '1 second' where conta_id = $1", [contaId]);
      expect((await trocar(a.code, p.verificador)).status).toBe(400);
      expect(await ligacoesAtivas(contaId)).toHaveLength(0);
    });

    it('pedir mais permissões: a mesma ligação ganha as permissões e um segredo novo, e o anterior para de valer', async () => {
      const { contaId, dono } = await novaConta();
      const primeira = await ligado(dono, { scope: NECESSARIAS });
      const [antes] = await ligacoesAtivas(contaId);

      const p = await pedir({ cnpj: await cnpjDa(contaId) });
      const corpo = (await (await tela(dono, p.requestUri)).json()) as { tela: { titulo: string; jaLigada: { novas: string[] } } };
      expect(corpo.tela.titulo).toBe('O Liame pede mais uma permissão');
      expect(corpo.tela.jaLigada.novas).toEqual(['conversas.anuncio.ler']);
      const a = await autorizado(dono, p.requestUri, { opcionais: ['conversas.anuncio.ler'] });
      const r = await trocar(a.code, p.verificador);
      expect(r.status).toBe(200);
      const segunda = (await r.json()) as { ligacao: string; permissoes: string[] };

      const [depois] = await ligacoesAtivas(contaId);
      expect(depois!.id).toBe(antes!.id);
      expect(segunda.permissoes).toContain('conversas.anuncio.ler');
      expect(avisos.ligacaoPorClique).toHaveBeenLastCalledWith(contaId, expect.objectContaining({ tipo: 'mais' }));
      const doToken = { aplicativo: APP_A, permissoes: ['conta.ler'] };
      await expect(servico().autenticarLigacao(primeira.entregue.ligacao, doToken, { liame: APP_A })).rejects.toBeInstanceOf(ErroProblema);
      expect((await servico().autenticarLigacao(segunda.ligacao, doToken, { liame: APP_A })).contaId).toBe(contaId);
    });

    it('duas trocas de códigos diferentes da mesma conta ao mesmo tempo terminam com UMA ligação ativa', async () => {
      const { contaId, dono } = await novaConta();
      const cnpj = await cnpjDa(contaId);
      const p1 = await pedir({ cnpj });
      const p2 = await pedir({ cnpj });
      const a1 = await autorizado(dono, p1.requestUri);
      const a2 = await autorizado(dono, p2.requestUri);
      const status = (await Promise.all([trocar(a1.code, p1.verificador), trocar(a2.code, p2.verificador)])).map((r) => r.status);
      expect(status).toContain(200);
      for (const s of status) expect([200, 400]).toContain(s);
      expect(await ligacoesAtivas(contaId)).toHaveLength(1);
    });

    it('a corrida que só o índice único decide: a troca que chega no meio da outra é recusada (400, nunca 500) e fica UMA ligação ativa', async () => {
      const { contaId, dono } = await novaConta();
      const p = await pedir({ cnpj: await cnpjDa(contaId) });
      const a = await autorizado(dono, p.requestUri);
      // A "outra troca": uma ligação ativa inserida numa transação ainda aberta. A troca não a enxerga (READ COMMITTED),
      // tenta criar a dela e espera no índice único; quando a outra confirma, o Postgres responde 23505. Sem segurar a
      // transação, as duas trocas se enfileiram e a segunda só gira a ligação — o caminho do 23505 nunca roda.
      const outra = await poolSuper.connect();
      let r: Response;
      try {
        await outra.query('begin');
        await outra.query(
          "insert into integracao_ligacao (conta_id, aplicativo, produto, classe, nome, segredo_hash, prefixo) values ($1, $2, 'liame', 'dms', 'Liame', $3, 'dms_lg_regemcast_outra')",
          [contaId, APP_A, `resumo-${randomUUID()}`],
        );
        const resposta = trocar(a.code, p.verificador);
        const fim = Date.now() + 10_000;
        const esperando = async () =>
          (await poolSuper.query("select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and usename = 'regemcast_app' and query ilike '%insert into \"integracao_ligacao\"%'")).rows[0].n > 0;
        while (!(await esperando())) {
          if (Date.now() > fim) throw new Error('a troca não chegou a esperar no índice único');
          await new Promise((pronto) => setTimeout(pronto, 50));
        }
        await outra.query('commit');
        r = await resposta;
      } finally {
        await outra.query('rollback').catch(() => undefined);
        outra.release();
      }
      expect(r.status).toBe(400);
      const corpo = (await r.json()) as { type: string; detail: string };
      expect(corpo.type).toMatch(/autorizacao-invalida$/);
      expect(corpo.detail).toContain('Outra autorização desta conta terminou agora mesmo');
      const ativas = await ligacoesAtivas(contaId);
      expect(ativas).toHaveLength(1);
      expect(ativas[0]!.prefixo).toBe('dms_lg_regemcast_outra');
      expect(avisos.ligacaoPorClique).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------ Aplicativos conectados

  describe('Aplicativos conectados', () => {
    it('mostra a ligação por clique com a autorização (o texto guardado) e o histórico, e o dono desliga', async () => {
      const { contaId, dono } = await novaConta();
      await ligado(dono);
      const lista = await ctx.comConta(contaId, () => servico().daConta(contaId));
      expect(lista).toHaveLength(1);
      const [app_] = lista;
      expect(app_).toEqual(expect.objectContaining({ via: 'clique', produto: 'liame', nome: 'Liame', revogadoEm: null, criadoPor: 'Paulo Exemplo' }));
      expect(app_!.autorizacao).toEqual(expect.objectContaining({ por: 'Paulo Exemplo', versao: 1, outraEmpresa: false }));
      expect((app_!.autorizacao!.texto as { titulo: string }).titulo).toBe('O Liame quer acessar a sua conta do Regemcast');
      expect(app_!.historico.map((h) => h.texto)).toContain('Paulo Exemplo autorizou com a senha (texto versão 1).');

      const depois = await ctx.comConta(contaId, () => servico().revogarPelaConta(contaId, { id: dono.id, nome: dono.nome }, app_!.id));
      expect(depois[0]!.revogadoEm).not.toBeNull();
      expect(depois[0]!.historico[0]!.texto).toBe('Desligado por Paulo Exemplo.');
      expect(await ligacoesAtivas(contaId)).toHaveLength(0);
    });
  });
});
