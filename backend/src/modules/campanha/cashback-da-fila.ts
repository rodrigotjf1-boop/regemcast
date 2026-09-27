/**
 * O cashback na hora do envio, para campanha que fala do saldo.
 *
 * A campanha pode levar dias para sair (janela, tetos, limite da Meta), e o
 * saldo muda a cada compra. A cada rodada do envio, sobre os pendentes:
 *
 * 1. quem não tem mais cashback válido (usou ou venceu depois da montagem)
 *    sai da fila, com o motivo — nada é enviado e não conta no plano, como o
 *    "Pediu para sair";
 * 2. quem ainda tem recebe o saldo e a validade DE HOJE, não os da montagem.
 *
 * Campanha com variável de cashback sempre veio da base (lista ou "Da base"),
 * com o telefone exato do contato — o cruzamento é por igualdade, no índice
 * único (conta, telefone). A regra de "cashback válido" é a mesma dos
 * públicos (`contato/cashback.ts`).
 */
import { sql, type SQL } from 'drizzle-orm';

import { cashbackValido } from '../contato/cashback';
import { ehDeCashback, valorDaVariavel, type VariavelDaLista } from './variaveis';

type Executor = { execute: (q: SQL) => Promise<unknown> };

export const TITULO_SEM_CASHBACK = 'Cashback usado ou vencido';

const DETALHE_SEM_CASHBACK =
  'Quando a campanha foi montada, esta pessoa tinha cashback; na hora do envio não tinha mais (usou ou venceu). Nada foi enviado, e não contou no plano.';

export async function conferirCashbackDaFila(
  db: Executor,
  contaId: string,
  campanhaId: string,
  variaveis: readonly VariavelDaLista[],
  hoje: SQL,
): Promise<void> {
  await db.execute(sql`
    update campanha_destinatario d
       set status = 'falhou',
           erro_titulo = ${TITULO_SEM_CASHBACK},
           erro_detalhe = ${DETALHE_SEM_CASHBACK},
           falhou_em = now()
     where d.conta_id = ${contaId}
       and d.campanha_id = ${campanhaId}
       and d.status = 'pendente'
       and not exists (
         select 1 from contato c
          where c.conta_id = d.conta_id
            and c.telefone_e164 = d.telefone_e164
            and ${cashbackValido('c', hoje)}
       )
  `);

  // As variáveis de cashback refeitas com o contato de hoje; as outras ficam
  // como foram montadas.
  const novas = sql`jsonb_build_array(${sql.join(
    variaveis.map((v, i) =>
      ehDeCashback(v) ? sql`to_jsonb(${valorDaVariavel(v, 'c', hoje)})` : sql`d.variaveis -> ${sql.raw(String(i))}`,
    ),
    sql`, `,
  )})`;
  await db.execute(sql`
    update campanha_destinatario d
       set variaveis = ${novas}
      from contato c
     where d.conta_id = ${contaId}
       and d.campanha_id = ${campanhaId}
       and d.status = 'pendente'
       and c.conta_id = d.conta_id
       and c.telefone_e164 = d.telefone_e164
       and d.variaveis is distinct from ${novas}
  `);
}
