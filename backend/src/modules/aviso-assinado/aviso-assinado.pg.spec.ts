/**
 * O aviso assinado a quem pediu (Hub DMS, F5 parte B, PR 3) contra o Postgres de verdade, como `regemcast_app` (a RLS
 * valendo): o registro (a base, o segredo cifrado, registrar de novo religa), o gatilho do pedido (um pendente por
 * pedido; a mudança nova só marca), a entrega assinada (a assinatura confere com o segredo registrado; o webhook-id é o
 * da linha), a falha com recuo, a desistência, a pausa depois de muitas falhas, a mudança durante o envio (sai de
 * novo), a credencial que deixou de valer, a parada do hub e o remover.
 *
 * O envio é um dublê (nenhuma rede). Precisa de um banco DESCARTÁVEL com as migrations; sem as duas variáveis, pula:
 * REGEMCAST_TESTE_PG_URL (como regemcast_app) e REGEMCAST_TESTE_PG_SUPER. Identificadores fictícios (repositório
 * público, V34).
 */
const CHAVE_DE_TESTE = Buffer.alloc(32, 9).toString('base64');
const BASE = 'https://aviso.exemplo.test/v1/inbox/regemcast/';
jest.mock('../../config/env', () => ({
  env: {
    rede: { appUrl: 'https://cast.exemplo' },
    seguranca: { totpChave: Buffer.alloc(32, 7).toString('base64') },
    integracoes: { chave: Buffer.alloc(32, 9).toString('base64') },
    aviso: { bases: { liame: ['https://aviso.exemplo.test/v1/inbox/regemcast/'] } },
  },
}));

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { ContextoDb } from '../../db/contexto';
import * as schema from '../../db/schema';
import { conferirAviso, gerarSegredoAviso, type AvisoRegistrado } from '../../dms/integracao-dms';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { HubService } from '../hub/hub.service';
import { decifrarToken } from '../meta/cripto';
import { FALHAS_PARA_PAUSAR, RECUO_SEGUNDOS } from './aviso-assinado.regras';
import { AvisoAssinadoService, type QuemRegistra } from './aviso-assinado.service';

const URL_APP = process.env.REGEMCAST_TESTE_PG_URL;
const URL_SUPER = process.env.REGEMCAST_TESTE_PG_SUPER;
const descrever = URL_APP && URL_SUPER ? describe : describe.skip;

