/**
 * O DMS Graph no Postgres de verdade (migration 052), rodando como `regemcast_app`, com a RLS valendo. O DMS ID e o Graph
 * são dublês do `fetch`. Precisa de um banco DESCARTÁVEL com as migrations; sem as duas variáveis, pula (o CI não tem banco):
 *
 *   REGEMCAST_TESTE_PG_URL    o banco como regemcast_app
 *   REGEMCAST_TESTE_PG_SUPER  o mesmo banco como dono (só para montar contas, usuários e mídias)
 */
jest.mock('../../config/env', () => ({
  env: { integracoes: { chave: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=' } },
}));

import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { env } from '../../config/env';
import { ContextoDb } from '../../db/contexto';
import * as schema from '../../db/schema';
import { gerarChave } from '../../dms/integracao-dms';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { decifrarToken } from '../meta/cripto';
import { AJUSTE_MAX_BYTES } from './dms-graph.regras';
import { DmsGraphService } from './dms-graph.service';

const URL_APP = process.env.REGEMCAST_TESTE_PG_URL;
const URL_SUPER = process.env.REGEMCAST_TESTE_PG_SUPER;
const descrever = URL_APP && URL_SUPER ? describe : describe.skip;

const ORIGEM = 'https://graph.exemplo';
const MCP = `${ORIGEM}/mcp`;
const VOLTA = 'https://cast.exemplo/integracoes/graph/volta';
const CODIGO = `gph_ac_${'c'.repeat(43)}`;
const cnpjFicticio = () => `${String(10_000_000 + Math.floor(Math.random() * 89_999_999))}000100`;
/** Um MP4 mínimo: a caixa `ftyp` e bytes de enchimento. */
const mp4 = (n = 64) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(n, 7)]);

type Chamada = { url: string; metodo: string; cabecalhos: Headers; corpo: string | null };

