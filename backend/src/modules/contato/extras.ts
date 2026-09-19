/**
 * Grava o que o contato traz além de nome e telefone: e-mail, aniversário e o
 * histórico de compra.
 *
 * Regras, de propósito diferentes por campo:
 * - e-mail e aniversário só PREENCHEM o que está vazio — o que já está na base
 *   pode ter sido corrigido à mão;
 * - pedidos, total gasto e última compra SUBSTITUEM: são uma foto do sistema da
 *   loja, e a importação mais nova é a foto mais recente;
 * - consentimento e descadastro nunca são tocados aqui.
 *
 * Um UPDATE por lote de 500 (VALUES + join), nunca um por contato.
 */
import { sql } from 'drizzle-orm';

import type { Db } from '../../db/contexto';

export interface ExtrasDoContato {
  /** E.164 sem '+', já normalizado. */
  telefone: string;
  email?: string | null;
  /** `AAAA-MM-DD` */
  dataNascimento?: string | null;
  pedidos?: number | null;
  totalGastoCentavos?: number | null;
  /** ISO 8601 */
  ultimoPedidoEm?: string | null;
}

const temAlgo = (x: ExtrasDoContato) =>
  x.email != null ||
  x.dataNascimento != null ||
  x.pedidos != null ||
  x.totalGastoCentavos != null ||
  x.ultimoPedidoEm != null;

export async function gravarExtras(
  db: Db,
  contaId: string,
  linhas: ExtrasDoContato[],
  origem: 'planilha' | 'cardapioweb',
): Promise<void> {
  const uteis = linhas.filter(temAlgo);
  for (let i = 0; i < uteis.length; i += 500) {
    const valores = uteis.slice(i, i + 500).map(
      (x) => sql`(${x.telefone}::text, ${x.email ?? null}::text, ${x.dataNascimento ?? null}::date,
                  ${x.pedidos ?? null}::int, ${x.totalGastoCentavos ?? null}::bigint,
                  ${x.ultimoPedidoEm ?? null}::timestamptz)`,
    );
    await db.execute(sql`
      update contato c
         set email                = coalesce(c.email, v.email),
             data_nascimento      = coalesce(c.data_nascimento, v.nasc),
             pedidos              = coalesce(v.pedidos, c.pedidos),
             total_gasto_centavos = coalesce(v.total, c.total_gasto_centavos),
             ultimo_pedido_em     = coalesce(v.ultimo, c.ultimo_pedido_em),
             metricas_em          = case when coalesce(v.pedidos::text, v.total::text, v.ultimo::text) is not null
                                         then now() else c.metricas_em end,
             metricas_origem      = case when coalesce(v.pedidos::text, v.total::text, v.ultimo::text) is not null
                                         then ${origem} else c.metricas_origem end
        from (values ${sql.join(valores, sql`, `)}) as v(tel, email, nasc, pedidos, total, ultimo)
       where c.conta_id = ${contaId}
         and c.telefone_e164 = v.tel
    `);
  }
}
