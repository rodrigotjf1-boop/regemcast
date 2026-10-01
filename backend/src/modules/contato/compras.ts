/**
 * As compras que chegam das integrações (Cardápio Web, Regem) — a parte que é
 * igual para todas: achar o contato pelo telefone, gravar a compra, bloquear
 * quem pediu para sair e refazer os totais do contato.
 *
 * Tudo aqui roda dentro da transação da conta (`ContextoDb.comConta`) e é
 * set-based: um lote de compras é um `insert` só; os totais são um `update`
 * por parte de até 500 contatos.
 *
 * Os totais saem de TODAS as compras do contato, de qualquer fonte — quem
 * comprou pelo Cardápio Web e pelo Regem tem um histórico só. A fonte entra na
 * chave da compra (`conta_id, fonte, id_externo`), então a mesma venda nunca é
 * gravada duas vezes pela mesma integração; a mesma venda vinda pelas DUAS
 * (o Regem também recebe os pedidos do Cardápio Web) é descartada na origem
 * (`regem.regras.ts`, canal `cardapio_web`).
 */
import { sql, type SQL } from 'drizzle-orm';

import { emPartes } from '../../common/em-partes';
import { gemeoDoCelular } from '../../common/telefone';
import type { Db } from '../../db/contexto';
import { periodoPreferidoSql, refazerProdutos } from './habitos';

/** De onde veio a compra (`compra.fonte`) e a foto do histórico (`contato.metricas_origem`). */
export type FonteDeCompra = 'cardapioweb' | 'regem';

/** As fontes cujas compras são a verdade do histórico — o que vem delas vence a planilha (V12). */
const FONTES_DE_COMPRA: readonly FonteDeCompra[] = ['cardapioweb', 'regem'];

/** Uma compra pronta para gravar — o mesmo formato em qualquer integração. */
export interface CompraParaGravar {
  idExterno: string;
  feitaEm: Date;
  valorCentavos: number;
  tipo: string | null;
  canal: string | null;
  bairro: string | null;
  itens: unknown[];
  atualizadaNaFonte: Date | null;
}

export interface ContatoDoTelefone {
  id: string;
  telefone: string;
  optOut: boolean;
}

/** Os contatos da conta com estes telefones — em qualquer das duas formas do celular. */
export async function contatosPorTelefone(
  db: Db,
  contaId: string,
  telefones: string[],
): Promise<Map<string, ContatoDoTelefone>> {
  const formas = [...new Set(telefones.flatMap((t) => [t, gemeoDoCelular(t)].filter((x): x is string => Boolean(x))))];
  const mapa = new Map<string, ContatoDoTelefone>();
  for (const parte of emPartes(formas, 500)) {
    const r = await db.execute(sql`
      select id, telefone_e164, opt_out from contato
       where conta_id = ${contaId}
         and telefone_e164 in (${sql.join(parte.map((t) => sql`${t}`), sql`, `)})
    `);
    for (const x of r.rows as { id: string; telefone_e164: string; opt_out: boolean }[]) {
      mapa.set(x.telefone_e164, { id: x.id, telefone: x.telefone_e164, optOut: x.opt_out });
    }
  }
  return mapa;
}

/** O contato deste telefone, na forma dele ou na outra; bloqueado em qualquer forma vence. */
export function acharContato(mapa: Map<string, ContatoDoTelefone>, telefone: string): ContatoDoTelefone | null {
  const achados = [mapa.get(telefone), mapa.get(gemeoDoCelular(telefone) ?? '')].filter((x): x is ContatoDoTelefone =>
    Boolean(x),
  );
  return achados.find((k) => k.optOut) ?? achados[0] ?? null;
}

/**
 * Grava (ou atualiza) as compras de um lote. Só reescreve a compra quando a
 * fonte a mudou (`atualizada_na_fonte`) ou ela passou a ser de outro contato.
 * Devolve os contatos tocados (para refazer os totais) e quantas eram novas.
 */
export async function gravarCompras(
  db: Db,
  contaId: string,
  fonte: FonteDeCompra,
  linhas: readonly { compra: CompraParaGravar; contatoId: string }[],
): Promise<{ afetados: string[]; novas: number }> {
  const afetados = new Set<string>();
  let novas = 0;
  for (const parte of emPartes([...linhas], 200)) {
    const r = await db.execute(sql`
      insert into compra (conta_id, contato_id, fonte, id_externo, feita_em, valor_centavos, tipo, canal, bairro, itens, atualizada_na_fonte)
      values ${sql.join(
        parte.map(
          ({ compra: c, contatoId }) =>
            sql`(${contaId}, ${contatoId}, ${fonte}, ${c.idExterno}, ${c.feitaEm}, ${c.valorCentavos}, ${c.tipo},
                 ${c.canal}, ${c.bairro}, ${JSON.stringify(c.itens)}::jsonb, ${c.atualizadaNaFonte})`,
        ),
        sql`, `,
      )}
      on conflict (conta_id, fonte, id_externo) do update
         set contato_id = excluded.contato_id,
             feita_em = excluded.feita_em,
             valor_centavos = excluded.valor_centavos,
             tipo = excluded.tipo,
             canal = excluded.canal,
             bairro = excluded.bairro,
             itens = excluded.itens,
             atualizada_na_fonte = excluded.atualizada_na_fonte
       where compra.atualizada_na_fonte is distinct from excluded.atualizada_na_fonte
          or compra.contato_id <> excluded.contato_id
      returning contato_id, (xmax = 0) as nova
    `);
    for (const x of r.rows as { contato_id: string; nova: boolean }[]) {
      afetados.add(x.contato_id);
      if (x.nova) novas++;
    }
  }
  return { afetados: [...afetados], novas };
}