descrever('DMS Graph no Postgres', () => {
  let poolApp: Pool;
  let poolSuper: Pool;
  let servico: DmsGraphService;
  const fetchOriginal = global.fetch;
  const NOMES = ['DMS_GRAPH_LIGADO', 'DMS_GRAPH_MCP_URL', 'DMS_GRAPH_CONTAS', 'APP_URL', 'DMS_ID_EMISSOR', 'HUB_APLICATIVO', 'HUB_SEGREDO'];
  const antes: Record<string, string | undefined> = {};
  let chamadas: Chamada[] = [];
  /** O que cada ferramenta responde nesta vez. */
  let porta: {
    pedido: () => { status: number; corpo: unknown };
    token: () => { status: number; corpo: unknown };
    ferramenta: (nome: string, argumentos: Record<string, unknown>) => { erro?: unknown; dados?: unknown; status?: number; problema?: string };
    arquivo: () => { status: number; bytes?: Buffer };
  };

  const json = (status: number, corpo: unknown, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', ...extra } });

  beforeAll(() => {
    for (const n of NOMES) antes[n] = process.env[n];
    Object.assign(process.env, {
      DMS_GRAPH_LIGADO: 'true',
      DMS_GRAPH_MCP_URL: MCP,
      APP_URL: 'https://cast.exemplo',
      DMS_ID_EMISSOR: 'https://id.exemplo/oidc',
      HUB_APLICATIVO: 'aplicativo-do-cast',
      HUB_SEGREDO: 'segredo-do-aplicativo-de-teste',
    });
    delete process.env.DMS_GRAPH_CONTAS;
    poolApp = new Pool({ connectionString: URL_APP, max: 5 });
    poolSuper = new Pool({ connectionString: URL_SUPER, max: 2 });
    const ctx = new ContextoDb(drizzle(poolApp, { schema }));
    servico = new DmsGraphService(ctx, new AuditoriaService(ctx));
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
    delete process.env.DMS_GRAPH_CONTAS;
    porta = {
      pedido: () => ({ status: 201, corpo: { request_uri: `urn:ietf:params:oauth:request_uri:gph_${'n'.repeat(43)}`, expires_in: 600, authorization_endpoint: `${ORIGEM}/autorizar` } }),
      token: () => ({ status: 500, corpo: null }),
      ferramenta: () => ({ erro: { code: -32603, message: 'não configurado' } }),
      arquivo: () => ({ status: 404 }),
    };
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const c: Chamada = { url: u, metodo: init?.method ?? 'GET', cabecalhos: new Headers(init?.headers), corpo: (init?.body as string) ?? null };
      chamadas.push(c);
      if (u === 'https://id.exemplo/oidc/token') return json(200, { access_token: 'token-do-dms-id', expires_in: 3600 });
      if (u === `${ORIGEM}/v1/dms-id/autorizacao/pedido`) {
        const r = porta.pedido();
        return json(r.status, r.corpo);
      }
      if (u === `${ORIGEM}/v1/dms-id/autorizacao/token`) {
        const r = porta.token();
        return json(r.status, r.corpo);
      }
      if (u === `${ORIGEM}/v1/dms-id/ligacao`) return json(200, { ok: true });
      if (u.startsWith(`${ORIGEM}/midia/`)) {
        const r = porta.arquivo();
        return new Response(r.bytes ? new Uint8Array(r.bytes) : null, { status: r.status });
      }
      if (u === MCP) {
        const pedido = JSON.parse(c.corpo!) as { id: number; params: { name: string; arguments: Record<string, unknown> } };
        const r = porta.ferramenta(pedido.params.name, pedido.params.arguments);
        if (r.status) return json(r.status, { type: `https://dev.dmstecnologias.com/erros/${r.problema}`, title: 'recusa', status: r.status }, { 'content-type': 'application/problem+json' });
        if (r.erro) return json(200, { jsonrpc: '2.0', id: pedido.id, result: { isError: true, content: [{ type: 'text', text: (r.erro as { frase: string }).frase }], structuredContent: r.erro } });
        return json(200, { jsonrpc: '2.0', id: pedido.id, result: { content: [{ type: 'text', text: JSON.stringify(r.dados) }], structuredContent: r.dados } });
      }
      throw new Error(`chamada inesperada: ${c.metodo} ${u}`);
    }) as unknown as typeof fetch;
  });

  async function novaConta(cnpj: string | null = cnpjFicticio()) {
    const contaId = randomUUID();
    await poolSuper.query('insert into conta (id, nome, status, cnpj) values ($1, $2, $3, $4)', [contaId, 'Brasa Burger', 'aprovada', cnpj]);
    const id = randomUUID();
    const email = `dono-${id.slice(0, 8)}@brasa.exemplo`;
    await poolSuper.query('insert into usuario (id, conta_id, nome, email, senha_hash, papel, status) values ($1, $2, $3, $4, $5, $6, $7)', [id, contaId, 'Paulo Dono', email, 'hash-que-nao-importa', 'dono', 'ativo']);
    return { contaId, dono: { id, nome: 'Paulo Dono', email } };
  }

  async function novaMidia(contaId: string, bytes = mp4(), tipo = 'video/mp4') {
    const id = randomUUID();
    await poolSuper.query('insert into midia (id, conta_id, nome_arquivo, tipo_mime, tamanho_bytes, conteudo) values ($1, $2, $3, $4, $5, $6)', [id, contaId, 'promo.mp4', tipo, bytes.length, bytes]);
    return id;
  }

  const estadoDoPedido = () => JSON.parse(chamadas.filter((c) => c.url.endsWith('/autorizacao/pedido')).pop()!.corpo!) as Record<string, string>;

  async function ligar(contaId: string, dono: { id: string; nome: string; email: string }, permissoes = ['videos.ajustar']) {
    const { chave } = gerarChave('lg', 'graph');
    porta.token = () => ({ status: 200, corpo: { ligacao: chave, prefixo: chave.slice(0, 18), conta_id: 'conta-graph', conta_nome: 'Brasa no Graph', permissoes } });
    await servico.iniciarClique(contaId, dono);
    await servico.concluirClique(contaId, dono, { code: CODIGO, state: estadoDoPedido().state, iss: ORIGEM });
    return chave;
  }

  const tarefa = randomUUID();
  const pronta = (bytes: Buffer) => ({
    tarefa,
    ferramenta: 'ajustar_video',
    situacao: 'pronto',
    resultado: { link: `${ORIGEM}/midia/token-assinado`, venceEm: new Date().toISOString(), tipoArquivo: 'video', mimeType: 'video/mp4', bytes: bytes.length, largura: 720, altura: 1280, duracaoSegundos: 15 },
  });

  const falha = async (p: Promise<unknown>) => {
    const e = await p.then(() => null, (x: unknown) => x as { status?: number; message?: string });
    expect(e).not.toBeNull();
    return e!;
  };

  describe('o clique', () => {
    it('sem a chave geral, a conta não vê nada e as rotas recusam', async () => {
      const { contaId, dono } = await novaConta();
      process.env.DMS_GRAPH_LIGADO = 'false';
      try {
        expect((await servico.situacao(contaId, 'dono')).disponivel).toBe(false);
        expect((await falha(servico.iniciarClique(contaId, dono))).status).toBe(503);
        expect(chamadas).toHaveLength(0);
      } finally {
        process.env.DMS_GRAPH_LIGADO = 'true';
      }
    });

    it('o piloto: só a conta da lista vê; item torto não abre para as outras', async () => {
      const a = await novaConta();
      const b = await novaConta();
      process.env.DMS_GRAPH_CONTAS = `${a.contaId}, torto`;
      expect((await servico.situacao(a.contaId, 'dono')).disponivel).toBe(true);
      expect((await servico.situacao(b.contaId, 'dono')).disponivel).toBe(false);
    });

    it('sem CNPJ, recusa antes de ir ao Graph', async () => {
      const { contaId, dono } = await novaConta(null);
      expect((await servico.situacao(contaId, 'dono')).contaTemCnpj).toBe(false);
      expect((await falha(servico.iniciarClique(contaId, dono))).message).toMatch(/CNPJ/);
      expect(chamadas.some((c) => c.url.includes('/autorizacao/pedido'))).toBe(false);
    });

    it('o pedido leva só o ajuste de vídeo e o id da conta, e a ligação fica cifrada', async () => {
      const { contaId, dono } = await novaConta();
      const chave = await ligar(contaId, dono);
      const p = estadoDoPedido();
      expect(p.scope).toBe('videos.ajustar');
      expect(p.conta_empresa_id).toBe(contaId);
      expect(p.redirect_uri).toBe(VOLTA);
      expect(p.code_challenge_method).toBe('S256');
      const { rows } = await poolSuper.query('select segredo_cifrado, permissoes from dms_graph_ligacao where conta_id = $1 and revogada_em is null', [contaId]);
      expect(rows).toHaveLength(1);
      expect(rows[0].segredo_cifrado).not.toContain(chave);
      expect(decifrarToken(rows[0].segredo_cifrado, env.integracoes.chave!)).toBe(chave);
      expect(rows[0].permissoes).toEqual(['videos.ajustar']);
      const s = await servico.situacao(contaId, 'dono');
      expect(s.ligacao?.contaNome).toBe('Brasa no Graph');
      expect(JSON.stringify(s)).not.toContain(chave);
    });

    it('a volta sem o iss do Graph não vale, e o pedido não é gasto', async () => {
      const { contaId, dono } = await novaConta();
      await servico.iniciarClique(contaId, dono);
      const state = estadoDoPedido().state!;
      expect((await falha(servico.concluirClique(contaId, dono, { code: CODIGO, state, iss: 'https://outro.exemplo' }))).status).toBe(400);
      const { rows } = await poolSuper.query('select usado_em from dms_graph_pedido where conta_id = $1', [contaId]);
      expect(rows[0].usado_em).toBeNull();
    });

    it('o pedido vale uma vez e só para quem começou', async () => {
      const { contaId, dono } = await novaConta();
      const outro = randomUUID();
      await poolSuper.query('insert into usuario (id, conta_id, nome, email, senha_hash, papel, status) values ($1, $2, $3, $4, $5, $6, $7)', [outro, contaId, 'Outra Pessoa', `o-${outro.slice(0, 8)}@brasa.exemplo`, 'hash', 'operador', 'ativo']);
      const { chave } = gerarChave('lg', 'graph');
      porta.token = () => ({ status: 200, corpo: { ligacao: chave, prefixo: 'p', permissoes: ['videos.ajustar'] } });
      await servico.iniciarClique(contaId, dono);
      const state = estadoDoPedido().state!;
      expect((await falha(servico.concluirClique(contaId, { id: outro, nome: 'Outra' }, { code: CODIGO, state, iss: ORIGEM }))).status).toBe(400);
      await servico.concluirClique(contaId, dono, { code: CODIGO, state, iss: ORIGEM });
      expect((await falha(servico.concluirClique(contaId, dono, { code: CODIGO, state, iss: ORIGEM }))).status).toBe(400);
    });

    it('não autorizou: nada muda', async () => {
      const { contaId, dono } = await novaConta();
      await servico.iniciarClique(contaId, dono);
      const r = await servico.concluirClique(contaId, dono, { error: 'access_denied', state: estadoDoPedido().state, iss: ORIGEM });
      expect(r).toEqual({ situacao: 'recusado' });
      expect((await servico.situacao(contaId, 'dono')).ligacao).toBeNull();
    });

    it('ligação sem a permissão de ajustar: é desfeita lá e nada se guarda', async () => {
      const { contaId, dono } = await novaConta();
      await falha(ligar(contaId, dono, ['imagens.criar']));
      expect(chamadas.some((c) => c.metodo === 'DELETE' && c.url.endsWith('/v1/dms-id/ligacao'))).toBe(true);
      const { rows } = await poolSuper.query('select 1 from dms_graph_ligacao where conta_id = $1', [contaId]);
      expect(rows).toHaveLength(0);
    });

    it('conectar de novo troca a ligação: fica uma viva só', async () => {
      const { contaId, dono } = await novaConta();
      await ligar(contaId, dono);
      await ligar(contaId, dono);
      const { rows } = await poolSuper.query(`select count(*) filter (where revogada_em is null)::int as vivas, count(*) filter (where revogada_origem = 'troca')::int as trocadas from dms_graph_ligacao where conta_id = $1`, [contaId]);
      expect(rows[0]).toEqual({ vivas: 1, trocadas: 1 });
    });

    it('desligar sai aqui, avisa o Graph e repetir não dá erro', async () => {
      const { contaId, dono } = await novaConta();
      const chave = await ligar(contaId, dono);
      expect(await servico.desligar(contaId, dono)).toEqual({ desligada: true });
      const d = chamadas.find((c) => c.metodo === 'DELETE');
      expect(d?.cabecalhos.get('dms-ligacao')).toBe(chave);
      expect(await servico.desligar(contaId, dono)).toEqual({ desligada: false });
      expect((await servico.situacao(contaId, 'dono')).ligacao).toBeNull();
    });
  });

  describe('o ajuste de vídeo', () => {
    it('sem ligação, recusa', async () => {
      const { contaId, dono } = await novaConta();
      const m = await novaMidia(contaId);
      expect((await falha(servico.ajustar(contaId, dono.id, m, { proporcao: '9:16' }))).status).toBe(409);
    });

    it('vídeo acima de 12 MB: avisa, não vai ao Graph e continua valendo', async () => {
      const { contaId, dono } = await novaConta();
      await ligar(contaId, dono);
      const m = await novaMidia(contaId, mp4(AJUSTE_MAX_BYTES + 1));
      const info = await servico.mediaParaAjuste(contaId, m);
      expect(info.podeAjustar).toBe(false);
      expect(info.motivo).toMatch(/12 MB/);
      chamadas = [];
      expect((await falha(servico.ajustar(contaId, dono.id, m, { proporcao: '9:16' }))).message).toMatch(/12 MB/);
      expect(chamadas.some((c) => c.url === MCP)).toBe(false);
    });

    it('a mídia de outra conta não existe para quem pede', async () => {
      const a = await novaConta();
      const b = await novaConta();
      await ligar(a.contaId, a.dono);
      const deB = await novaMidia(b.contaId);
      expect((await falha(servico.ajustar(a.contaId, a.dono.id, deB, { proporcao: '9:16' }))).status).toBe(404);
    });

    it('de ponta a ponta: pede, consulta, baixa e vira UMA mídia nova; a original não muda', async () => {
      const { contaId, dono } = await novaConta();
      const chave = await ligar(contaId, dono);
      const original = mp4(100);
      const m = await novaMidia(contaId, original);
      const resultado = mp4(40);
      let situacao: 'processando' | 'pronto' = 'processando';
      const args: Record<string, unknown>[] = [];
      porta.ferramenta = (nome, a) => {
        args.push({ nome, ...a });
        return { dados: situacao === 'pronto' ? pronta(resultado) : { tarefa, ferramenta: 'ajustar_video', situacao: 'processando', consultarEmSegundos: 5 } };
      };
      porta.arquivo = () => ({ status: 200, bytes: resultado });

      const r1 = await servico.ajustar(contaId, dono.id, m, { inicioSegundos: 0, fimSegundos: 15, proporcao: '9:16', texto: 'Só hoje: 2 por 1' });
      expect(r1.situacao).toBe('processando');
      expect(args[0]).toMatchObject({
        nome: 'ajustar_video',
        cortar: { inicioSegundos: 0, fimSegundos: 15 },
        proporcao: { alvo: '9:16', modo: 'preencher' },
        comprimir: { ladoMenor: 720, qualidade: 'media' },
        texto: { texto: 'Só hoje: 2 por 1', posicao: 'base' },
        video: { mimeType: 'video/mp4', arquivoBase64: original.toString('base64') },
      });
      const mcp = chamadas.find((c) => c.url === MCP);
      expect(mcp?.cabecalhos.get('dms-ligacao')).toBe(chave);

      expect((await servico.consultar(contaId, r1.id)).situacao).toBe('processando');
      situacao = 'pronto';
      // Duas abas consultando ao mesmo tempo: uma mídia só.
      const [a, b] = await Promise.all([servico.consultar(contaId, r1.id), servico.consultar(contaId, r1.id)]);
      expect(a.situacao).toBe('pronto');
      expect(b.situacao).toBe('pronto');
      if (a.situacao !== 'pronto' || b.situacao !== 'pronto') throw new Error('não ficou pronto');
      expect(a.referencia).toBe(b.referencia);
      expect(a.bytes).toBe(resultado.length);

      const { rows } = await poolSuper.query('select id, nome_arquivo, conteudo from midia where conta_id = $1 order by criado_em', [contaId]);
      expect(rows).toHaveLength(2);
      expect(Buffer.compare(rows.find((x) => x.id === m).conteudo, original)).toBe(0);
      const nova = rows.find((x) => x.id !== m);
      expect(nova.nome_arquivo).toBe('promo-ajustado.mp4');
      expect(Buffer.compare(nova.conteudo, resultado)).toBe(0);

      // Repetir o mesmo pedido devolve o mesmo resultado, sem ir ao Graph.
      const antesDeRepetir = chamadas.filter((c) => c.url === MCP).length;
      const r2 = await servico.ajustar(contaId, dono.id, m, { inicioSegundos: 0, fimSegundos: 15, proporcao: '9:16', texto: 'Só hoje: 2 por 1' });
      expect(r2).toMatchObject({ situacao: 'pronto', referencia: a.referencia });
      expect(chamadas.filter((c) => c.url === MCP).length).toBe(antesDeRepetir);
    });

    it('o link fora da origem do Graph não é baixado', async () => {
      const { contaId, dono } = await novaConta();
      await ligar(contaId, dono);
      const m = await novaMidia(contaId);
      const dados = pronta(mp4());
      dados.resultado.link = 'https://atacante.exemplo/midia/x';
      porta.ferramenta = () => ({ dados });
      const r = await servico.ajustar(contaId, dono.id, m, { proporcao: '1:1' });
      expect(r.situacao).toBe('erro');
      expect(chamadas.some((c) => c.url.startsWith('https://atacante'))).toBe(false);
    });

    it('o arquivo que não é MP4 ou de tamanho diferente do declarado não vira mídia', async () => {
      const { contaId, dono } = await novaConta();
      await ligar(contaId, dono);
      const m = await novaMidia(contaId);
      const declarado = mp4(40);
      porta.ferramenta = () => ({ dados: pronta(declarado) });
      porta.arquivo = () => ({ status: 200, bytes: Buffer.alloc(declarado.length, 1) });
      const r = await servico.ajustar(contaId, dono.id, m, { proporcao: '1:1' });
      expect(r).toMatchObject({ situacao: 'erro', podeRepetir: true });
      const { rows } = await poolSuper.query('select count(*)::int as n from midia where conta_id = $1', [contaId]);
      expect(rows[0].n).toBe(1);
    });

    it('recusa da ferramenta: a frase dela e se pode repetir; a que não pode não vai de novo', async () => {
      const { contaId, dono } = await novaConta();
      await ligar(contaId, dono);
      const m = await novaMidia(contaId);
      let vezes = 0;
      porta.ferramenta = () => {
        vezes += 1;
        return { erro: { situacao: 'recusado', codigo: 'parametro-invalido', pode_repetir: false, frase: 'O conteúdo do vídeo não corresponde ao formato informado.' } };
      };
      const r = await servico.ajustar(contaId, dono.id, m, { proporcao: '1:1' });
      expect(r).toMatchObject({ situacao: 'erro', frase: 'O conteúdo do vídeo não corresponde ao formato informado.', podeRepetir: false });
      await servico.ajustar(contaId, dono.id, m, { proporcao: '1:1' });
      expect(vezes).toBe(1);
    });

    it('erro que pode repetir: a nova tentativa usa a MESMA chave no Graph', async () => {
      const { contaId, dono } = await novaConta();
      await ligar(contaId, dono);
      const m = await novaMidia(contaId);
      const chaves: unknown[] = [];
      const resultado = mp4(30);
      let vez = 0;
      porta.ferramenta = (_n, a) => {
        chaves.push(a.chaveIdempotencia);
        vez += 1;
        return vez === 1 ? { erro: { situacao: 'recusado', codigo: 'limite-de-chamadas', pode_repetir: true, frase: 'Esta empresa já tem um vídeo sendo ajustado.' } } : { dados: pronta(resultado) };
      };
      porta.arquivo = () => ({ status: 200, bytes: resultado });
      expect(await servico.ajustar(contaId, dono.id, m, { proporcao: '1:1' })).toMatchObject({ situacao: 'erro', podeRepetir: true });
      expect((await servico.ajustar(contaId, dono.id, m, { proporcao: '1:1' })).situacao).toBe('pronto');
      expect(chaves).toHaveLength(2);
      expect(chaves[0]).toBe(chaves[1]);
    });

    it('o resultado venceu no Graph: libera a chave e a próxima tentativa nasce com outra', async () => {
      const { contaId, dono } = await novaConta();
      await ligar(contaId, dono);
      const m = await novaMidia(contaId);
      const chaves: unknown[] = [];
      let fase: 'cria' | 'vencida' | 'nova' = 'cria';
      const resultado = mp4(20);
      porta.ferramenta = (nome, a) => {
        if (nome === 'ajustar_video') chaves.push(a.chaveIdempotencia);
        if (fase === 'cria') return { dados: { tarefa, ferramenta: 'ajustar_video', situacao: 'processando' } };
        if (fase === 'vencida') return { erro: { situacao: 'recusado', codigo: 'nao-encontrado', pode_repetir: false, frase: 'Não há tarefa com este número, ou ela venceu.' } };
        return { dados: pronta(resultado) };
      };
      porta.arquivo = () => ({ status: 200, bytes: resultado });
      const r1 = await servico.ajustar(contaId, dono.id, m, { proporcao: '1:1' });
      fase = 'vencida';
      expect(await servico.consultar(contaId, r1.id)).toMatchObject({ situacao: 'erro', podeRepetir: true });
      fase = 'nova';
      const r2 = await servico.ajustar(contaId, dono.id, m, { proporcao: '1:1' });
      expect(r2.situacao).toBe('pronto');
      expect(r2.id).not.toBe(r1.id);
      expect(chaves[0]).not.toBe(chaves[1]);
    });

    it('a ligação desfeita no Graph: marca, e a tela oferece conectar de novo', async () => {
      const { contaId, dono } = await novaConta();
      await ligar(contaId, dono);
      const m = await novaMidia(contaId);
      porta.ferramenta = () => ({ status: 401, problema: 'ligacao-invalida' });
      expect(await servico.ajustar(contaId, dono.id, m, { proporcao: '1:1' })).toMatchObject({ situacao: 'erro', podeRepetir: false });
      const s = await servico.situacao(contaId, 'dono');
      expect(s.ligacao).toBeNull();
      expect(s.desligadaPeloGraphEm).not.toBeNull();
    });

    it('a queda na consulta não derruba o ajuste: segue processando', async () => {
      const { contaId, dono } = await novaConta();
      await ligar(contaId, dono);
      const m = await novaMidia(contaId);
      porta.ferramenta = () => ({ dados: { tarefa, ferramenta: 'ajustar_video', situacao: 'processando' } });
      const r = await servico.ajustar(contaId, dono.id, m, { proporcao: '1:1' });
      porta.ferramenta = () => ({ status: 503, problema: 'integracao-parada' });
      expect((await servico.consultar(contaId, r.id)).situacao).toBe('processando');
    });

    it('a RLS: outra conta não lê o ajuste', async () => {
      const a = await novaConta();
      const b = await novaConta();
      await ligar(a.contaId, a.dono);
      const m = await novaMidia(a.contaId);
      porta.ferramenta = () => ({ dados: { tarefa, ferramenta: 'ajustar_video', situacao: 'processando' } });
      const r = await servico.ajustar(a.contaId, a.dono.id, m, { proporcao: '1:1' });
      expect((await falha(servico.consultar(b.contaId, r.id))).status).toBe(404);
    });
  });
});
