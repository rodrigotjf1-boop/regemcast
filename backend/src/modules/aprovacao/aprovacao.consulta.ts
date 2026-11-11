/**
 * Consultas da aprovação de disparos que outros módulos usam na transação deles
 * (Hub DMS, F5 parte B), sem depender do serviço da aprovação: o serviço de
 * campanha encerra o pedido aberto quando a campanha é disparada por outro
 * caminho ou excluída, e o worker anota no pedido que o teto parou a execução
 * e lê o teto do pedido em vigor.
 */
import { sql, type SQL } from 'drizzle-orm';

type Executor = { execute: (q: SQL) => Promise<unknown> };

/**
 * Encerra o pedido aberto (`aguardando` ou `aprovado`) da campanha: o rascunho foi editado (`plano-mudou`) ou excluído
 * (`pedido-cancelado`), e o pedido não vale mais. Fica `cancelado`, decidido pelo produto. Devolve os ids encerrados.
 * Quem chama trava a campanha antes (a execução trava a mesma linha).
 */
export async function cancelarPedidosAbertos(
  db: Executor,
  contaId: string,
  campanhaId: string,
  motivo: 'plano-mudou' | 'pedido-cancelado',
): Promise<string[]> {
  const r = (await db.execute(sql`
    update acao_pedido
       set situacao = 'cancelado', motivo = ${motivo}, decidido_em = now(), decidido_por = 'produto'
     where conta_id = ${contaId} and campanha_id = ${campanhaId} and situacao in ('aguardando', 'aprovado')
    returning id
  `)) as { rows: Array<{ id: string }> };
  return r.rows.map((l) => l.id);
}

/** O pedido aberto (`aguardando`, `aprovado` ou `executando`) da campanha, se houver. */
export async function pedidoAbertoDaCampanha(db: Executor, contaId: string, campanhaId: string): Promise<string | null> {
  const r = (await db.execute(sql`
    select id from acao_pedido
     where conta_id = ${contaId} and campanha_id = ${campanhaId} and situacao in ('aguardando', 'aprovado', 'executando')
     limit 1
  `)) as { rows: Array<{ id: string }> };
  return r.rows[0]?.id ?? null;
}

/** A campanha travada para mudar (editar, excluir, disparar): a execução de um pedido trava a mesma linha. */
export async function travarCampanha(db: Executor, contaId: string, campanhaId: string): Promise<void> {
  await db.execute(sql`select id from campanha where id = ${campanhaId} and conta_id = ${contaId} for update`);
}

/** O teto do disparo parou a execução: o pedido executado ganha o motivo `teto-de-gasto` (a situação não muda). */
export async function anotarTetoNoPedido(db: Executor, contaId: string, pedidoId: string): Promise<boolean> {
  const r = (await db.execute(sql`
    update acao_pedido set motivo = 'teto-de-gasto'
     where id = ${pedidoId} and conta_id = ${contaId} and situacao = 'executado' and motivo is distinct from 'teto-de-gasto'
    returning id
  `)) as { rows: unknown[] };
  return r.rows.length > 0;
}

/** O pedido em vigor da campanha e o teto dele (com a moeda do plano aprovado). */
export interface PedidoEmVigor {
  id: string;
  tetoCentavos: number | null;
  moeda: string | null;
}

/**
 * O pedido EM VIGOR da campanha: o último executado. A campanha guarda o pedido que a disparou (`acao_pedido_id`, gravado
 * uma vez); depois de parar no teto, um pedido novo aprovado a faz seguir (o "continuar"), e o teto que vale passa a ser
 * o dele. O worker, a tela da campanha e a aprovação leem por aqui. Nulo: nenhum pedido executado.
 */
export async function pedidoEmVigor(db: Executor, contaId: string, campanhaId: string): Promise<PedidoEmVigor | null> {
  const r = (await db.execute(sql`
    select id, teto_gasto_centavos as teto, plano -> 'custo' ->> 'moeda' as moeda
      from acao_pedido
     where conta_id = ${contaId} and campanha_id = ${campanhaId} and situacao = 'executado'
     order by executado_em desc, criado_em desc
     limit 1
  `)) as { rows: Array<{ id: string; teto: string | number | null; moeda: string | null }> };
  const l = r.rows[0];
  if (!l) return null;
  return { id: l.id, tetoCentavos: l.teto === null || l.teto === undefined ? null : Number(l.teto), moeda: l.moeda ?? null };
}
