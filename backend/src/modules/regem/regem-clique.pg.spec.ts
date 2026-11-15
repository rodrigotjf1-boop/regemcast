/**
 * "Conectar pelo Regem" no Postgres de verdade (migration 050), rodando como `regemcast_app` — com a RLS
 * valendo, como em produção. O DMS ID e a porta do Regem são dublês do `fetch` (cada chamada fica anotada).
 *
 * Precisa de um banco DESCARTÁVEL com as migrations aplicadas; sem as duas variáveis, pula (o CI não tem
 * banco):
 *
 *   REGEMCAST_TESTE_PG_URL    o banco como regemcast_app (quem o serviço usa)
 *   REGEMCAST_TESTE_PG_SUPER  o mesmo banco como dono (só para montar contas, usuários e a conexão antiga)
 *
 * Cada execução cria contas novas (ids aleatórios) e não apaga nada: a trilha de auditoria é imutável.
 */
jest.mock('../../config/env', () => ({
  env: {
    integracoes: { regemUrl: 'https://regem.exemplo/api/v1', chave: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=' },
    mercadoPago: { carenciaDias: 5 },
  },
}));

import { createHash, randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { env } from '../../config/env';
import { ContextoDb } from '../../db/contexto';
import * as schema from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { cifrarToken, decifrarToken } from '../meta/cripto';
import { RegemCliente } from './regem.cliente';
import { RegemService } from './regem.service';

const URL_APP = process.env.REGEMCAST_TESTE_PG_URL;
const URL_SUPER = process.env.REGEMCAST_TESTE_PG_SUPER;
const descrever = URL_APP && URL_SUPER ? describe : describe.skip;

const ISS = 'https://regem.exemplo';
const VOLTA = 'https://cast.exemplo/integracoes/regem/volta';
const NECESSARIAS = ['pedidos.ler', 'clientes.telefone.ler', 'clientes.ler'];
/** Um CNPJ fictício por conta (o CNPJ da conta é único): a raiz sorteada e dígitos verificadores que não conferem. */
const cnpjFicticio = () => `${String(10_000_000 + Math.floor(Math.random() * 89_999_999))}000100`;
const ligacaoNova = () => `dms_lg_regem_${randomUUID().replace(/-/g, '').padEnd(43, 'x').slice(0, 43)}_${'abcdef'}`;

type Chamada = { url: string; metodo: string; cabecalhos: Headers; corpo: string | null };

descrever('"Conectar pelo Regem" no Postgres', () => {
  let poolApp: Pool;
  let poolSuper: Pool;
  let servico: RegemService;
  const fetchOriginal = global.fetch;
  const NOMES = ['REGEM_CLIQUE', 'REGEM_API_URL', 'REGEM_APP_URL', 'APP_URL', 'DMS_ID_EMISSOR', 'HUB_APLICATIVO', 'HUB_SEGREDO'];
  const antes: Record<string, string | undefined> = {};

  /** O que a porta do Regem responde nesta vez (o DMS ID responde sozinho). */
  let regem: {
    pedido: () => { status: number; corpo: unknown };
    token: () => { status: number; corpo: unknown };
    loja: () => { status: number; corpo: unknown };
  };
  let chamadas: Chamada[] = [];

  const resposta = (status: number, corpo: unknown) =>
    ({ ok: status >= 200 && status < 300, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => corpo }) as unknown as Response;

  beforeAll(() => {
    for (const n of NOMES) antes[n] = process.env[n];
    Object.assign(process.env, {
      REGEM_CLIQUE: 'true',
      REGEM_API_URL: `${ISS}/api/v1`,
      APP_URL: 'https://cast.exemplo',
      DMS_ID_EMISSOR: 'https://id.exemplo/oidc',
      HUB_APLICATIVO: 'app-cast-de-teste',
      HUB_SEGREDO: 'segredo-de-teste-123456',
    });
    delete process.env.REGEM_APP_URL;
    poolApp = new Pool({ connectionString: URL_APP, max: 4 });
    poolSuper = new Pool({ connectionString: URL_SUPER, max: 2 });
    const ctx = new ContextoDb(drizzle(poolApp, { schema }));
    servico = new RegemService(ctx, new RegemCliente(), new AuditoriaService(ctx));
  });
  afterAll(async () => {
    global.fetch = fetchOriginal;
    for (const n of NOMES) {
      if (antes[n] === undefined) delete process.env[n];
      else process.env[n] = antes[n];
    }
    await poolApp.end();
    await poolSuper.end();
  });

  beforeEach(() => {
    chamadas = [];
    regem = {
      pedido: () => ({ status: 201, corpo: { request_uri: `urn:ietf:params:oauth:request_uri:rgm_${'n'.repeat(43)}`, expires_in: 600 } }),
      token: () => ({ status: 500, corpo: null }),
      loja: () => ({ status: 500, corpo: null }),
    };
    global.fetch = jest.fn(async (url: string | URL, init?: RequestInit) => {
      const c = { url: String(url), metodo: init?.method ?? 'GET', cabecalhos: new Headers(init?.headers), corpo: (init?.body as string) ?? null };
      chamadas.push(c);
      if (c.url === 'https://id.exemplo/oidc/token') return resposta(200, { access_token: 'token-do-dms-id', expires_in: 3600 });
      if (c.url === `${ISS}/api/v1/integracao/autorizacao/pedido`) {
        const r = regem.pedido();
        return resposta(r.status, r.corpo);
      }
      if (c.url === `${ISS}/api/v1/integracao/autorizacao/token`) {
        const r = regem.token();
        return resposta(r.status, r.corpo);
      }
      if (c.url === `${ISS}/api/v1/integracao/loja`) {
        const r = regem.loja();
        return resposta(r.status, r.corpo);
      }
      if (c.url === `${ISS}/api/v1/integracao/autorizacao/revogar`) return resposta(200, { revogado: true });
      throw new Error(`chamada inesperada: ${c.metodo} ${c.url}`);
    }) as unknown as typeof fetch;
  });

  async function novaConta(cnpj: string | null = cnpjFicticio()): Promise<{ contaId: string; dono: { id: string; nome: string; email: string } }> {
    const contaId = randomUUID();
    await poolSuper.query('insert into conta (id, nome, status, cnpj) values ($1, $2, $3, $4)', [contaId, 'Brasa Burger', 'aprovada', cnpj]);
    const id = randomUUID();
    const email = `dono-${id.slice(0, 8)}@brasa.exemplo`;
    await poolSuper.query(
      'insert into usuario (id, conta_id, nome, email, senha_hash, papel, status) values ($1, $2, $3, $4, $5, $6, $7)',
      [id, contaId, 'Paulo Dono', email, 'hash-que-nao-importa', 'dono', 'ativo'],
    );
    return { contaId, dono: { id, nome: 'Paulo Dono', email } };
  }

  /** O Regem entrega a ligação da empresa inteira e a leitura da empresa por ela. */
  function regemEntrega(ligacao: string, escopos = NECESSARIAS, empresaId = 'empresa-brasa') {
    regem.token = () => ({
      status: 200,
      corpo: { lojas: [{ loja_id: null, empresa_id: empresaId, ligacao, prefixo: ligacao.slice(0, 18), permissoes: escopos, segredo_em: new Date().toISOString() }] },
    });
    regem.loja = () => ({
      status: 200,
      corpo: { empresa_id: empresaId, empresa_nome: 'Brasa Burger', lojas: [{ id: 'l1', nome: 'Brasa Centro' }, { id: 'l2', nome: 'Brasa Praia' }], fuso: 'America/Sao_Paulo', moeda: 'BRL', escopos },
    });
  }

  /** O state do pedido que saiu para o Regem (a página do Regem o devolve na volta). */
  const stateDoPedido = () => {
    const post = chamadas.filter((c) => c.url.endsWith('/integracao/autorizacao/pedido')).pop();
    return JSON.parse(post!.corpo!) as Record<string, string>;
  };

  const falha = async (p: Promise<unknown>) => {
    const e = await p.then(
      () => null,
      (x: unknown) => x as { status?: number; getStatus?: () => number; message: string },
    );
    expect(e).not.toBeNull();
    return { status: e!.getStatus?.() ?? e!.status, message: e!.message };
  };

  it('conta nova: o dono declara, vai ao Regem e volta → ligada pelo clique, a importação começou, o pedido vale uma vez', async () => {
    const { contaId, dono } = await novaConta();
    // Sem a declaração, nem sai para o Regem.
    expect(await falha(servico.iniciarClique(contaId, dono, {}))).toMatchObject({ status: 400 });
    expect(chamadas).toHaveLength(0);

    const { url } = await servico.iniciarClique(contaId, dono, { consentimento: true, evidencia: 'Aceite no cardápio' });
    const pagina = new URL(url);
    expect(pagina.origin + pagina.pathname).toBe('https://app.dmsregem.com/integracoes/autorizar');
    expect(pagina.searchParams.get('client_id')).toBe('app-cast-de-teste');
    const pedido = stateDoPedido();
    expect(pedido).toMatchObject({ redirect_uri: VOLTA, scope: 'clientes.ler pedidos.ler clientes.telefone.ler', conta_email: dono.email });
    expect(pedido.conta_cnpj).toMatch(/^[0-9]{14}$/);
    const [guardado] = (await poolSuper.query('select * from integracao_regem_pedido where conta_id = $1', [contaId])).rows;
    expect(guardado).toMatchObject({ consentimento: true, evidencia: 'Aceite no cardápio', usado_em: null });
    expect(guardado.estado_hash).toBe(createHash('sha256').update(pedido.state!, 'utf8').digest('hex'));
    expect(JSON.stringify(guardado)).not.toContain(pedido.state!);

    // A volta sem o iss do Regem não vale (e não gasta o pedido).
    expect(await falha(servico.concluirClique(contaId, dono, { code: 'c'.repeat(43), state: pedido.state, iss: 'https://ataque.exemplo' }))).toMatchObject({ status: 400 });

    const ligacao = ligacaoNova();
    regemEntrega(ligacao);
    const r = await servico.concluirClique(contaId, dono, { code: 'c'.repeat(43), state: pedido.state, iss: ISS });
    expect(r.situacao).toBe('conectado');
    if (r.situacao !== 'conectado') throw new Error('não conectou');
    expect(r.regem).toMatchObject({ ligado: true, origem: 'clique', ligadaPor: 'Paulo Dono', empresaNome: 'Brasa Burger', clientes: { status: 'carga' } });
    expect(r.regem.consentimentoEm).not.toBeNull();

    // A troca levou o verificador do PKCE e a volta cadastrada; a leitura da empresa foi pela ligação.
    const troca = chamadas.find((c) => c.url.endsWith('/integracao/autorizacao/token'))!;
    const corpoTroca = JSON.parse(troca.corpo!) as Record<string, string>;
    expect(corpoTroca).toMatchObject({ grant_type: 'authorization_code', redirect_uri: VOLTA });
    expect(createHash('sha256').update(corpoTroca.code_verifier!, 'ascii').digest('base64url')).toBe(pedido.code_challenge);
    const leitura = chamadas.find((c) => c.url.endsWith('/integracao/loja'))!;
    expect(leitura.cabecalhos.get('dms-ligacao')).toBe(ligacao);

    // Guardada cifrada, com o prefixo; o pedido ficou gasto.
    const [linha] = (await poolSuper.query('select * from integracao_regem where conta_id = $1', [contaId])).rows;
    expect(linha).toMatchObject({ origem: 'clique', ligacao_prefixo: ligacao.slice(0, 18), consentimento_evidencia: 'Aceite no cardápio' });
    expect(linha.credencial_cifrada).not.toContain(ligacao);
    expect(decifrarToken(linha.credencial_cifrada, env.integracoes.chave)).toBe(ligacao);
    expect(await falha(servico.concluirClique(contaId, dono, { code: 'c'.repeat(43), state: pedido.state, iss: ISS }))).toMatchObject({ status: 400 });
  });

  it('o presidente recusou: nada muda aqui, e o pedido fica gasto', async () => {
    const { contaId, dono } = await novaConta();
    await servico.iniciarClique(contaId, dono, { consentimento: true });
    const pedido = stateDoPedido();
    expect(await servico.concluirClique(contaId, dono, { error: 'access_denied', state: pedido.state, iss: ISS })).toEqual({ situacao: 'recusado' });
    expect((await poolSuper.query('select 1 from integracao_regem where conta_id = $1', [contaId])).rows).toHaveLength(0);
    const [p] = (await poolSuper.query('select usado_em from integracao_regem_pedido where conta_id = $1', [contaId])).rows;
    expect(p.usado_em).not.toBeNull();
  });

  it('o pedido de outra pessoa da conta não vale na volta de quem não começou', async () => {
    const { contaId, dono } = await novaConta();
    await servico.iniciarClique(contaId, dono, { consentimento: true });
    const pedido = stateDoPedido();
    const outro = { id: randomUUID(), nome: 'Outro' };
    expect(await falha(servico.concluirClique(contaId, outro, { code: 'c'.repeat(43), state: pedido.state, iss: ISS }))).toMatchObject({ status: 400 });
  });

  it('a conta já ligada pela chave do console: sem declaração de novo, a ligação troca o token e a leitura continua de onde parou', async () => {
    const { contaId, dono } = await novaConta();
    await poolSuper.query(
      `insert into integracao_regem (conta_id, credencial_cifrada, empresa_id, empresa_nome, escopos, ligada_em, ligada_por,
                                     consentimento_por, consentimento_em, clientes_status, clientes_cursor, clientes_ultima_consulta)
       values ($1, $2, 'empresa-brasa', 'Brasa Burger', $3, now(), 'operador@dms.exemplo', $4, now(), 'em_dia', 'cursor-123', now())`,
      [contaId, cifrarToken('rgm_it_token_antigo_de_teste_0001', env.integracoes.chave), NECESSARIAS, dono.id],
    );
    await servico.iniciarClique(contaId, dono, {});
    const pedido = stateDoPedido();
    const ligacao = ligacaoNova();
    regemEntrega(ligacao);
    const r = await servico.concluirClique(contaId, dono, { code: 'c'.repeat(43), state: pedido.state, iss: ISS });
    expect(r).toMatchObject({ situacao: 'conectado', regem: { origem: 'clique', clientes: { status: 'em_dia' } } });
    const [linha] = (await poolSuper.query('select * from integracao_regem where conta_id = $1', [contaId])).rows;
    expect(linha).toMatchObject({ origem: 'clique', clientes_cursor: 'cursor-123' });
    expect(decifrarToken(linha.credencial_cifrada, env.integracoes.chave)).toBe(ligacao);
  });

  it('a ligação sem as leituras (o DMS ID ainda não libera ao Regemcast): revogada no Regem e nada guardado', async () => {
    const { contaId, dono } = await novaConta();
    await servico.iniciarClique(contaId, dono, { consentimento: true });
    const pedido = stateDoPedido();
    const ligacao = ligacaoNova();
    regemEntrega(ligacao);
    regem.loja = () => ({ status: 200, corpo: { empresa_id: 'empresa-brasa', empresa_nome: 'Brasa Burger', lojas: [], escopos: ['pedidos.ler'] } });
    const e = await falha(servico.concluirClique(contaId, dono, { code: 'c'.repeat(43), state: pedido.state, iss: ISS }));
    expect(e.status).toBe(503);
    expect(e.message).toContain('Nada foi guardado');
    const revogar = chamadas.find((c) => c.url.endsWith('/integracao/autorizacao/revogar'));
    expect(revogar?.cabecalhos.get('dms-ligacao')).toBe(ligacao);
    expect((await poolSuper.query('select 1 from integracao_regem where conta_id = $1', [contaId])).rows).toHaveLength(0);
  });

  it('a troca recusada pelo Regem ou torta (ligação por loja): nada é guardado', async () => {
    const { contaId, dono } = await novaConta();
    await servico.iniciarClique(contaId, dono, { consentimento: true });
    regem.token = () => ({ status: 400, corpo: { detail: 'Código de autorização inválido, vencido ou já usado.' } });
    expect(await falha(servico.concluirClique(contaId, dono, { code: 'c'.repeat(43), state: stateDoPedido().state, iss: ISS }))).toMatchObject({ status: 400 });

    await servico.iniciarClique(contaId, dono, { consentimento: true });
    regem.token = () => ({ status: 200, corpo: { lojas: [{ loja_id: 'l1', ligacao: ligacaoNova(), permissoes: NECESSARIAS }] } });
    expect(await falha(servico.concluirClique(contaId, dono, { code: 'c'.repeat(43), state: stateDoPedido().state, iss: ISS }))).toMatchObject({ status: 503 });
    expect((await poolSuper.query('select 1 from integracao_regem where conta_id = $1', [contaId])).rows).toHaveLength(0);
  });

  it('o Regem recusa abrir o pedido (aplicativo fora da lista, volta não cadastrada): a conta lê uma frase, a distribuição o motivo no log', async () => {
    const { contaId, dono } = await novaConta();
    regem.pedido = () => ({ status: 400, corpo: { detail: 'redirect_uri não é um endereço de volta cadastrado para este aplicativo.' } });
    const e = await falha(servico.iniciarClique(contaId, dono, { consentimento: true }));
    expect(e).toMatchObject({ status: 503, message: 'O Regem não aceitou abrir a conexão agora. Fale com o suporte do RegemCast.' });
    expect((await poolSuper.query('select 1 from integracao_regem_pedido where conta_id = $1', [contaId])).rows).toHaveLength(0);
  });

  it('desligar a conexão do clique revoga a ligação no Regem', async () => {
    const { contaId, dono } = await novaConta();
    await servico.iniciarClique(contaId, dono, { consentimento: true });
    const ligacao = ligacaoNova();
    regemEntrega(ligacao);
    await servico.concluirClique(contaId, dono, { code: 'c'.repeat(43), state: stateDoPedido().state, iss: ISS });
    chamadas = [];
    await servico.desligar(contaId, { usuarioId: dono.id });
    const revogar = chamadas.find((c) => c.url.endsWith('/integracao/autorizacao/revogar'));
    expect(revogar?.metodo).toBe('POST');
    expect(revogar?.cabecalhos.get('dms-ligacao')).toBe(ligacao);
    expect((await poolSuper.query('select 1 from integracao_regem where conta_id = $1', [contaId])).rows).toHaveLength(0);
  });
});