descrever('o aviso assinado a quem pediu, no Postgres', () => {
  let poolApp: Pool;
  let poolSuper: Pool;
  let ctx: ContextoDb;
  let servico: AvisoAssinadoService;
  let parado = false;
  const registrados: AvisoRegistrado[] = [];
  const hub = {
    parado: jest.fn(() => (parado ? { escopo: 'aplicativo' } : null)),
    registrarAviso: jest.fn((a: AvisoRegistrado) => void registrados.push(a)),
  };
  /** O que o dublê do envio recebeu, e o que ele responde. */
  const enviados: Array<{ url: string; cabecalhos: Record<string, string>; corpo: string }> = [];
  let resposta: { status: number | null; erro: string | null } = { status: 204, erro: null };
  /** Roda durante o envio (para mudar o pedido no meio). */
  let duranteOEnvio: (() => Promise<void>) | null = null;

  beforeAll(() => {
    poolApp = new Pool({ connectionString: URL_APP, max: 4 });
    poolSuper = new Pool({ connectionString: URL_SUPER, max: 2 });
    ctx = new ContextoDb(drizzle(poolApp, { schema }));
    servico = new AvisoAssinadoService(ctx, new AuditoriaService(ctx), hub as unknown as HubService);
    servico.enviar = async (url, cabecalhos, corpo) => {
      enviados.push({ url, cabecalhos, corpo });
      if (duranteOEnvio) await duranteOEnvio();
      return resposta;
    };
  });
  afterAll(async () => {
    await poolApp?.end();
    await poolSuper?.end();
  });
  beforeEach(() => {
    parado = false;
    resposta = { status: 204, erro: null };
    duranteOEnvio = null;
    enviados.length = 0;
    registrados.length = 0;
  });

  // ------------------------------------------------------------------ ajudantes

  type Conta = { contaId: string; tokenId: string };

  async function novaConta(escopos: string[] = ['conta.ler', 'campanhas.disparar']): Promise<Conta> {
    const contaId = randomUUID();
    await poolSuper.query('insert into conta (id, nome, status) values ($1, $2, $3)', [contaId, 'Hamburgueria Exemplo', 'ativa']);
    const tokenId = randomUUID();
    await poolSuper.query(
      `insert into integracao_token (id, conta_id, produto, classe, nome, token_hash, prefixo, escopos)
       values ($1, $2, 'liame', 'dms', 'Liame (teste)', $3, 'rct_it_teste', $4::jsonb)`,
      [tokenId, contaId, createHash('sha256').update(randomUUID()).digest('hex'), JSON.stringify(escopos)],
    );
    return { contaId, tokenId };
  }

  const quem = (c: Conta): QuemRegistra => ({ contaId: c.contaId, produto: 'liame', classe: 'dms', prefixo: 'rct_it_teste' });
  const naConta = <T>(c: Conta, fn: () => Promise<T>) => ctx.comConta(c.contaId, fn);

  async function registrar(c: Conta, segredo = gerarSegredoAviso(), trecho = randomUUID()) {
    await naConta(c, () => servico.registrar(quem(c), { url: `${BASE}${trecho}`, segredo }));
    return segredo;
  }

  /** Um pedido de ação aguardando, gravado direto (o serviço da aprovação tem a spec dele). */
  async function novoPedido(c: Conta): Promise<string> {
    const id = randomUUID();
    const h = () => createHash('sha256').update(randomUUID()).digest('hex');
    await poolSuper.query(
      `insert into acao_pedido (id, conta_id, acao, risco, situacao, resumo_plano, plano, aplicativo, token_id, pedido_por,
                                chave_resumo, impressao, criado_em, vence_em, lembrete_em)
       values ($1, $2, 'campanha_disparar', 'R3', 'aguardando', $3, '{}'::jsonb, 'liame', $4, '{"tipo":"agente"}'::jsonb,
               $5, $6, now(), now() + interval '24 hours', now() + interval '12 hours')`,
      [id, c.contaId, h(), c.tokenId, h(), h()],
    );
    return id;
  }

  const mudar = (pedidoId: string, situacao: 'cancelado' | 'vencido', motivo: string | null = null) =>
    poolSuper.query(
      `update acao_pedido set situacao = $2, decidido_em = now(), decidido_por = $3, motivo = $4 where id = $1`,
      [pedidoId, situacao, situacao === 'vencido' ? 'prazo' : 'produto', motivo],
    );

  type LinhaDaFila = {
    id: string;
    produto: string;
    tipo: string;
    recurso_id: string;
    tentativas: number;
    mudou_em: Date;
    proxima_em: Date;
    entregue_em: Date | null;
    desistido_em: Date | null;
    ultimo_status: number | null;
  };
  type Registro = {
    url: string;
    segredo_cifrado: string;
    pausado_em: Date | null;
    pausa_motivo: string | null;
    falhas_seguidas: number;
    ultimo_status: number | null;
  };
  const fila = async (c: Conta) =>
    (await poolSuper.query('select * from aviso_saida where conta_id = $1 order by criado_em', [c.contaId])).rows as LinhaDaFila[];
  const registro = async (c: Conta) =>
    (await poolSuper.query('select * from integracao_aviso where conta_id = $1', [c.contaId])).rows[0] as Registro | undefined;
  /** Põe a fila desta conta na hora de sair (o recuo e a reserva empurram a próxima tentativa). */
  const naHora = (c: Conta) => poolSuper.query(`update aviso_saida set proxima_em = now() - interval '1 second' where conta_id = $1`, [c.contaId]);

  // ------------------------------------------------------------------ o registro

  describe('o registro', () => {
    it('grava o endereço e o segredo cifrado; fora da base ou segredo torto é recusado; produto de fora não registra', async () => {
      const c = await novaConta();
      const segredo = await registrar(c);
      const r = await registro(c);
      expect(r!.url.startsWith(BASE)).toBe(true);
      expect(r!.segredo_cifrado).not.toContain(segredo.slice(6, 20));
      expect(decifrarToken(r!.segredo_cifrado, CHAVE_DE_TESTE)).toBe(segredo);

      await expect(naConta(c, () => servico.registrar(quem(c), { url: 'https://outro.exemplo/v1/inbox/regemcast/x', segredo }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(naConta(c, () => servico.registrar(quem(c), { url: `${BASE}x`, segredo: 'whsec_curto' }))).rejects.toBeInstanceOf(BadRequestException);
      await expect(naConta(c, () => servico.registrar({ ...quem(c), classe: 'externo' }, { url: `${BASE}x`, segredo }))).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      const lido = await naConta(c, () => servico.ler(quem(c)));
      expect(lido).toMatchObject({ registrado: true, pausado: false, na_fila: 0, tipos: ['acao.alterada'] });
      expect(JSON.stringify(lido)).not.toContain(segredo);
    });

    it('registrar de novo religa o aviso pausado e zera as falhas', async () => {
      const c = await novaConta();
      await registrar(c);
      await poolSuper.query(`update integracao_aviso set pausado_em = now(), pausa_motivo = 'teste', falhas_seguidas = 20 where conta_id = $1`, [c.contaId]);
      await registrar(c);
      expect(await registro(c)).toMatchObject({ pausado_em: null, pausa_motivo: null, falhas_seguidas: 0 });
    });
  });

  // ------------------------------------------------------------------ o gatilho

  describe('o gatilho do pedido', () => {
    it('sem registro, nada vai à fila; com registro, a mudança vai; a segunda mudança só marca o mesmo pendente', async () => {
      const c = await novaConta();
      const semAviso = await novoPedido(c);
      await mudar(semAviso, 'cancelado', 'pedido-cancelado');
      expect(await fila(c)).toHaveLength(0);

      await registrar(c);
      const p = await novoPedido(c);
      expect(await fila(c)).toHaveLength(0); // criar não avisa: quem pediu já tem a resposta
      await poolSuper.query(`update acao_pedido set situacao = 'aprovado', decidido_em = now(), decidido_por = 'dono', teto_gasto_centavos = 1000 where id = $1`, [p]);
      const [primeira] = await fila(c);
      expect(primeira).toMatchObject({ produto: 'liame', tipo: 'acao.alterada', recurso_id: p, tentativas: 0, entregue_em: null });
      // A segunda mudança com o aviso ainda na fila: a mesma linha, só marcada de novo.
      await poolSuper.query(`update acao_pedido set situacao = 'executando' where id = $1`, [p]);
      const depois = await fila(c);
      expect(depois).toHaveLength(1);
      expect(depois[0]!.id).toBe(primeira!.id);
      expect(new Date(depois[0]!.mudou_em).getTime()).toBeGreaterThan(new Date(primeira!.mudou_em).getTime());
      // Entregue, a mudança seguinte abre outra linha.
      await servico.entregarDevidos();
      await poolSuper.query(`update acao_pedido set situacao = 'executado', executado_em = now() where id = $1`, [p]);
      expect(await fila(c)).toHaveLength(2);
    });

    it('com o aviso pausado, a mudança não vai à fila', async () => {
      const c = await novaConta();
      await registrar(c);
      await poolSuper.query(`update integracao_aviso set pausado_em = now(), pausa_motivo = 'teste' where conta_id = $1`, [c.contaId]);
      await mudar(await novoPedido(c), 'cancelado', 'pedido-cancelado');
      expect(await fila(c)).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------ a entrega

  describe('a entrega', () => {
    it('sai assinada com o segredo registrado, o webhook-id é o da linha, o corpo é só o tipo e o id, e o hub registra', async () => {
      const c = await novaConta();
      const segredo = await registrar(c);
      const p = await novoPedido(c);
      await mudar(p, 'cancelado', 'pedido-cancelado');
      const [linha] = await fila(c);

      await servico.entregarDevidos();
      const envio = enviados.find((e) => JSON.parse(e.corpo).id === p)!;
      expect(envio.url.startsWith(BASE)).toBe(true);
      expect(JSON.parse(envio.corpo)).toEqual({ tipo: 'acao.alterada', id: p });
      expect(envio.cabecalhos['webhook-id']).toBe(linha!.id);
      expect(conferirAviso(segredo, envio.cabecalhos, envio.corpo)).toBe(true);
      expect(conferirAviso(gerarSegredoAviso(), envio.cabecalhos, envio.corpo)).toBe(false);

      const [entregue] = await fila(c);
      expect(entregue).toMatchObject({ ultimo_status: 204, tentativas: 1 });
      expect(entregue!.entregue_em).not.toBeNull();
      expect(await registro(c)).toMatchObject({ falhas_seguidas: 0, ultimo_status: 204 });
      const doHub = registrados.find((r) => r.codigo === `${linha!.id}:1`)!;
      expect(doHub).toMatchObject({ aplicativo: 'liame', tipo: 'acao.alterada', resultado: 'entregue', destino: 'https://aviso.exemplo.test', tentativa: 1 });
      expect(JSON.stringify(doHub)).not.toContain(p); // nunca o conteúdo
    });

    it('a falha conta, recua e tenta de novo; depois da última tentativa, desiste', async () => {
      const c = await novaConta();
      await registrar(c);
      await mudar(await novoPedido(c), 'cancelado', 'pedido-cancelado');
      resposta = { status: 500, erro: 'o destino respondeu 500' };
      await servico.entregarDevidos();
      let [l] = await fila(c);
      expect(l).toMatchObject({ tentativas: 1, ultimo_status: 500, entregue_em: null, desistido_em: null });
      const espera = (new Date(l!.proxima_em).getTime() - Date.now()) / 1000;
      expect(espera).toBeGreaterThan(RECUO_SEGUNDOS[0]! - 10);
      expect(espera).toBeLessThan(RECUO_SEGUNDOS[0]! + 10);

      for (let i = 2; i <= RECUO_SEGUNDOS.length + 1; i += 1) {
        await naHora(c);
        await servico.entregarDevidos();
      }
      [l] = await fila(c);
      expect(l!.tentativas).toBe(RECUO_SEGUNDOS.length + 1);
      expect(l!.desistido_em).not.toBeNull();
      expect(registrados.filter((r) => r.resultado === 'falhou')).toHaveLength(RECUO_SEGUNDOS.length + 1);
    });

    it(`${FALHAS_PARA_PAUSAR} falhas seguidas pausam o registro (e a fila seguinte não recebe mais)`, async () => {
      const c = await novaConta();
      await registrar(c);
      await poolSuper.query(`update integracao_aviso set falhas_seguidas = $2 where conta_id = $1`, [c.contaId, FALHAS_PARA_PAUSAR - 1]);
      await mudar(await novoPedido(c), 'cancelado', 'pedido-cancelado');
      resposta = { status: null, erro: 'sem resposta' };
      await servico.entregarDevidos();
      const r = await registro(c);
      expect(r!.pausado_em).not.toBeNull();
      expect(r!.falhas_seguidas).toBe(FALHAS_PARA_PAUSAR);
      await mudar(await novoPedido(c), 'vencido');
      expect((await fila(c)).filter((l) => l.entregue_em === null && l.desistido_em === null)).toHaveLength(1);
    });

    it('o pedido que muda durante o envio sai de novo (a entrega não fecha a linha que mudou depois de lida)', async () => {
      const c = await novaConta();
      await registrar(c);
      const p = await novoPedido(c);
      await poolSuper.query(`update acao_pedido set situacao = 'aprovado', decidido_em = now(), decidido_por = 'dono', teto_gasto_centavos = 1000 where id = $1`, [p]);
      duranteOEnvio = async () => {
        duranteOEnvio = null;
        await poolSuper.query(`update acao_pedido set situacao = 'executando' where id = $1`, [p]);
      };
      await servico.entregarDevidos();
      let [l] = await fila(c);
      expect(l!.entregue_em).toBeNull(); // mudou no meio: continua na fila, na hora
      expect(new Date(l!.proxima_em).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      await servico.entregarDevidos();
      [l] = await fila(c);
      expect(l!.entregue_em).not.toBeNull();
      expect(enviados.filter((e) => JSON.parse(e.corpo).id === p)).toHaveLength(2);
    });

    it('sem credencial com a permissão do aviso (revogada ou sem campanhas.disparar), desiste sem mandar', async () => {
      const c = await novaConta();
      await registrar(c);
      await mudar(await novoPedido(c), 'cancelado', 'pedido-cancelado');
      await poolSuper.query(`update integracao_token set revogado_em = now() where id = $1`, [c.tokenId]);
      await servico.entregarDevidos();
      const [l] = await fila(c);
      expect(l!.desistido_em).not.toBeNull();
      expect(enviados).toHaveLength(0);

      const soLe = await novaConta(['conta.ler']);
      await registrar(soLe);
      await mudar(await novoPedido(soLe), 'cancelado', 'pedido-cancelado');
      await servico.entregarDevidos();
      expect((await fila(soLe))[0]!.desistido_em).not.toBeNull();
      expect(enviados).toHaveLength(0);
    });

    it('a parada do hub segura o envio sem contar falha; quando a parada acaba, sai', async () => {
      const c = await novaConta();
      await registrar(c);
      await mudar(await novoPedido(c), 'cancelado', 'pedido-cancelado');
      parado = true;
      await servico.entregarDevidos();
      let [l] = await fila(c);
      expect(l).toMatchObject({ tentativas: 0, entregue_em: null, desistido_em: null });
      expect(enviados).toHaveLength(0);
      expect(registrados.some((r) => r.resultado === 'pausado')).toBe(true);
      expect((await registro(c))!.falhas_seguidas).toBe(0);
      parado = false;
      await naHora(c);
      await servico.entregarDevidos();
      [l] = await fila(c);
      expect(l!.entregue_em).not.toBeNull();
    });

    it('remover apaga o registro e o que estava na fila não sai mais', async () => {
      const c = await novaConta();
      await registrar(c);
      await mudar(await novoPedido(c), 'cancelado', 'pedido-cancelado');
      expect(await naConta(c, () => servico.remover(quem(c)))).toEqual({ removido: true });
      expect(await naConta(c, () => servico.remover(quem(c)))).toEqual({ removido: false });
      expect(await registro(c)).toBeUndefined();
      expect((await fila(c))[0]!.desistido_em).not.toBeNull();
      await servico.entregarDevidos();
      expect(enviados).toHaveLength(0);
      expect(await naConta(c, () => servico.ler(quem(c)))).toEqual({ registrado: false, tipos: ['acao.alterada'] });
    });

    it('a RLS vale: a fila e o registro de uma conta não aparecem na outra', async () => {
      const a = await novaConta();
      const b = await novaConta();
      await registrar(a);
      await mudar(await novoPedido(a), 'cancelado', 'pedido-cancelado');
      const vistos = await naConta(b, async () => (await ctx.db.execute(`select count(*)::int as n from aviso_saida` as never)) as unknown);
      expect((vistos as { rows: Array<{ n: number }> }).rows[0]!.n).toBe(0);
      expect(await naConta(b, () => servico.ler(quem(b)))).toEqual({ registrado: false, tipos: ['acao.alterada'] });
    });
  });
});
