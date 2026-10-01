/**
 * O pedido de exclusão da LGPD: apaga os dados pessoais e MANTÉM o bloqueio
 * (o número, marcado).
 *
 * O nome, o e-mail, o aniversário, o cashback e o histórico somem; fica o
 * número bloqueado, que é o que impede a pessoa de voltar numa importação
 * futura e receber de novo. As compras dessa pessoa também são dado pessoal:
 * saem junto, e o que saiu delas (os produtos que ela comprou).
 *
 * Um lugar só para a lista do que é dado pessoal do contato: a tela do contato
 * (`ContatoService.anonimizar`, um por vez) e o esquecimento que o Regem manda
 * (`regem.service.ts`, em lote) passam por aqui. Campo pessoal novo no contato
 * entra AQUI.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import { emPartes } from '../../common/em-partes';
import type { Db } from '../../db/contexto';
import { contato } from '../../db/schema';

/** Anonimiza os contatos da conta com estes ids. Devolve os que existiam (id e telefone). */
export async function anonimizarContatos(
  db: Db,
  contaId: string,
  ids: readonly string[],
  evidencia: string,
): Promise<{ id: string; telefone: string }[]> {
  const feitos: { id: string; telefone: string }[] = [];
  for (const parte of emPartes([...new Set(ids)], 500)) {
    const alterados = await db
      .update(contato)
      .set({
        nome: null,
        email: null,
        dataNascimento: null,
        pedidos: null,
        totalGastoCentavos: null,
        primeiroPedidoEm: null,
        ultimoPedidoEm: null,
        bairro: null,
        tipoPreferido: null,
        periodoPreferido: null,
        cashbackCentavos: null,
        cashbackVenceEm: null,
        cashbackEm: null,
        metricasEm: null,
        metricasOrigem: null,
        consentimentoEvidencia: evidencia,
        optOut: true,
        optOutEm: sql`coalesce(${contato.optOutEm}, now())`,
        optOutOrigem: sql`coalesce(${contato.optOutOrigem}, 'pedido_exclusao')`,
      })
      .where(and(eq(contato.contaId, contaId), inArray(contato.id, parte)))
      .returning({ id: contato.id, telefone: contato.telefoneE164 });
    if (!alterados.length) continue;

    const lista = sql.join(
      alterados.map((a) => sql`${a.id}::uuid`),
      sql`, `,
    );
    await db.execute(sql`delete from compra where conta_id = ${contaId} and contato_id in (${lista})`);
    await db.execute(sql`delete from contato_produto where conta_id = ${contaId} and contato_id in (${lista})`);
    feitos.push(...alterados);
  }
  return feitos;
}
