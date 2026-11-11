/**
 * A aprovação de disparos do Hub DMS (F5 parte B) contra o Postgres de verdade,
 * como `regemcast_app` (a RLS valendo), com o serviço de verdade:
 *
 * - os 8 casos comuns do pacote (`casosDoPedidoDeAcao`): sem aprovação não
 *   executa, a aprovação de outro plano não vale, vale uma vez só, o vencido não
 *   executa, quem pediu não aprova, sem o segundo fator não aprova, o recusado
 *   não executa e a mesma chave devolve o mesmo pedido;
 * - o gatilho das transições, um pedido aberto por campanha, o plano que muda
 *   (a variável fixa, o texto do modelo na Meta), o aplicativo desligado e a
 *   parada do hub, a trava do código que sobrevive à recusa, o cancelamento por
 *   quem pediu, o limite de pedidos esperando, o disparo recusado que deixa o
 *   pedido aprovado sem resíduo, e a folga do teto (moeda, tarifa, preço).
 *
 * O disparo e a Meta são dublês (a campanha muda de verdade no banco; a Meta
 * devolve o modelo que o teste escolhe). Precisa de um banco DESCARTÁVEL com as
 * migrations; sem as duas variáveis, pula (o CI não tem banco):
 * REGEMCAST_TESTE_PG_URL (como regemcast_app) e REGEMCAST_TESTE_PG_SUPER.
 * Identificadores visivelmente fictícios: o repositório é público (V34).
 */
