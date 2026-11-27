/**
 * O público montado com regras (migration 053) contra o Postgres de verdade,
 * como `regemcast_app` (RLS valendo): cada campo e cada comparação sobre
 * contatos de exemplo, o "não é igual a" que inclui quem não tem o dado, o
 * aniversário de 29/02, a última campanha pelo número gêmeo, a parte (do X ao
 * Y, na ordem de chegada, sem quem não pode receber), a prévia com a parte, os
 * públicos salvos e a data do cadastro do Cardápio Web.
 *
 * Precisa de um banco DESCARTÁVEL com as migrations; sem as duas variáveis,
 * pula (o CI não tem banco): REGEMCAST_TESTE_PG_URL (como regemcast_app) e
 * REGEMCAST_TESTE_PG_SUPER (o dono do banco, só para montar os dados).
 * Telefones visivelmente fictícios (V34).
 */
jest.mock('../../config/env', () => ({ env: {} }));

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { ContextoDb } from '../../db/contexto';
import * as schema from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { CampanhaService } from '../campanha/campanha.service';
import { cadastrosDaPagina } from '../cardapioweb/cardapioweb.regras';
import { gravarCadastros } from '../cardapioweb/cardapioweb.saldos';
import { contextoDasRegras, origemDoPublico } from './origem-do-publico';
import { PublicoSalvoService } from './publico-salvo.service';
import { expressaoDasRegras, validarRegras, type Comparacao, type RegraDoPublico } from './regras-do-publico';

const URL_APP = process.env.REGEMCAST_TESTE_PG_URL;
const URL_SUPER = process.env.REGEMCAST_TESTE_PG_SUPER;
const descrever = URL_APP && URL_SUPER ? describe : describe.skip;

const FUSO = 'America/Sao_Paulo';

/** As pessoas de exemplo, pelo telefone (celular com o 9: o gêmeo é sem ele). */
const TEL = {
  A: '5521960000001',
  B: '5521960000002',
  C: '5511960000003',
  D: '5521960000004',
  E: '5521960000005',
} as const;
type Letra = keyof typeof TEL;
const LETRA = new Map<string, Letra>(Object.entries(TEL).map(([l, t]) => [t, l as Letra]));

type R = [campo: string, comparacao: Comparacao, valor: string];

/** `AAAA-MM-DD` somando dias a um dia `AAAA-MM-DD`. */
function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** O próximo 29/02 (ou 28/02 nos anos sem 29) a partir de `hoje`, a regra da tela. */
function proximoDe29DeFevereiro(hoje: string): string {
  const bissexto = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
  const ano = Number(hoje.slice(0, 4));
  const noAno = (a: number) => `${a}-02-${bissexto(a) ? '29' : '28'}`;
  return noAno(ano) >= hoje ? noAno(ano) : noAno(ano + 1);
}

