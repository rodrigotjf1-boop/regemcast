/**
 * Número sem WhatsApp.
 *
 * A Meta recusa com 131026 quando o número não tem WhatsApp, não aceitou os
 * termos do aplicativo ou usa uma versão antiga. Uma falha só pode ser coisa
 * passageira (a pessoa atualiza o app); DUAS, em campanhas diferentes, marcam
 * o contato (`sem_whatsapp_em`) — decisão do dono, 25/09/2026. Marcado, ele
 * sai sozinho dos envios e dos públicos, até alguém "tentar de novo" em
 * Contatos → Bloqueios; só as falhas depois disso contam para marcar de novo
 * (`sem_whatsapp_liberado_em`).
 *
 * As duas formas do celular brasileiro contam juntas (com e sem o 9º dígito),
 * como no descadastro.
 */
import { sql, type SQL } from 'drizzle-orm';

import { gemeoDoCelular } from '../../common/telefone';
import { formasDosContatos } from '../../common/telefone-sql';

type Executor = { execute: (q: SQL) => Promise<{ rows: unknown[] }> };

export const ERRO_SEM_WHATSAPP = 131026;
/** Em quantas campanhas diferentes a Meta precisa recusar o número. */
export const FALHAS_PARA_MARCAR = 2;
export const TITULO_SEM_WHATSAPP = 'Número sem WhatsApp';

/**
 * Depois de uma recusa 131026: com recusas em {@link FALHAS_PARA_MARCAR}
 * campanhas diferentes (desde o último "tentar de novo"), marca o contato.
 * Devolve quantos contatos foram marcados agora.
 */
export async function registrarFalhaSemWhatsapp(db: Executor, contaId: string, telefone: string): Promise<number> {
  const formas = [...new Set([telefone, gemeoDoCelular(telefone)].filter((f): f is string => Boolean(f)))];
  const lista = sql.join(
    formas.map((f) => sql`${f}::text`),
    sql`, `,
  );
  const r = await db.execute(sql`
    update contato c
       set sem_whatsapp_em = now()
     where c.conta_id = ${contaId}
       and c.telefone_e164 in (${lista})
       and c.sem_whatsapp_em is null
       and (
         select count(distinct d.campanha_id)
           from campanha_destinatario d
          where d.conta_id = ${contaId}
            and d.erro_codigo = ${ERRO_SEM_WHATSAPP}
            and d.telefone_e164 in (${lista})
            and d.falhou_em > coalesce(c.sem_whatsapp_liberado_em, '-infinity'::timestamptz)
       ) >= ${FALHAS_PARA_MARCAR}
    returning c.id
  `);
  return r.rows.length;
}

/**
 * Tira da fila quem está marcado como sem WhatsApp — como `marcarDescadastrados`:
 * vira `falhou` com o motivo, nada é enviado, nada conta no plano. A campanha
 * inteira numa consulta, cruzando por igualdade nas duas formas do celular
 * (`formasDosContatos`, ERR-018).
 */
export async function marcarSemWhatsappNaFila(db: Executor, contaId: string, filtro: SQL): Promise<void> {
  await db.execute(sql`
    with m as materialized ${formasDosContatos(contaId, sql`c.sem_whatsapp_em is not null`)}
    update campanha_destinatario d
       set status = 'falhou',
           erro_titulo = ${TITULO_SEM_WHATSAPP},
           erro_detalhe = 'A Meta recusou este número em duas campanhas: ele não tem WhatsApp, não aceitou os termos do aplicativo ou usa uma versão antiga. Nada foi enviado. Em Contatos → Bloqueios dá para tentar de novo.',
           falhou_em = now()
      from m
     where d.conta_id = ${contaId}
       and ${filtro}
       and d.status = 'pendente'
       and d.telefone_e164 = m.telefone
  `);
}
