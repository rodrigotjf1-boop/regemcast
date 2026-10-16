/**
 * A ligação do Hub DMS no Postgres de verdade: o SQL do serviço (troca,
 * reconhecimento, revogação casada) e a conferência dos anúncios, rodando como
 * `regemcast_app` — com a RLS valendo, como em produção.
 *
 * Precisa de um banco DESCARTÁVEL com as migrations aplicadas; sem as duas
 * variáveis, pula (o CI não tem banco):
 *
 *   REGEMCAST_TESTE_PG_URL    o banco como regemcast_app (quem o serviço usa)
 *   REGEMCAST_TESTE_PG_SUPER  o mesmo banco como dono (só para montar contas e números)
 *
 * Cada execução cria contas novas (ids aleatórios) e não apaga nada: a trilha
 * de auditoria é imutável.
 */
jest.mock('../../config/env', () => ({ env: {} }));

import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { ContextoDb } from '../../db/contexto';
import * as schema from '../../db/schema';
import { ErroProblema, resumoChave } from '../../dms/integracao-dms';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ConversaAnuncioService } from '../meta/anuncio.service';
import { IntegracaoService } from './integracao.service';
import { LIGACAO_INVALIDA, TROCA_RECUSADA } from './ligacao.regras';

const URL_APP = process.env.REGEMCAST_TESTE_PG_URL;
const URL_SUPER = process.env.REGEMCAST_TESTE_PG_SUPER;
const descrever = URL_APP && URL_SUPER ? describe : describe.skip;

const APP_A = 'aplicativo-a-de-teste';
const APLICATIVOS = { liame: APP_A, gogem: 'aplicativo-b-de-teste' };
const TODAS = ['conta.ler', 'orcamento.ler', 'conversas.anuncio.ler', 'campanhas.disparar'];