const CHAVE_TOTP_DE_TESTE = Buffer.alloc(32, 7).toString('base64');
jest.mock('../../config/env', () => ({
  env: {
    rede: { appUrl: 'https://cast.exemplo' },
    seguranca: { totpChave: Buffer.alloc(32, 7).toString('base64') },
    aprovacao: { soComAprovacao: false },
  },
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { codigoDoPasso, deBase32, novoSegredo, passoDe } from '../../common/totp';
import { ContextoDb } from '../../db/contexto';
import * as schema from '../../db/schema';
import {
  casosDoPedidoDeAcao,
  ErroProblema,
  resumoDaPessoa,
  situacaoAgora,
  type AdaptadorDoPedido,
  type QuemPede,
} from '../../dms/integracao-dms';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { CampanhaService, ResumoCampanha } from '../campanha/campanha.service';
import type { HubService } from '../hub/hub.service';
import { cifrarToken } from '../meta/cripto';
import type { MetaService } from '../meta/meta.service';
import { folgaDoTeto } from '../orcamento/orcamento.consulta';
import { AprovacaoService, pedidoDaLinha, type QuemPedePelaPorta } from './aprovacao.service';
import type { AvisoDeAprovacao } from './aviso-de-aprovacao.service';
import { ErroDoPedido } from './erro-do-pedido';

const URL_APP = process.env.REGEMCAST_TESTE_PG_URL;
const URL_SUPER = process.env.REGEMCAST_TESTE_PG_SUPER;
const descrever = URL_APP && URL_SUPER ? describe : describe.skip;

const PRODUTO = 'liame';
const MODELO_ID = 'modelo-de-teste-0001';

descrever('a aprovação de disparos, no Postgres', () => {
  let poolApp: Pool;
  let poolSuper: Pool;
  let ctx: ContextoDb;
  let servico: AprovacaoService;
  let deslocamento = 0;
  /** O texto do modelo na Meta (o teste muda para provar que o plano muda). */
  let textoNaMeta = 'Oi, {{1}}! Sexta tem combo em dobro. Use o cupom {{2}}.';
  /** Quantas vezes o disparo aconteceu, por campanha. */
  const efeitos = new Map<string, number>();
  /** O disparo do dublê recusa (como a conferência da tela recusaria) enquanto isto for verdadeiro. */
  let disparoRecusa = false;
  const hub = { registrarAcao: jest.fn(), parado: jest.fn((): unknown => null) };
  const avisos = { pedidoNovo: jest.fn(async () => undefined) };

  /** O dublê do serviço de campanha: lê e muda a campanha de verdade, no banco da transação corrente. */
  const campanhas = {
    async detalhe(contaId: string, id: string): Promise<ResumoCampanha> {
      const c = (await ctx.db.execute<Record<string, unknown>>(sql`select * from campanha where id = ${id} and conta_id = ${contaId}`)).rows[0];
      if (!c) throw new NotFoundException('Campanha não encontrada.');
      const st = (await ctx.db.execute<{ status: string; n: number }>(sql`
        select status, count(*)::int as n from campanha_destinatario where campanha_id = ${id} group by 1
      `)).rows;
      const porStatus = Object.fromEntries(st.map((l) => [l.status, Number(l.n)]));
      const total = st.reduce((s, l) => s + Number(l.n), 0);
      const naFila = (porStatus.pendente ?? 0) + (porStatus.enviando ?? 0);
      return {
        id,
        nome: String(c.nome),
        modeloNome: String(c.modelo_nome),
        modeloIdioma: String(c.modelo_idioma),
        modeloCategoria: (c.modelo_categoria as string | null) ?? null,
        status: String(c.status),
        variavelCabecalho: null,
        publicoRotulo: (c.publico_rotulo as string | null) ?? null,
        listaNome: null,
        total,
        porStatus,
        custo: { moeda: 'BRL', gastoCentavos: 0, aSairCentavos: naFila * 30, linhas: [], avisos: [] },
      } as unknown as ResumoCampanha;
    },
    oQueImpedeODisparo: jest.fn(async (): Promise<string | null> => null),
    async disparar(contaId: string, _usuarioId: string | null, id: string, opcoes: { pedidoId?: string } = {}): Promise<ResumoCampanha> {
      if (!opcoes.pedidoId) throw new Error('a execução do pedido dispara com o pedido');
      // Grava antes de recusar: a recusa tem de desfazer o que o disparo já tinha mudado (o ponto de salvamento).
      await ctx.db.execute(sql`update campanha set status = 'agendada' where id = ${id} and conta_id = ${contaId} and status = 'rascunho'`);
      if (disparoRecusa) throw new BadRequestException('Conecte sua conta do WhatsApp antes de disparar.');
      efeitos.set(id, (efeitos.get(id) ?? 0) + 1);
      return campanhas.detalhe(contaId, id);
    },
  };
  const meta = {
    modelos: jest.fn(async () => [
      { id: MODELO_ID, nome: 'combo_semana', idioma: 'pt_BR', categoria: 'MARKETING', cabecalho: null, corpo: textoNaMeta, rodape: null, botoes: [] },
    ]),
  };

  beforeAll(async () => {
    poolApp = new Pool({ connectionString: URL_APP, max: 8 });
    poolSuper = new Pool({ connectionString: URL_SUPER, max: 2 });
    ctx = new ContextoDb(drizzle(poolApp, { schema }));
    servico = new AprovacaoService(
      ctx,
      campanhas as unknown as CampanhaService,
      meta as unknown as MetaService,
      new AuditoriaService(ctx),
      hub as unknown as HubService,
      avisos as unknown as AvisoDeAprovacao,
    );
    servico.agora = () => new Date(Date.now() + deslocamento);
  });
  afterAll(async () => {
    await poolApp?.end();
    await poolSuper?.end();
  });
  beforeEach(() => {
    deslocamento = 0;
    disparoRecusa = false;
    textoNaMeta = 'Oi, {{1}}! Sexta tem combo em dobro. Use o cupom {{2}}.';
    hub.parado.mockReturnValue(null);
    campanhas.oQueImpedeODisparo.mockResolvedValue(null);
  });

  // ------------------------------------------------------------------ ajudantes

  type Conta = { contaId: string; donoId: string; donoEmail: string; tokenId: string; segredo: string };

  async function novaConta(): Promise<Conta> {
    const contaId = randomUUID();
    await poolSuper.query('insert into conta (id, nome, status) values ($1, $2, $3)', [contaId, 'Hamburgueria Exemplo', 'ativa']);
    const donoId = randomUUID();
    const donoEmail = `dono-${donoId.slice(0, 8)}@exemplo.test`;
    const segredo = novoSegredo();
    await poolSuper.query(
      `insert into usuario (id, conta_id, nome, email, senha_hash, papel, status, dois_fatores, totp_segredo_cifrado)
       values ($1, $2, 'Paulo Exemplo', $3, 'x', 'dono', 'ativo', 'app', $4)`,
      [donoId, contaId, donoEmail, cifrarToken(segredo, CHAVE_TOTP_DE_TESTE)],
    );
    const tokenId = randomUUID();
    await poolSuper.query(
      `insert into integracao_token (id, conta_id, produto, classe, nome, token_hash, prefixo, escopos)
       values ($1, $2, $3, 'dms', 'Liame (teste)', $4, 'rct_it_teste', '["campanhas.disparar"]'::jsonb)`,
      [tokenId, contaId, PRODUTO, createHash('sha256').update(randomUUID()).digest('hex')],
    );
    return { contaId, donoId, donoEmail, tokenId, segredo };
  }

  async function novaCampanha(c: Conta, pessoas = 3): Promise<string> {
    const id = randomUUID();
    await poolSuper.query(
      `insert into campanha (id, conta_id, nome, modelo_id, modelo_nome, modelo_idioma, modelo_categoria, status, integracao_produto, variaveis_lista, publico_rotulo)
       values ($1, $2, 'Combo da sexta', $3, 'combo_semana', 'pt_BR', 'marketing', 'rascunho', $4, $5::jsonb, 'Clientes de exemplo')`,
      [id, c.contaId, MODELO_ID, PRODUTO, JSON.stringify([{ origem: 'nome', valor: null }, { origem: 'fixo', valor: 'SEXTA10' }])],
    );
    for (let i = 0; i < pessoas; i += 1) await maisUmaPessoa(c, id);
    return id;
  }

  async function maisUmaPessoa(c: Conta, campanhaId: string): Promise<void> {
    const tel = `55219000${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;
    await poolSuper.query(
      `insert into campanha_destinatario (conta_id, campanha_id, telefone_e164, variaveis) values ($1, $2, $3, '["Pessoa Exemplo", "SEXTA10"]'::jsonb)`,
      [c.contaId, campanhaId, tel],
    );
  }

  function quem(c: Conta): QuemPedePelaPorta {
    return { contaId: c.contaId, contaNome: 'Hamburgueria Exemplo', produto: PRODUTO, classe: 'dms', tokenId: c.tokenId, ligacaoPrefixo: 'rct_it_teste' };
  }

  const naConta = <T>(c: Conta, fn: () => Promise<T>) => ctx.comConta(c.contaId, fn);

  async function pedir(c: Conta, campanhaId: string, o: { chave?: string; confirmacao?: string; pedidoPor?: QuemPede } = {}) {
    return naConta(c, () =>
      servico.pedir(
        quem(c),
        { chave: o.chave ?? `chave-${randomUUID()}`, campanhaId, confirmacao: o.confirmacao ?? 'confirmacao-de-teste-0001', pedidoPor: o.pedidoPor ?? { tipo: 'agente' }, cupom: null },
        async () => undefined,
      ),
    );
  }

  async function linha(id: string) {
    const r = await poolSuper.query('select * from acao_pedido where id = $1', [id]);
    return r.rows[0] as Record<string, unknown>;
  }

  async function aprovarComo(c: Conta, id: string, o: { pessoa?: string; resumoVisto?: string; segundoFator?: boolean; teto?: number } = {}) {
    const resumoVisto = o.resumoVisto ?? String((await linha(id)).resumo_plano);
    return naConta(c, () =>
      servico.aprovarConferido(c.contaId, id, {
        pessoa: o.pessoa ?? resumoDaPessoa('outra-pessoa@exemplo.invalid'),
        podeAprovar: true,
        segundoFator: o.segundoFator ?? true,
        resumoVisto,
        tetoDeGastoCentavos: o.teto ?? 1_000,
        usuarioId: c.donoId,
        papel: 'dono',
      }),
    );
  }

  const codigoAgora = (c: Conta, passos = 0) => codigoDoPasso(deBase32(c.segredo), passoDe(new Date()) + passos);

  // ------------------------------------------------------- os casos comuns

  describe('os casos comuns do pacote (casosDoPedidoDeAcao)', () => {
    let conta: Conta;
    const campanhaDaChave = new Map<string, string>();
    const campanhaDoPedido = new Map<string, string>();

    beforeAll(async () => {
      conta = await novaConta();
    });

    const adaptador: AdaptadorDoPedido = {
      async pedir({ chave, plano, pedidoPor }) {
        let campanhaId = campanhaDaChave.get(chave);
        if (!campanhaId) {
          campanhaId = await novaCampanha(conta);
          campanhaDaChave.set(chave, campanhaId);
        }
        // O conteúdo do pedido entra pela confirmação: outro plano, outra confirmação, outra impressão.
        const confirmacao = createHash('sha256').update(JSON.stringify(plano)).digest('hex').slice(0, 32);
        const r = await pedir(conta, campanhaId, { chave, confirmacao, pedidoPor });
        campanhaDoPedido.set(r.pedido.id, campanhaId);
        return { id: r.pedido.id, situacao: r.pedido.situacao };
      },
      async aprovar(id, a) {
        await aprovarComo(conta, id, { pessoa: a.pessoa, resumoVisto: a.resumoVisto, segundoFator: a.segundoFator, teto: a.tetoDeGastoCentavos });
      },
      async recusar(id) {
        await naConta(conta, () => servico.recusarConferido(conta.contaId, id, { podeAprovar: true, usuarioId: conta.donoId, papel: 'dono', motivo: 'Motivo de teste.' }));
      },
      async executar(id) {
        const r = await naConta(conta, () => servico.executar(conta.contaId, id));
        if (r.resultado === 'encerrado') throw r.recusa;
        if (r.resultado === 'adiado') throw new Error(`adiado: ${r.aviso}`);
      },
      async mudarPlano(id) {
        await maisUmaPessoa(conta, campanhaDoPedido.get(id)!);
      },
      async avancar(ms) {
        deslocamento += ms;
      },
      async ler(id) {
        const [l] = await naConta(conta, () => ctx.db.select().from(schema.acaoPedido).where(eq(schema.acaoPedido.id, id)).limit(1));
        const p = pedidoDaLinha(l!);
        return { situacao: situacaoAgora(p, servico.agora()), resumoDoPlano: p.resumoDoPlano };
      },
      async efeitos(id) {
        return efeitos.get(campanhaDoPedido.get(id)!) ?? 0;
      },
    };

    for (const caso of casosDoPedidoDeAcao(adaptador)) it(caso.nome, caso.rodar, 30_000);
  });

  // --------------------------------------------------------- o gatilho

  describe('o gatilho do pedido (rc_acao_pedido_guarda)', () => {
    it('a situação só anda pelas transições do pacote, e o que prende o pedido não muda', async () => {
      const c = await novaConta();
      const { pedido } = await pedir(c, await novaCampanha(c));
      await expect(poolSuper.query(`update acao_pedido set situacao = 'executado' where id = $1`, [pedido.id])).rejects.toThrow(/nao vai de aguardando para executado/);
      await expect(poolSuper.query(`update acao_pedido set resumo_plano = repeat('a', 64) where id = $1`, [pedido.id])).rejects.toThrow(/nao muda depois de nascer/);
      await expect(poolSuper.query(`update acao_pedido set teto_gasto_centavos = 5 where id = $1`, [pedido.id])).rejects.toThrow(/teto de gasto so nasce na aprovacao/);
      await aprovarComo(c, pedido.id, { teto: 900 });
      await expect(poolSuper.query(`update acao_pedido set teto_gasto_centavos = 99999 where id = $1`, [pedido.id])).rejects.toThrow(/teto de gasto so nasce na aprovacao/);
      await expect(poolSuper.query(`update acao_pedido set situacao = 'aguardando' where id = $1`, [pedido.id])).rejects.toThrow(/nao vai de aprovado para aguardando/);
    });

    it('o regemcast_app não apaga pedido (é a prova)', async () => {
      const c = await novaConta();
      const { pedido } = await pedir(c, await novaCampanha(c));
      // 42501 = sem permissão (o Drizzle embrulha a mensagem do Postgres; o código fica na causa).
      const erro = await naConta(c, () => ctx.db.execute(sql`delete from acao_pedido where id = ${pedido.id}`)).catch((e: unknown) => e);
      expect((erro as { cause?: { code?: string } }).cause?.code).toBe('42501');
      expect((await linha(pedido.id)).situacao).toBe('aguardando');
    });

    it('o pedido que disparou a campanha é gravado uma vez', async () => {
      const c = await novaConta();
      const campanhaId = await novaCampanha(c);
      const { pedido } = await pedir(c, campanhaId);
      await aprovarComo(c, pedido.id);
      expect((await naConta(c, () => servico.executar(c.contaId, pedido.id))).resultado).toBe('executado');
      await expect(poolSuper.query(`update campanha set acao_pedido_id = null where id = $1`, [campanhaId])).rejects.toThrow(/nao muda/);
    });
  });

  // ------------------------------------------------------------- o pedido

  describe('o pedido', () => {
    it('um pedido aberto por campanha: outra chave recebe aprovacao-pendente com o id do aberto', async () => {
      const c = await novaConta();
      const campanhaId = await novaCampanha(c);
      const primeiro = await pedir(c, campanhaId);
      const erro = await pedir(c, campanhaId).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ErroDoPedido);
      expect((erro as ErroDoPedido).tipo).toBe('aprovacao-pendente');
      expect((erro as ErroDoPedido).dados).toEqual({ pedido: primeiro.pedido.id });
    });

    it('a mesma chave devolve o pedido como está agora, também depois de executado (a chave vem antes do plano)', async () => {
      const c = await novaConta();
      const campanhaId = await novaCampanha(c);
      const r = await pedir(c, campanhaId, { chave: 'chave-repetida-0001' });
      await aprovarComo(c, r.pedido.id);
      await naConta(c, () => servico.executar(c.contaId, r.pedido.id));
      // A campanha saiu (não é mais rascunho): a conferência da porta recusaria, mas a repetição nem chega a ela.
      const conferencia = jest.fn(async () => {
        throw new BadRequestException('Esta campanha já foi disparada.');
      });
      const de = await naConta(c, () =>
        servico.pedir(quem(c), { chave: 'chave-repetida-0001', campanhaId, confirmacao: 'confirmacao-de-teste-0001', pedidoPor: { tipo: 'agente' }, cupom: null }, conferencia),
      );
      expect(de.novo).toBe(false);
      expect(de.pedido.situacao).toBe('executado');
      expect(conferencia).not.toHaveBeenCalled();
    });

    it('a conta com 20 pedidos esperando recusa o 21º', async () => {
      const c = await novaConta();
      for (let i = 0; i < 20; i += 1) await pedir(c, await novaCampanha(c, 1));
      const erro = await pedir(c, await novaCampanha(c, 1)).catch((e: unknown) => e);
      expect((erro as ErroDoPedido).tipo).toBe('regra-invalida');
    });

    it('o produto de fora da DMS não pede disparo', async () => {
      const c = await novaConta();
      const campanhaId = await novaCampanha(c);
      const erro = await naConta(c, () =>
        servico.pedir({ ...quem(c), classe: 'externo' }, { chave: 'chave-de-fora-0001', campanhaId, confirmacao: 'confirmacao-de-teste-0001', pedidoPor: { tipo: 'agente' }, cupom: null }, async () => undefined),
      ).catch((e: unknown) => e);
      expect((erro as ErroDoPedido).tipo).toBe('escopo-insuficiente');
    });
  });

  // ------------------------------------------------------- o plano que muda

  describe('o plano prende o que sai', () => {
    it('trocar a variável fixa (o cupom) encerra o pedido ao abrir, e o encerramento fica gravado', async () => {
      const c = await novaConta();
      const campanhaId = await novaCampanha(c);
      const { pedido } = await pedir(c, campanhaId);
      await poolSuper.query(`update campanha set variaveis_lista = $2::jsonb where id = $1`, [campanhaId, JSON.stringify([{ origem: 'nome', valor: null }, { origem: 'fixo', valor: 'SEXTA50' }])]);
      const u = { id: c.donoId, contaId: c.contaId, nome: 'Paulo Exemplo', email: c.donoEmail, papel: 'dono' as const, escopo: 'web' as const };
      const tela = await naConta(c, () => servico.detalheParaTela(u, pedido.id));
      expect(tela.pedido.situacao).toBe('cancelado');
      expect(tela.pedido.motivo).toBe('plano-mudou');
      expect((await linha(pedido.id)).situacao).toBe('cancelado');
    });

    it('o texto do modelo mudado na Meta depois de aprovar: a execução encerra (plano-mudou) e nada sai', async () => {
      const c = await novaConta();
      const campanhaId = await novaCampanha(c);
      const { pedido } = await pedir(c, campanhaId);
      await aprovarComo(c, pedido.id);
      textoNaMeta = 'Oi, {{1}}! Agora é 50% de desconto.';
      const r = await naConta(c, () => servico.executar(c.contaId, pedido.id));
      expect(r.resultado).toBe('encerrado');
      expect((await linha(pedido.id)).situacao).toBe('cancelado');
      expect((await linha(pedido.id)).motivo).toBe('plano-mudou');
      expect(efeitos.get(campanhaId) ?? 0).toBe(0);
    });

    it('o público mudou antes de aprovar: a aprovação devolve o pedido encerrado (plano-mudou), sem lançar', async () => {
      const c = await novaConta();
      const campanhaId = await novaCampanha(c);
      const { pedido } = await pedir(c, campanhaId);
      await maisUmaPessoa(c, campanhaId);
      const depois = await aprovarComo(c, pedido.id);
      expect(depois).toMatchObject({ situacao: 'cancelado', motivo: 'plano-mudou' });
      expect((await linha(pedido.id)).situacao).toBe('cancelado');
    });

    it('o aplicativo desligado (token revogado) encerra o pedido na aprovação', async () => {
      const c = await novaConta();
      const { pedido } = await pedir(c, await novaCampanha(c));
      await poolSuper.query('update integracao_token set revogado_em = now() where id = $1', [c.tokenId]);
      const depois = await aprovarComo(c, pedido.id);
      expect(depois.situacao).toBe('cancelado');
      expect(depois.motivo).toBe('pedido-cancelado');
    });

    it('a parada do hub recusa a aprovação sem encerrar o pedido', async () => {
      const c = await novaConta();
      const { pedido } = await pedir(c, await novaCampanha(c));
      hub.parado.mockReturnValue({ nivel: 'aplicativo' });
      const erro = await aprovarComo(c, pedido.id).catch((e: unknown) => e);
      expect((erro as ErroDoPedido).tipo).toBe('integracao-parada');
      expect((await linha(pedido.id)).situacao).toBe('aguardando');
    });

    it('o que impediria o disparo agora não deixa aprovar, e o pedido segue esperando', async () => {
      const c = await novaConta();
      const { pedido } = await pedir(c, await novaCampanha(c));
      campanhas.oQueImpedeODisparo.mockResolvedValue('Conecte sua conta do WhatsApp antes de disparar.');
      await expect(aprovarComo(c, pedido.id)).rejects.toThrow(/Não dá para aprovar agora: Conecte/);
      expect((await linha(pedido.id)).situacao).toBe('aguardando');
    });
  });

  // ------------------------------------------------------------- a execução

  describe('a execução', () => {
    it('o disparo recusado deixa o pedido aprovado e a campanha em rascunho (só o ponto de salvamento se desfaz)', async () => {
      const c = await novaConta();
      const campanhaId = await novaCampanha(c);
      const { pedido } = await pedir(c, campanhaId);
      await aprovarComo(c, pedido.id);
      disparoRecusa = true;
      const r = await naConta(c, () => servico.executar(c.contaId, pedido.id));
      expect(r.resultado).toBe('adiado');
      expect(r.resultado === 'adiado' && r.aviso).toMatch(/Conecte sua conta do WhatsApp/);
      expect((await linha(pedido.id)).situacao).toBe('aprovado');
      expect((await poolSuper.query('select status, acao_pedido_id from campanha where id = $1', [campanhaId])).rows[0]).toEqual({ status: 'rascunho', acao_pedido_id: null });
      // A rotina tenta de novo: com o disparo de volta, sai, uma vez.
      disparoRecusa = false;
      const de = await naConta(c, () => servico.executar(c.contaId, pedido.id));
      expect(de.resultado).toBe('executado');
      expect((await poolSuper.query('select acao_pedido_id from campanha where id = $1', [campanhaId])).rows[0].acao_pedido_id).toBe(pedido.id);
    });

    it('a rotina vence o que passou do prazo e marca o lembrete uma vez', async () => {
      const c = await novaConta();
      const { pedido } = await pedir(c, await novaCampanha(c));
      deslocamento = 13 * 3_600_000;
      const lembrados = await servico.lembrar();
      expect(lembrados.map((l) => l.id)).toContain(pedido.id);
      expect((await servico.lembrar()).map((l) => l.id)).not.toContain(pedido.id);
      deslocamento = 25 * 3_600_000;
      expect((await servico.vencer()).map((v) => v.id)).toContain(pedido.id);
      const l = await linha(pedido.id);
      expect(l.situacao).toBe('vencido');
      expect(l.decidido_por).toBe('prazo');
    });
  });

  // ------------------------------------------------------- quem pediu desiste

  describe('o cancelamento por quem pediu', () => {
    it('cancela o que espera, devolve o cancelado de novo e recusa o executado', async () => {
      const c = await novaConta();
      const a = await pedir(c, await novaCampanha(c));
      const primeiro = await naConta(c, () => servico.cancelarPeloAplicativo(c.contaId, PRODUTO, a.pedido.id));
      expect(primeiro).toMatchObject({ mudou: true, pedido: { situacao: 'cancelado' } });
      const de = await naConta(c, () => servico.cancelarPeloAplicativo(c.contaId, PRODUTO, a.pedido.id));
      expect(de).toMatchObject({ mudou: false, pedido: { situacao: 'cancelado' } });

      const b = await pedir(c, await novaCampanha(c));
      await aprovarComo(c, b.pedido.id);
      await naConta(c, () => servico.executar(c.contaId, b.pedido.id));
      const erro = await naConta(c, () => servico.cancelarPeloAplicativo(c.contaId, PRODUTO, b.pedido.id)).catch((e: unknown) => e);
      expect((erro as ErroDoPedido).tipo).toBe('aprovacao-usada');
    });

    it('o pedido de outro aplicativo não é encontrado', async () => {
      const c = await novaConta();
      const a = await pedir(c, await novaCampanha(c));
      await expect(naConta(c, () => servico.lerDoAplicativo(c.contaId, 'outro', a.pedido.id))).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ---------------------------------------------------- o código na aprovação

  describe('o código do aplicativo autenticador', () => {
    const usuarioDe = (c: Conta) => ({ id: c.donoId, contaId: c.contaId, nome: 'Paulo Exemplo', email: c.donoEmail, papel: 'dono' as const, escopo: 'web' as const });

    it('o código errado conta na trava mesmo com a recusa desfazendo a transação, e o quinto trava', async () => {
      const c = await novaConta();
      const { pedido } = await pedir(c, await novaCampanha(c));
      const resumoVisto = String((await linha(pedido.id)).resumo_plano);
      for (let i = 1; i <= 5; i += 1) {
        const erro = await naConta(c, () => servico.aprovar(usuarioDe(c), pedido.id, { codigo: '000000', tetoCentavos: 1_000, resumoVisto })).catch((e: unknown) => e);
        expect((erro as ErroDoPedido).tipo).toBe('segundo-fator-invalido');
        expect(Number((await poolSuper.query('select aprovacao_erros from usuario where id = $1', [c.donoId])).rows[0].aprovacao_erros)).toBe(i);
      }
      // Travado: nem o código certo passa, e o pedido segue esperando.
      const travado = await naConta(c, () => servico.aprovar(usuarioDe(c), pedido.id, { codigo: codigoAgora(c), tetoCentavos: 1_000, resumoVisto })).catch((e: unknown) => e);
      expect((travado as ErroDoPedido).message).toMatch(/travado/);
      expect((await linha(pedido.id)).situacao).toBe('aguardando');
    });

    it('o código certo aprova uma vez; o mesmo código não vale de novo', async () => {
      const c = await novaConta();
      const a = await pedir(c, await novaCampanha(c));
      const b = await pedir(c, await novaCampanha(c));
      const codigo = codigoAgora(c);
      const aprovado = await naConta(c, () => servico.aprovar(usuarioDe(c), a.pedido.id, { codigo, tetoCentavos: 1_000, resumoVisto: String(a.pedido.resumoDoPlano) }));
      expect(aprovado.situacao).toBe('aprovado');
      const erro = await naConta(c, () => servico.aprovar(usuarioDe(c), b.pedido.id, { codigo, tetoCentavos: 1_000, resumoVisto: String(b.pedido.resumoDoPlano) })).catch((e: unknown) => e);
      expect((erro as ErroDoPedido).message).toMatch(/já foi usado/);
    });

    it('quem não tem o aplicativo autenticador ligado recebe onde ligar', async () => {
      const c = await novaConta();
      await poolSuper.query(`update usuario set dois_fatores = 'email' where id = $1`, [c.donoId]);
      const { pedido } = await pedir(c, await novaCampanha(c));
      const erro = await naConta(c, () => servico.aprovar(usuarioDe(c), pedido.id, { codigo: '123456', tetoCentavos: 1_000, resumoVisto: pedido.resumoDoPlano })).catch((e: unknown) => e);
      expect((erro as ErroDoPedido).message).toMatch(/Segurança do seu acesso/);
    });

    it('o operador sem a permissão não aprova; com a permissão do dono, aprova', async () => {
      const c = await novaConta();
      const opId = randomUUID();
      const segredo = novoSegredo();
      await poolSuper.query(
        `insert into usuario (id, conta_id, nome, email, senha_hash, papel, status, dois_fatores, totp_segredo_cifrado)
         values ($1, $2, 'Bia Exemplo', $3, 'x', 'operador', 'ativo', 'app', $4)`,
        [opId, c.contaId, `operador-${opId.slice(0, 8)}@exemplo.test`, cifrarToken(segredo, CHAVE_TOTP_DE_TESTE)],
      );
      const op = { id: opId, contaId: c.contaId, nome: 'Bia Exemplo', email: `operador-${opId.slice(0, 8)}@exemplo.test`, papel: 'operador' as const, escopo: 'web' as const };
      const { pedido } = await pedir(c, await novaCampanha(c));
      const codigo = () => codigoDoPasso(deBase32(segredo), passoDe(new Date()));
      const sem = await naConta(c, () => servico.aprovar(op, pedido.id, { codigo: codigo(), tetoCentavos: 1_000, resumoVisto: pedido.resumoDoPlano })).catch((e: unknown) => e);
      expect((sem as ErroDoPedido).tipo).toBe('escopo-insuficiente');
      await poolSuper.query('update usuario set aprova_disparos = true where id = $1', [opId]);
      const com = await naConta(c, () => servico.aprovar(op, pedido.id, { codigo: codigo(), tetoCentavos: 1_000, resumoVisto: pedido.resumoDoPlano }));
      expect(com.situacao).toBe('aprovado');
      expect((await linha(pedido.id)).decidido_por).toBe('autorizado');
    });
  });

  // ------------------------------------------------------------ a folga do teto

  describe('a folga do teto do disparo (folgaDoTeto)', () => {
    async function contaComTarifa(moeda: string, valor: string): Promise<{ c: Conta; campanhaId: string }> {
      const c = await novaConta();
      await poolSuper.query(`insert into wa_conta (conta_id, waba_id, moeda) values ($1, $2, $3)`, [c.contaId, `000000${randomUUID().slice(0, 8)}`, moeda]);
      await poolSuper.query(
        `insert into tarifa_meta (moeda, ddi, categoria, vigente_de, valor) values ($1, '55', 'marketing', date '2020-01-01', $2::numeric)
         on conflict do nothing`,
        [moeda, valor],
      );
      return { c, campanhaId: await novaCampanha(c, 3) };
    }
    const folga = (c: Conta, campanhaId: string, tetoCentavos: number, moeda: string | null) =>
      naConta(c, () => folgaDoTeto(ctx.db, c.contaId, { id: campanhaId, modeloCategoria: 'marketing', tetoCentavos, moeda }, 10));

    it('conta o que cabe pelo preço da vez, e o que já saiu entra no gasto', async () => {
      const { c, campanhaId } = await contaComTarifa('XTS', '0.250000');
      expect(await folga(c, campanhaId, 100, 'XTS')).toMatchObject({ cabem: 4, gastoMicros: 0, semComoContar: null });
      await poolSuper.query(`update campanha_destinatario set status = 'enviada' where campanha_id = $1 and id in (select id from campanha_destinatario where campanha_id = $1 limit 2)`, [campanhaId]);
      expect(await folga(c, campanhaId, 100, 'XTS')).toMatchObject({ cabem: 2, gastoMicros: 500_000 });
    });

    it('a moeda da conta diferente da do plano aprovado: nada cabe', async () => {
      const { c, campanhaId } = await contaComTarifa('XTS', '0.250000');
      expect(await folga(c, campanhaId, 100_000, 'BRL')).toMatchObject({ cabem: 0, semComoContar: 'moeda' });
    });

    it('alguém da vez sem tarifa (outro país): nada cabe', async () => {
      const { c, campanhaId } = await contaComTarifa('XTS', '0.250000');
      await poolSuper.query(
        `insert into campanha_destinatario (conta_id, campanha_id, telefone_e164, variaveis, criado_em) values ($1, $2, '35191000001', '[]'::jsonb, now() - interval '1 day')`,
        [c.contaId, campanhaId],
      );
      expect(await folga(c, campanhaId, 100_000, 'XTS')).toMatchObject({ cabem: 0, semComoContar: 'tarifa' });
    });
  });

  it('nenhum erro do pacote escapa sem nome: o ErroProblema vira ErroDoPedido com o status dele', () => {
    const e = new ErroDoPedido(new ErroProblema('integracao-parada', 'Integração parada.'));
    expect(e.getStatus()).toBe(503);
    expect(e.tipo).toBe('integracao-parada');
  });
});