/**
 * Quem pediu para sair na fonte (desligou o WhatsApp no Cardápio Web, pediu
 * para sair no Regem): entra descadastrado ou passa a estar. Um descadastro
 * que já existia não é tocado, e nenhum é desfeito. A linha criada para quem
 * não estava na base impede que o número volte por uma importação de arquivo.
 */
export async function bloquearContatos(
  db: Db,
  contaId: string,
  bloqueados: readonly { telefone: string; nome: string | null }[],
  importacaoId: string | null,
  agora: Date,
  origem: FonteDeCompra,
): Promise<void> {
  for (const parte of emPartes([...bloqueados], 500)) {
    await db.execute(sql`
      insert into contato (conta_id, telefone_e164, nome, opt_out, opt_out_em, opt_out_origem, importacao_id)
      values ${sql.join(
        parte.map((b) => sql`(${contaId}, ${b.telefone}, ${b.nome}, true, ${agora}, ${origem}, ${importacaoId})`),
        sql`, `,
      )}
      on conflict (conta_id, telefone_e164) do update
         set opt_out = true, opt_out_em = excluded.opt_out_em, opt_out_origem = excluded.opt_out_origem
       where contato.opt_out = false
    `);
  }
}

/**
 * Os totais do contato (pedidos, gasto, primeira e última compra), o bairro
 * mais frequente nas entregas, o jeito de comprar mais frequente (entrega,
 * retirada, salão; empate: o mais recente), o período do dia em que mais pede
 * (no fuso da conta) e os produtos que já comprou, refeitos das compras de
 * QUALQUER fonte — para os contatos tocados neste lote. Quem ficou sem compra
 * nenhuma (o único pedido foi cancelado) volta a "sem histórico", se o
 * histórico vinha de uma integração (nunca o que veio de planilha).
 */
export async function recalcularTotais(
  db: Db,
  contaId: string,
  contatoIds: string[],
  origem: FonteDeCompra = 'cardapioweb',
): Promise<void> {
  const fontes: SQL = sql.join(
    FONTES_DE_COMPRA.map((f) => sql`${f}`),
    sql`, `,
  );
  for (const parte of emPartes([...new Set(contatoIds)], 500)) {
    const lista: SQL = sql.join(parte.map((id) => sql`${id}::uuid`), sql`, `);
    await db.execute(sql`
      update contato c
         set pedidos = a.qtd,
             total_gasto_centavos = a.total,
             primeiro_pedido_em = a.primeiro,
             ultimo_pedido_em = a.ultimo,
             bairro = b.bairro,
             tipo_preferido = t.tipo,
             periodo_preferido = ${periodoPreferidoSql(sql`a.contato_id`)},
             metricas_em = now(),
             metricas_origem = ${origem}
        from (
          select contato_id, count(*)::int as qtd, sum(valor_centavos)::bigint as total,
                 min(feita_em) as primeiro, max(feita_em) as ultimo
            from compra
           where conta_id = ${contaId} and contato_id in (${lista})
           group by contato_id
        ) a
        left join lateral (
          -- O bairro que mais aparece (sem ligar para maiúscula; empate: o mais
          -- recente) e, dentro dele, a grafia mais usada, de preferência com
          -- inicial maiúscula — "Tijuca" e "tijuca" são o mesmo bairro.
          select x.bairro
            from compra x
           where x.contato_id = a.contato_id and x.bairro is not null
           group by x.bairro
           order by sum(count(*)) over (partition by lower(x.bairro)) desc,
                    max(max(x.feita_em)) over (partition by lower(x.bairro)) desc,
                    count(*) desc, (x.bairro ~ '^[[:upper:]]') desc, x.bairro
           limit 1
        ) b on true
        left join lateral (
          select x.tipo
            from compra x
           where x.contato_id = a.contato_id and x.tipo in ('entrega', 'retirada', 'salao')
           group by x.tipo
           order by count(*) desc, max(x.feita_em) desc
           limit 1
        ) t on true
       where c.id = a.contato_id and c.conta_id = ${contaId}
    `);
    await db.execute(sql`
      update contato c
         set pedidos = null, total_gasto_centavos = null, primeiro_pedido_em = null, ultimo_pedido_em = null,
             bairro = null, tipo_preferido = null, periodo_preferido = null, metricas_em = now()
       where c.conta_id = ${contaId}
         and c.id in (${lista})
         and c.metricas_origem in (${fontes})
         and not exists (select 1 from compra x where x.contato_id = c.id)
    `);
    await refazerProdutos(db, contaId, lista);
  }
}
