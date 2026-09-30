/**
 * O que a importação, a busca de pedidos e a leitura diária gravam do cliente
 * do Cardápio Web — funções da transação, um lugar só para os três caminhos.
 *
 * - `gravarSaldos`: o saldo de cashback e o vencimento, nas duas formas do
 *   celular, por igualdade de telefone (índice único da conta).
 * - `bloquearClientes`: quem desligou o WhatsApp no Cardápio Web entra (ou
 *   passa a estar) descadastrado — nunca desfaz um descadastro.
 * - `proximaLeituraSql`: 4h da manhã no fuso da conta.
 */
import { sql, type SQL } from 'drizzle-orm';

import { emPartes } from '../../common/em-partes';
import type { Db } from '../../db/contexto';
import { bloquearContatos } from '../contato/compras';
import type { SaldoDeCashback } from './cardapioweb.regras';

/** A leitura diária sai às 4h, no fuso da conta: a loja fechada, a campanha do dia com o saldo da madrugada. */
const HORA_DA_LEITURA = '04:00';
/** Leitura que acabou perto das 4h não emenda outra: a próxima fica a pelo menos 6 h. */
const HORAS_ATE_A_PROXIMA = 6;

/**
 * Grava o saldo de cashback dos contatos da conta com estes telefones.
 *
 * Só de quem pode receber (sem descadastro): o saldo serve à campanha, e quem
 * pediu para sair — ou pediu para apagar os dados — não volta a ter o dado
 * gravado. Quem tem saldo tem a leitura renovada sempre (`cashback_em`: é por
 * ela que a leitura diária descobre quem sumiu do Cardápio Web); sem saldo, a
 * linha só é escrita quando o valor muda.
 */
export async function gravarSaldos(
  db: Db,
  contaId: string,
  saldos: Map<string, SaldoDeCashback>,
  lidoEm: Date,
): Promise<number> {
  let gravados = 0;
  for (const parte of emPartes([...saldos.entries()], 500)) {
    const r = await db.execute(sql`
      update contato c
         set cashback_centavos = v.centavos,
             cashback_vence_em = v.vence,
             cashback_em = ${lidoEm}
        from (values ${sql.join(
          parte.map(([telefone, s]) => sql`(${telefone}::text, ${s.centavos}::int, ${s.venceEm}::date)`),
          sql`, `,
        )}) as v(telefone, centavos, vence)
       where c.conta_id = ${contaId}
         and c.telefone_e164 = v.telefone
         and c.opt_out = false
         and (v.centavos > 0
              or c.cashback_centavos is distinct from v.centavos
              or c.cashback_vence_em is distinct from v.vence)
    `);
    gravados += r.rowCount ?? 0;
  }
  return gravados;
}

/**
 * Quem desligou o WhatsApp no Cardápio Web (`notifications_enabled = false`):
 * entra descadastrado ou passa a estar. Um descadastro que já existia não é
 * tocado, e nenhum é desfeito. A linha criada para quem não estava na base
 * impede que o número volte por uma importação de arquivo.
 */
export function bloquearClientes(
  db: Db,
  contaId: string,
  bloqueados: readonly { telefone: string; nome: string | null }[],
  importacaoId: string | null,
  agora: Date,
): Promise<void> {
  return bloquearContatos(db, contaId, bloqueados, importacaoId, agora, 'cardapioweb');
}

/** A próxima leitura diária: 4h no fuso da conta, a pelo menos 6 h de agora. */
export function proximaLeituraSql(contaId: string): SQL {
  const depois = sql`(now() + make_interval(hours => ${sql.raw(String(HORAS_ATE_A_PROXIMA))}))`;
  const hora = sql.raw(`time '${HORA_DA_LEITURA}'`);
  return sql`(
    select (((${depois} at time zone c.timezone)::date
             + case when (${depois} at time zone c.timezone)::time <= ${hora} then 0 else 1 end)
            + ${hora}) at time zone c.timezone
      from conta c
     where c.id = ${contaId}
  )`;
}