descrever('público com regras contra o Postgres (migration 053)', () => {
  let poolApp: Pool;
  let poolSuper: Pool;
  let ctx: ContextoDb;
  let contaId: string;
  let outraContaId: string;
  let donoId: string;
  let hoje: string;
  let salvos: PublicoSalvoService;
  let campanhas: CampanhaService;

  async function novaConta(): Promise<{ contaId: string; donoId: string }> {
    const id = randomUUID();
    await poolSuper.query('insert into conta (id, nome, status, timezone) values ($1, $2, $3, $4)', [id, 'Pizzaria Exemplo', 'ativa', FUSO]);
    const dono = randomUUID();
    await poolSuper.query(
      `insert into usuario (id, conta_id, nome, email, senha_hash, papel, status)
       values ($1, $2, 'Paula Exemplo', $3, 'x', 'dono', 'ativo')`,
      [dono, id, `dono-${dono.slice(0, 8)}@exemplo.test`],
    );
    return { contaId: id, donoId: dono };
  }

  async function quem(regras: R[], conta = contaId): Promise<Letra[]> {
    const v = validarRegras(regras.map(([campo, comparacao, valor]) => ({ campo, comparacao, valor })));
    if ('erro' in v) throw new Error(v.erro);
    return ctx.comConta(conta, async (db) => {
      const c = await contextoDasRegras(db, conta);
      const r = await db.execute(sql`
        select contato.telefone_e164 as t from contato
         where contato.conta_id = ${conta} and ${expressaoDasRegras(v.regras, c)}
         order by contato.telefone_e164`);
      return (r.rows as Array<{ t: string }>).map((x) => LETRA.get(x.t)!).sort();
    });
  }

  beforeAll(async () => {
    poolApp = new Pool({ connectionString: URL_APP, max: 4 });
    poolSuper = new Pool({ connectionString: URL_SUPER, max: 2 });
    ctx = new ContextoDb(drizzle(poolApp, { schema }));
    const auditoria = new AuditoriaService(ctx);
    salvos = new PublicoSalvoService(ctx, auditoria);
    // A prévia só usa o banco: os outros serviços da campanha não entram nela.
    const nada = {} as never;
    campanhas = new CampanhaService(ctx, nada, nada, auditoria, nada, nada, nada, nada);

    ({ contaId, donoId } = await novaConta());
    ({ contaId: outraContaId } = await novaConta());
    hoje = ((await poolSuper.query(`select (now() at time zone $1)::date::text as d`, [FUSO])).rows[0] as { d: string }).d;

    const ins = async (colunas: Record<string, unknown>) => {
      const nomes = Object.keys(colunas);
      await poolSuper.query(
        `insert into contato (conta_id, ${nomes.join(', ')}) values ($1, ${nomes.map((_, i) => `$${i + 2}`).join(', ')})`,
        [contaId, ...Object.values(colunas)],
      );
    };
    const agoraMenos = (segundos: number) => new Date(Date.now() - segundos * 1000);
    const instanteDoDia = (dia: string) => new Date(`${dia}T12:00:00-03:00`);

    // A: campeão — 5 pedidos, R$ 500, o último há 10 dias, aniversário em 3 dias, cashback que vence em 3 dias.
    await ins({
      telefone_e164: TEL.A, nome: 'Ana Exemplo', pedidos: 5, total_gasto_centavos: 50000,
      ultimo_pedido_em: instanteDoDia(somarDias(hoje, -10)), primeiro_pedido_em: instanteDoDia(somarDias(hoje, -400)),
      bairro: 'Centro', tipo_preferido: 'entrega', periodo_preferido: 'noite',
      data_nascimento: `1990-${somarDias(hoje, 3).slice(5)}`,
      cashback_centavos: 1500, cashback_vence_em: somarDias(hoje, 3),
      cadastro_origem_em: new Date('2025-01-15T12:00:00-03:00'), criado_em: agoraMenos(5),
    });
    // B: um pedido só, há 20 dias, R$ 30; cashback vencido ontem.
    await ins({
      telefone_e164: TEL.B, nome: 'Bruno Exemplo', pedidos: 1, total_gasto_centavos: 3000,
      ultimo_pedido_em: instanteDoDia(somarDias(hoje, -20)), primeiro_pedido_em: instanteDoDia(somarDias(hoje, -20)),
      tipo_preferido: 'retirada', periodo_preferido: 'almoco',
      cashback_centavos: 1000, cashback_vence_em: somarDias(hoje, -1), criado_em: agoraMenos(4),
    });
    // C: sem compras, de São Paulo (DDD 11), recebeu campanha há 2 dias pelo número SEM o 9.
    await ins({ telefone_e164: TEL.C, nome: 'Carla Exemplo', criado_em: agoraMenos(3) });
    // D: pediu para sair. E: nasceu em 29/02 e o número não tem WhatsApp. Os dois chegaram NO MEIO
    // (ordem: A, D, B, E, C): se a parte numerasse quem não pode receber, o "do 2 ao 3" mudaria.
    await ins({ telefone_e164: TEL.D, nome: 'Davi Exemplo', opt_out: true, opt_out_em: new Date(), criado_em: agoraMenos(4.5) });
    await ins({
      telefone_e164: TEL.E, nome: 'Eva Exemplo', data_nascimento: '2000-02-29', sem_whatsapp_em: new Date(), criado_em: agoraMenos(3.5),
    });

    const idA = ((await poolSuper.query('select id from contato where conta_id = $1 and telefone_e164 = $2', [contaId, TEL.A])).rows[0] as { id: string }).id;
    await poolSuper.query(
      `insert into contato_produto (conta_id, contato_id, chave, nome, compras, ultima_em) values ($1, $2, 'pizza calabresa', 'Pizza Calabresa', 3, now())`,
      [contaId, idA],
    );
    const campanhaId = randomUUID();
    await poolSuper.query(
      `insert into campanha (id, conta_id, nome, modelo_id, modelo_nome, modelo_idioma, modelo_categoria, status)
       values ($1, $2, 'Promo de exemplo', $3, 'promo', 'pt_BR', 'marketing', 'concluida')`,
      [campanhaId, contaId, randomUUID()],
    );
    await poolSuper.query(
      `insert into campanha_destinatario (conta_id, campanha_id, telefone_e164, variaveis, status, enviada_em)
       values ($1, $2, '551160000003', '[]'::jsonb, 'entregue', now() - interval '2 days')`,
      [contaId, campanhaId],
    );
  });

  afterAll(async () => {
    await poolApp?.end();
    await poolSuper?.end();
  });

  describe('cada campo e cada comparação', () => {
    it.each<[string, R[], Letra[]]>([
      ['total de pedidos ≥ 5', [['total_pedidos', '>=', '5']], ['A']],
      ['quem nunca comprou tem 0 pedidos', [['total_pedidos', '=', '0']], ['C', 'D', 'E']],
      ['"não é igual a" inclui quem não tem o dado', [['total_pedidos', '!=', '1']], ['A', 'C', 'D', 'E']],
      ['total gasto > R$ 100', [['total_gasto', '>', '100']], ['A']],
      ['ticket médio ≥ R$ 30 (sem pedido não tem ticket)', [['ticket_medio', '>=', '30']], ['A', 'B']],
      ['ticket médio ≠ R$ 30 inclui quem não tem ticket', [['ticket_medio', '!=', '30']], ['A', 'C', 'D', 'E']],
      ['dias desde o último pedido > 15 (quem nunca comprou fica de fora)', [['dias_ultimo_pedido', '>', '15']], ['B']],
      ['dias desde o último pedido = 10, no calendário do fuso', [['dias_ultimo_pedido', '=', '10']], ['A']],
      ['já comprou o produto, sem ligar para maiúscula', [['produto', '=', 'pizza CALABRESA']], ['A']],
      ['não comprou o produto', [['produto', '!=', 'Pizza calabresa']], ['B', 'C', 'D', 'E']],
      ['aniversário daqui a 3 dias', [['aniversario_dias', '=', '3']], ['A']],
      ['última campanha há até 2 dias, pelo número gêmeo', [['dias_ultima_campanha', '<=', '2']], ['C']],
      ['quem nunca recebeu conta como há muito tempo', [['dias_ultima_campanha', '>', '30']], ['A', 'B', 'D', 'E']],
      ['cadastro no Cardápio Web em 15/01/2025', [['cadastro_cw', '=', '2025-01-15']], ['A']],
      ['dias desde o cadastro > 0: só quem tem a data', [['dias_cadastro_cw', '>', '0']], ['A']],
      ['perfil Campeões', [['perfil', '=', 'campeoes']], ['A']],
      ['perfil Novos', [['perfil', '=', 'novos']], ['B']],
      ['perfil Sem histórico', [['perfil', '=', 'sem_historico']], ['C', 'D', 'E']],
      ['cashback > 0: o vencido não conta', [['cashback', '>', '0']], ['A']],
      ['cashback = 0: vencido e sem saldo', [['cashback', '=', '0']], ['B', 'C', 'D', 'E']],
      ['cashback vence em até 3 dias', [['cashback_dias', '<=', '3']], ['A']],
      ['bairro, sem ligar para maiúscula', [['bairro', '=', 'centro']], ['A']],
      ['bairro "não é" inclui quem não tem bairro', [['bairro', '!=', 'Centro']], ['B', 'C', 'D', 'E']],
      ['estado pelo DDD', [['estado', '=', 'SP']], ['C']],
      ['estado "não é"', [['estado', '!=', 'SP']], ['A', 'B', 'D', 'E']],
      ['jeito de comprar', [['jeito', '=', 'entrega']], ['A']],
      ['período do dia "não é"', [['periodo', '!=', 'noite']], ['B', 'C', 'D', 'E']],
      ['todas as regras precisam valer', [['total_pedidos', '>=', '1'], ['dias_ultimo_pedido', '>', '15']], ['B']],
    ])('%s', async (_nome, regras, esperado) => {
      expect(await quem(regras)).toEqual(esperado);
    });

    it('datas no fuso da conta: último pedido, primeiro pedido, aniversário e entrada na base', async () => {
      expect(await quem([['ultimo_pedido', '=', somarDias(hoje, -10)]])).toEqual(['A']);
      expect(await quem([['primeiro_pedido', '<', somarDias(hoje, -100)]])).toEqual(['A']);
      expect(await quem([['aniversario_data', '=', somarDias(hoje, 3)]])).toEqual(['A']);
      expect(await quem([['entrou_base', '=', hoje]])).toEqual(['A', 'B', 'C', 'D', 'E']);
    });

    it('quem nasceu em 29/02 faz aniversário em 28/02 nos anos sem 29', async () => {
      expect(await quem([['aniversario_data', '=', proximoDe29DeFevereiro(hoje)]])).toContain('E');
    });

    it('a outra conta não enxerga ninguém daqui (RLS)', async () => {
      expect(await quem([['entrou_base', '=', hoje]], outraContaId)).toEqual([]);
    });
  });

  describe('a parte e a prévia', () => {
    const todos: RegraDoPublico[] = [{ campo: 'entrou_base', comparacao: '=', valor: '' }];
    beforeAll(() => {
      todos[0]!.valor = hoje;
    });

    it('do 2 ao 3, na ordem de chegada, sem quem pediu para sair nem quem não tem WhatsApp', async () => {
      const telefones = await ctx.comConta(contaId, async (db) => {
        const o = await origemDoPublico(db, contaId, { origem: 'regras', regras: todos, parteDe: 2, parteAte: 3 });
        expect(o.regras).toEqual({ regras: todos, parte: { de: 2, ate: 3 }, publicoSalvoId: null });
        expect(o.nome).toMatch(/· do 2 ao 3$/);
        const r = await db.execute(sql`select contato.telefone_e164 as t from contato where contato.conta_id = ${contaId} and ${o.filtro}`);
        return (r.rows as Array<{ t: string }>).map((x) => LETRA.get(x.t)!).sort();
      });
      // A, B e C podem receber (D saiu, E não tem WhatsApp): a parte 2–3 é B e C.
      expect(telefones).toEqual(['B', 'C']);
    });

    it('a prévia conta a parte e diz o tamanho do público inteiro', async () => {
      const comParte = await campanhas.previaDoPublico(contaId, { origem: 'regras', regras: todos, parteDe: 2, parteAte: 3 });
      expect(comParte.total).toBe(2);
      expect(comParte.publicoInteiro).toBe(3);
      const semParte = await campanhas.previaDoPublico(contaId, { origem: 'regras', regras: todos });
      expect(semParte.total).toBe(3);
      expect(semParte.publicoInteiro).toBeNull();
    });

    it('recusa regra torta e parte ao contrário com a frase da tela', async () => {
      await expect(
        campanhas.previaDoPublico(contaId, { origem: 'regras', regras: [{ campo: 'total_pedidos', comparacao: '=', valor: 'x' }] }),
      ).rejects.toThrow('Regra 1: "Total de pedidos" pede um número inteiro, de 0 a 1.000.000.');
      await expect(
        campanhas.previaDoPublico(contaId, { origem: 'regras', regras: todos, parteDe: 5, parteAte: 2 }),
      ).rejects.toThrow('Na parte, o primeiro contato vem antes do último.');
    });
  });

  describe('públicos salvos', () => {
    const naConta = <T>(fn: () => Promise<T>, conta = contaId) => ctx.comConta(conta, fn);
    const sumidos = [
      { campo: 'total_pedidos', comparacao: '>=' as const, valor: '1' },
      { campo: 'dias_ultimo_pedido', comparacao: '>' as const, valor: '15' },
    ];
    let salvoId: string;

    it('cria e lista com quantos podem receber hoje e a frase de cada regra', async () => {
      const criado = await naConta(() => salvos.criar(contaId, donoId, { nome: '  Sumidos   do mês ', regras: sumidos }));
      salvoId = criado.id;
      expect(criado).toMatchObject({
        nome: 'Sumidos do mês',
        total: 1,
        problema: null,
        resumo: ['Total de pedidos ≥ 1', 'Dias desde o último pedido > 15 dias'],
        usos: { campanhas: 0, ultimaEm: null },
      });
      const { publicos } = await naConta(() => salvos.listar(contaId));
      expect(publicos.map((p) => p.nome)).toEqual(['Sumidos do mês']);
    });

    it('o nome não se repete na conta, sem ligar para maiúscula (409 com frase)', async () => {
      await expect(naConta(() => salvos.criar(contaId, donoId, { nome: 'SUMIDOS DO MÊS', regras: sumidos }))).rejects.toThrow(
        ConflictException,
      );
      // Na outra conta o mesmo nome pode.
      const daOutra = await naConta(() => salvos.criar(outraContaId, donoId, { nome: 'Sumidos do mês', regras: sumidos }), outraContaId);
      expect(daOutra.total).toBe(0);
    });

    it('duplicar dá "Cópia de …" e depois "(2)"', async () => {
      const um = await naConta(() => salvos.duplicar(contaId, donoId, salvoId));
      const dois = await naConta(() => salvos.duplicar(contaId, donoId, salvoId));
      expect([um.nome, dois.nome]).toEqual(['Cópia de Sumidos do mês', 'Cópia de Sumidos do mês (2)']);
    });

    it('editar: regra torta é recusada com a frase; ausente mantém', async () => {
      await expect(
        naConta(() => salvos.editar(contaId, donoId, salvoId, { regras: [{ campo: 'perfil', comparacao: '>', valor: 'campeoes' }] })),
      ).rejects.toThrow(BadRequestException);
      const renomeado = await naConta(() => salvos.editar(contaId, donoId, salvoId, { nome: 'Sumidos' }));
      expect(renomeado.nome).toBe('Sumidos');
      expect(renomeado.regras).toEqual(sumidos);
    });

    it('a campanha usa as regras GRAVADAS do público salvo, não as que o pedido mandou', async () => {
      const o = await naConta(() =>
        origemDoPublico(ctx.db, contaId, {
          origem: 'regras',
          publicoSalvoId: salvoId,
          regras: [{ campo: 'total_pedidos', comparacao: '>=', valor: '0' }],
        }),
      );
      expect(o.regras?.regras).toEqual(sumidos);
      expect(o.regras?.publicoSalvoId).toBe(salvoId);
      expect(o.nome).toBe('Público salvo: Sumidos');
    });

    it('conta os usos pela campanha que gravou o público salvo', async () => {
      await poolSuper.query(
        `insert into campanha (id, conta_id, nome, modelo_id, modelo_nome, modelo_idioma, modelo_categoria, status, publico_origem, publico_salvo_id, publico_regras)
         values ($1, $2, 'Volta dos sumidos', $3, 'volta', 'pt_BR', 'marketing', 'rascunho', 'regras', $4, $5::jsonb)`,
        [randomUUID(), contaId, randomUUID(), salvoId, JSON.stringify({ regras: sumidos, parte: null })],
      );
      const { publicos } = await naConta(() => salvos.listar(contaId));
      expect(publicos.find((p) => p.id === salvoId)?.usos.campanhas).toBe(1);
    });

    it('outra conta não edita nem usa o público daqui', async () => {
      await expect(naConta(() => salvos.editar(outraContaId, donoId, salvoId, { nome: 'Meu' }), outraContaId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        naConta(() => origemDoPublico(ctx.db, outraContaId, { origem: 'regras', publicoSalvoId: salvoId }), outraContaId),
      ).rejects.toThrow(NotFoundException);
    });

    it('regra gravada que saiu da lista: a tela mostra o problema e a campanha recusa', async () => {
      const id = randomUUID();
      await poolSuper.query(
        `insert into publico_salvo (id, conta_id, nome, nome_chave, regras) values ($1, $2, 'Antigo', 'antigo', $3::jsonb)`,
        [id, contaId, JSON.stringify([{ campo: 'ultimo_acesso_site', comparacao: '>', valor: '3' }])],
      );
      const { publicos } = await naConta(() => salvos.listar(contaId));
      const antigo = publicos.find((p) => p.id === id)!;
      expect(antigo.total).toBeNull();
      expect(antigo.problema).toMatch(/Uma regra não vale mais/);
      await expect(naConta(() => origemDoPublico(ctx.db, contaId, { origem: 'regras', publicoSalvoId: id }))).rejects.toThrow(
        /tem uma regra que não vale mais/,
      );
    });

    it('excluir tira o público; a campanha que usou continua como estava', async () => {
      await naConta(() => salvos.excluir(contaId, donoId, salvoId));
      const { publicos } = await naConta(() => salvos.listar(contaId));
      expect(publicos.some((p) => p.id === salvoId)).toBe(false);
      const r = await poolSuper.query('select count(*)::int as n from campanha where conta_id = $1 and publico_salvo_id = $2', [contaId, salvoId]);
      expect((r.rows[0] as { n: number }).n).toBe(1);
    });
  });

  describe('a data do cadastro no Cardápio Web', () => {
    it('grava nas duas formas do celular, não grava para quem pediu para sair, e não reescreve igual', async () => {
      const agora = new Date();
      const pagina = cadastrosDaPagina(
        [
          // B vem SEM o 9 (o gêmeo do que está na base); D pediu para sair.
          { id: 1, phone_number: '2160000002', ddi: '55', created_at: '2024-03-10T10:00:00.000-03:00' },
          { id: 2, phone_number: '21960000004', ddi: '55', created_at: '2024-03-11T10:00:00.000-03:00' },
          { id: 3, phone_number: '21960000009', ddi: '55', created_at: 'ontem' },
        ],
        agora,
      );
      const gravados = await ctx.comConta(contaId, (db) => gravarCadastros(db, contaId, pagina));
      expect(gravados).toBe(1);
      expect(await quem([['cadastro_cw', '=', '2024-03-10']])).toEqual(['B']);
      expect(await quem([['cadastro_cw', '=', '2024-03-11']])).toEqual([]);
      expect(await ctx.comConta(contaId, (db) => gravarCadastros(db, contaId, pagina))).toBe(0);
    });
  });
});