descrever('a ligação do Hub DMS no Postgres', () => {
  let poolApp: Pool;
  let poolSuper: Pool;
  let ctx: ContextoDb;
  let servico: IntegracaoService;

  beforeAll(() => {
    poolApp = new Pool({ connectionString: URL_APP, max: 4 });
    poolSuper = new Pool({ connectionString: URL_SUPER, max: 2 });
    ctx = new ContextoDb(drizzle(poolApp, { schema }));
    servico = new IntegracaoService(ctx, new AuditoriaService(ctx));
  });
  afterAll(async () => {
    await poolApp.end();
    await poolSuper.end();
  });

  async function novaConta(status = 'aprovada'): Promise<string> {
    const id = randomUUID();
    await poolSuper.query('insert into conta (id, nome, status) values ($1, $2, $3)', [id, 'Loja de teste', status]);
    return id;
  }

  async function emitir(contaId: string, o: { produto?: string; classe?: 'dms' | 'externo'; escopos?: string[] } = {}) {
    const { token, emitido } = await servico.emitir(
      contaId,
      { produto: o.produto ?? 'liame', classe: o.classe ?? 'dms', nome: 'Liame (teste)', escopos: o.escopos ?? (o.classe === 'externo' ? ['conta.ler'] : TODAS) },
      'operador-de-teste',
    );
    return { token, id: emitido.id };
  }

  const ligacaoNoBanco = async (id: string) =>
    (await poolSuper.query('select * from integracao_ligacao where id = $1', [id])).rows[0] as Record<string, unknown> | undefined;

  const recusa = async (p: Promise<unknown>) => {
    const erro = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(ErroProblema);
    return erro as ErroProblema;
  };

  it('a troca grava a ligação com o id, a conta, o produto e as permissões do token, e só o resumo do segredo', async () => {
    const contaId = await novaConta();
    const { token, id } = await emitir(contaId);

    const entregue = await servico.trocarPorLigacao(token, APP_A, APLICATIVOS);
    expect(entregue).toEqual({ ligacao: expect.stringMatching(/^dms_lg_regemcast_/), prefixo: expect.any(String), conta_id: contaId, conta: 'Loja de teste', permissoes: TODAS, segredo_em: expect.any(String) });

    const l = await ligacaoNoBanco(id);
    expect(l).toEqual(
      expect.objectContaining({ id, conta_id: contaId, aplicativo: APP_A, produto: 'liame', classe: 'dms', origem_token_id: id, escopos: TODAS, segredo_hash: resumoChave(entregue.ligacao), revogado_em: null }),
    );
    expect(JSON.stringify(l)).not.toContain(entregue.ligacao);
  });

  it('a ligação é reconhecida com a conta dela, as permissões das duas e o último uso nos dois registros', async () => {
    const contaId = await novaConta();
    const { token, id } = await emitir(contaId);
    const { ligacao } = await servico.trocarPorLigacao(token, APP_A, APLICATIVOS);

    const quem = await servico.autenticarLigacao(ligacao, { aplicativo: APP_A, permissoes: ['orcamento.ler', 'campanhas.ler'] }, APLICATIVOS);
    expect(quem).toEqual({ tokenId: id, contaId, contaNome: 'Loja de teste', contaFuso: 'America/Sao_Paulo', produto: 'liame', classe: 'dms', nome: 'Liame (teste)', escopos: ['orcamento.ler'] });

    const usos = await poolSuper.query(
      'select (select ultimo_uso_em from integracao_ligacao where id = $1) is not null as da_ligacao, (select ultimo_uso_em from integracao_token where id = $1) is not null as do_token',
      [id],
    );
    expect(usos.rows[0]).toEqual({ da_ligacao: true, do_token: true });
  });

  it('repetir a troca gira o segredo: o anterior para de valer, e a trilha diz criada e depois girada', async () => {
    const contaId = await novaConta();
    const { token, id } = await emitir(contaId);
    const primeira = await servico.trocarPorLigacao(token, APP_A, APLICATIVOS);
    const segunda = await servico.trocarPorLigacao(token, APP_A, APLICATIVOS);
    expect(segunda.ligacao).not.toBe(primeira.ligacao);

    const doToken = { aplicativo: APP_A, permissoes: TODAS };
    expect((await recusa(servico.autenticarLigacao(primeira.ligacao, doToken, APLICATIVOS))).detalhe).toBe(LIGACAO_INVALIDA);
    expect((await servico.autenticarLigacao(segunda.ligacao, doToken, APLICATIVOS)).tokenId).toBe(id);

    const trilha = await poolSuper.query("select acao, ator_tipo from auditoria where conta_id = $1 and entidade = 'integracao_ligacao' order by id", [contaId]);
    expect(trilha.rows).toEqual([
      { acao: 'integracao.ligacao_criada', ator_tipo: 'integracao' },
      { acao: 'integracao.ligacao_girada', ator_tipo: 'integracao' },
    ]);
  });

  it('a troca recusa, com a mesma resposta, o token de outro aplicativo, de cliente de fora, revogado ou que não existe', async () => {
    const contaId = await novaConta();
    const doLiame = await emitir(contaId);
    const deFora = await emitir(contaId, { classe: 'externo', produto: 'liame' });
    const revogado = await emitir(contaId);
    await servico.revogarPeloConsole(revogado.id, 'operador-de-teste');

    for (const [token, aplicativo] of [
      [doLiame.token, 'aplicativo-b-de-teste'],
      [deFora.token, APP_A],
      [revogado.token, APP_A],
      ['rct_it_' + 'A'.repeat(43), APP_A],
      ['nao-e-token', APP_A],
    ] as const) {
      const e = await recusa(servico.trocarPorLigacao(token, aplicativo, APLICATIVOS));
      expect([e.tipo, e.status, e.detalhe]).toEqual(['ligacao-invalida', 401, TROCA_RECUSADA]);
    }
    const nenhuma = await poolSuper.query('select count(*)::int as n from integracao_ligacao where conta_id = $1', [contaId]);
    expect(nenhuma.rows[0].n).toBe(0);
  });

  it('a ligação revogada não volta pela troca, nem com o token ainda ativo', async () => {
    const contaId = await novaConta();
    const { token, id } = await emitir(contaId);
    await servico.trocarPorLigacao(token, APP_A, APLICATIVOS);
    // A revogação só da ligação (a autorizada por clique, na parte B, é revogada sozinha).
    await poolSuper.query("update integracao_ligacao set revogado_em = now(), revogado_por = 'teste' where id = $1", [id]);

    expect((await recusa(servico.trocarPorLigacao(token, APP_A, APLICATIVOS))).detalhe).toBe(TROCA_RECUSADA);
    expect((await ligacaoNoBanco(id))?.revogado_por).toBe('teste');
  });

  it('conta suspensa: a troca e a ligação recusam com conta-bloqueada', async () => {
    const contaId = await novaConta();
    const { token } = await emitir(contaId);
    const { ligacao } = await servico.trocarPorLigacao(token, APP_A, APLICATIVOS);
    await poolSuper.query("update conta set status = 'suspensa' where id = $1", [contaId]);

    expect((await recusa(servico.trocarPorLigacao(token, APP_A, APLICATIVOS))).tipo).toBe('conta-bloqueada');
    expect((await recusa(servico.autenticarLigacao(ligacao, { aplicativo: APP_A, permissoes: TODAS }, APLICATIVOS))).tipo).toBe('conta-bloqueada');
  });

  describe('revogar um revoga o outro', () => {
    const doToken = { aplicativo: APP_A, permissoes: TODAS };

    it('pela distribuição, no console', async () => {
      const contaId = await novaConta();
      const { token, id } = await emitir(contaId);
      const { ligacao } = await servico.trocarPorLigacao(token, APP_A, APLICATIVOS);
      await servico.revogarPeloConsole(id, 'operador-de-teste');

      expect((await ligacaoNoBanco(id))?.revogado_em).not.toBeNull();
      expect((await recusa(servico.autenticarLigacao(ligacao, doToken, APLICATIVOS))).tipo).toBe('ligacao-invalida');
      expect((await recusa(servico.trocarPorLigacao(token, APP_A, APLICATIVOS))).tipo).toBe('ligacao-invalida');
    });

    it('pelo dono da conta, e só na conta dele (a RLS não deixa outra conta alcançar a ligação)', async () => {
      const contaA = await novaConta();
      const contaB = await novaConta();
      const { token, id } = await emitir(contaA);
      const { ligacao } = await servico.trocarPorLigacao(token, APP_A, APLICATIVOS);
      const dono = { id: randomUUID(), nome: 'Dono de teste' };

      await expect(ctx.comConta(contaB, () => servico.revogarPelaConta(contaB, dono, id))).rejects.toThrow('Aplicativo não encontrado.');
      expect((await ligacaoNoBanco(id))?.revogado_em).toBeNull();

      await ctx.comConta(contaA, () => servico.revogarPelaConta(contaA, dono, id));
      expect((await ligacaoNoBanco(id))?.revogado_por).toBe('Dono de teste');
      expect((await recusa(servico.autenticarLigacao(ligacao, doToken, APLICATIVOS))).tipo).toBe('ligacao-invalida');
    });

    it('pelo próprio aplicativo, chamando pela via do DMS ID', async () => {
      const contaId = await novaConta();
      const { token, id } = await emitir(contaId);
      const { ligacao } = await servico.trocarPorLigacao(token, APP_A, APLICATIVOS);
      const quem = await servico.autenticarLigacao(ligacao, doToken, APLICATIVOS);

      await ctx.comConta(contaId, () => servico.revogarPeloProprio(quem));
      const r = await poolSuper.query('select (select revogado_em from integracao_token where id = $1) is not null as token, (select revogado_em from integracao_ligacao where id = $1) is not null as ligacao', [id]);
      expect(r.rows[0]).toEqual({ token: true, ligacao: true });
      await expect(servico.autenticar(token)).rejects.toThrow('Token de integração inválido ou revogado.');
      expect((await recusa(servico.autenticarLigacao(ligacao, doToken, APLICATIVOS))).tipo).toBe('ligacao-invalida');
    });
  });

  it('duas trocas ao mesmo tempo: as duas respondem, fica uma ligação só, e vale o segredo da que gravou por último', async () => {
    const contaId = await novaConta();
    const { token, id } = await emitir(contaId);
    const [a, b] = await Promise.all([servico.trocarPorLigacao(token, APP_A, APLICATIVOS), servico.trocarPorLigacao(token, APP_A, APLICATIVOS)]);

    const linhas = await poolSuper.query('select segredo_hash from integracao_ligacao where conta_id = $1', [contaId]);
    expect(linhas.rows).toHaveLength(1);
    const valendo = [a, b].filter((x) => resumoChave(x.ligacao) === linhas.rows[0].segredo_hash);
    expect(valendo).toHaveLength(1);
    expect((await servico.autenticarLigacao(valendo[0]!.ligacao, { aplicativo: APP_A, permissoes: TODAS }, APLICATIVOS)).tokenId).toBe(id);
  });

  it('a troca trava a linha do token: enquanto outra transação a segura, a troca espera', async () => {
    const contaId = await novaConta();
    const { token, id } = await emitir(contaId);
    const outra = await poolSuper.connect();
    try {
      await outra.query('begin');
      // `for no key update` não conflita com a trava da chave estrangeira (`for key share`) do insert da ligação: só a
      // trava da própria troca (`for update`) espera por ela. Sem a trava, a troca terminaria aqui mesmo.
      await outra.query('select 1 from integracao_token where id = $1 for no key update', [id]);
      let terminou = false;
      const troca = servico.trocarPorLigacao(token, APP_A, APLICATIVOS).then((r) => {
        terminou = true;
        return r;
      });
      await new Promise((pronto) => setTimeout(pronto, 700));
      expect(terminou).toBe(false);
      await outra.query('commit');
      expect((await troca).conta_id).toBe(contaId);
    } finally {
      await outra.query('rollback').catch(() => undefined);
      outra.release();
    }
  });

  it('a ligação sozinha (sem token) conta como aplicativo conectado para guardar a conversa aberta por anúncio', async () => {
    const contaId = await novaConta();
    const phoneNumberId = `numero-de-teste-${randomUUID()}`;
    const waConta = randomUUID();
    await poolSuper.query('insert into wa_conta (id, conta_id, waba_id) values ($1, $2, $3)', [waConta, contaId, `waba-${phoneNumberId}`]);
    await poolSuper.query('insert into wa_numero (conta_id, wa_conta_id, phone_number_id) values ($1, $2, $3)', [contaId, waConta, phoneNumberId]);
    const anuncios = new ConversaAnuncioService(ctx);
    const aviso = (wamid: string) => ({
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '5521900000000', phone_number_id: phoneNumberId },
      contacts: [{ profile: { name: 'Fulana' }, wa_id: '5521900000001' }],
      messages: [{ from: '5521900000001', id: wamid, timestamp: '1790622760', type: 'text', text: { body: 'Quero o combo' }, referral: { source_url: 'https://exemplo.invalid/anuncio', source_id: 'anuncio-de-teste', source_type: 'ad', ctwa_clid: 'clique-de-teste' } }],
    });

    expect(await anuncios.registrar(phoneNumberId, aviso('wamid.sem-aplicativo'))).toBe(0);

    // A ligação autorizada por clique (parte B da F2) não tem token de origem.
    await poolSuper.query(
      `insert into integracao_ligacao (conta_id, aplicativo, produto, classe, nome, segredo_hash, prefixo, escopos)
       values ($1, $2, 'liame', 'dms', 'Liame (teste)', $3, 'dms_lg_regemcast_teste', '["conversas.anuncio.ler"]'::jsonb)`,
      [contaId, APP_A, resumoChave(randomUUID())],
    );
    expect(await anuncios.registrar(phoneNumberId, aviso('wamid.com-ligacao'))).toBe(1);
  });
});
