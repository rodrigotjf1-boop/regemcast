/**
 * Hábitos de compra (Fase 4B): o período do dia em que cada contato costuma
 * pedir e os produtos que ele já comprou.
 *
 * O PERÍODO sai da hora de cada compra no fuso da CONTA (`conta.timezone`) —
 * nunca no do servidor, que roda em UTC e empurraria o jantar das 20h para a
 * madrugada. O que mais aparece nas compras do contato (empate: o da compra
 * mais recente) fica em `contato.periodo_preferido`, refeito a cada
 * sincronização junto com os totais e quando a conta troca de fuso.
 *
 * Os PRODUTOS ficam em `contato_produto` (migration 032): um por contato e
 * nome, sem ligar para maiúscula. Guardados, e não calculados a cada
 * consulta, porque abrir todas as compras a cada filtro custava 0,7 s numa
 * loja de 100 mil compras com a RLS ligada — e 0,04 s pela tabela.
 *
 * A migration 032 preenche quem já tinha compras com as MESMAS regras: mudou
 * aqui, mude lá numa migration nova.
 */
import { sql, type SQL } from 'drizzle-orm';

import type { Db } from '../../db/contexto';

/** Na ordem do dia, que é a ordem da tela. */
export const PERIODOS = ['cafe', 'almoco', 'tarde', 'noite', 'madrugada'] as const;
export type Periodo = (typeof PERIODOS)[number];

/** Onde cada período acaba (hora local, exclusiva), a partir da meia-noite. */
const FIM_DO_PERIODO: readonly { periodo: Periodo; ate: number }[] = [
  { periodo: 'madrugada', ate: 6 },
  { periodo: 'cafe', ate: 11 },
  { periodo: 'almoco', ate: 15 },
  { periodo: 'tarde', ate: 18 },
  { periodo: 'noite', ate: 24 },
];

/** Das X às Y de cada período, para a regra que a tela mostra. */
export const HORAS_DO_PERIODO: Record<Periodo, { de: number; ate: number }> = {
  madrugada: { de: 0, ate: 6 },
  cafe: { de: 6, ate: 11 },
  almoco: { de: 11, ate: 15 },
  tarde: { de: 15, ate: 18 },
  noite: { de: 18, ate: 24 },
};

/** O período de uma hora local (0 a 23). */
export function periodoDaHora(hora: number): Periodo {
  return (FIM_DO_PERIODO.find((p) => hora < p.ate) ?? FIM_DO_PERIODO[FIM_DO_PERIODO.length - 1]!).periodo;
}

/** O mesmo, em SQL, sobre uma expressão que dá a hora local. Constantes daqui, nunca do usuário. */
export function periodoDaHoraSql(hora: SQL): SQL {
  const casos = FIM_DO_PERIODO.slice(0, -1).map(
    (p) => sql`when ${hora} < ${sql.raw(String(p.ate))} then ${sql.raw(`'${p.periodo}'`)}`,
  );
  return sql`(case ${sql.join(casos, sql` `)} else ${sql.raw(`'${FIM_DO_PERIODO[FIM_DO_PERIODO.length - 1]!.periodo}'`)} end)`;
}

/**
 * O período preferido de UM contato (`contatoId` é a coluna de fora): o que
 * mais aparece nas compras dele, no fuso da conta; empate: o da compra mais
 * recente. Subconsulta de uma linha — nula sem compra.
 */
export function periodoPreferidoSql(contatoId: SQL): SQL {
  return sql`(
    select y.periodo
      from (
        select ${periodoDaHoraSql(sql`extract(hour from x.feita_em at time zone ct.timezone)`)} as periodo,
               x.feita_em
          from compra x
          join conta ct on ct.id = x.conta_id
         where x.contato_id = ${contatoId}
      ) y
     group by y.periodo
     order by count(*) desc, max(y.feita_em) desc
     limit 1
  )`;
}

/**
 * Refaz o período de todos os contatos da conta que têm compra (ou tinham um
 * período). É o que acontece quando a conta troca de fuso: a hora das compras
 * muda, e o período junto. Um comando.
 */
export async function recalcularPeriodosDaConta(db: Db, contaId: string): Promise<void> {
  await db.execute(sql`
    update contato c
       set periodo_preferido = p.periodo
      from (
        select k.id, ${periodoPreferidoSql(sql`k.id`)} as periodo
          from contato k
         where k.conta_id = ${contaId}
           and (k.periodo_preferido is not null
                or exists (select 1 from compra x where x.conta_id = k.conta_id and x.contato_id = k.id))
      ) p
     where c.id = p.id
       and c.conta_id = ${contaId}
       and c.periodo_preferido is distinct from p.periodo
  `);
}

/**
 * Refaz os produtos dos contatos (`ids`, uma lista de uuid em SQL) a partir
 * das compras: apaga e grava de novo. Por grafia primeiro (em quantas compras
 * e a última), depois juntando as grafias do mesmo nome — a mais usada vence;
 * empate: a mais recente, depois a com inicial maiúscula. Nunca `min()` de
 * texto, que depende da ordenação do banco (ERR-011).
 */
export async function refazerProdutos(db: Db, contaId: string, ids: SQL): Promise<void> {
  await db.execute(sql`delete from contato_produto where conta_id = ${contaId} and contato_id in (${ids})`);
  await db.execute(sql`
    insert into contato_produto (conta_id, contato_id, chave, nome, compras, ultima_em)
    select s.conta_id, s.contato_id, s.chave,
           (array_agg(s.nome order by s.qtd desc, s.ultima desc, (s.nome ~ '^[[:upper:]]') desc, s.nome))[1],
           sum(s.qtd)::int,
           max(s.ultima)
      from (
        select x.conta_id, x.contato_id, lower(i.item->>'n') as chave, i.item->>'n' as nome,
               count(distinct x.id) as qtd, max(x.feita_em) as ultima
          from compra x
         cross join lateral jsonb_array_elements(
                 case when jsonb_typeof(x.itens) = 'array' then x.itens else '[]'::jsonb end
               ) as i(item)
         where x.conta_id = ${contaId}
           and x.contato_id in (${ids})
           and coalesce(btrim(i.item->>'n'), '') <> ''
         group by 1, 2, 3, 4
      ) s
     group by s.conta_id, s.contato_id, s.chave
    on conflict (contato_id, chave) do update
       set nome = excluded.nome, compras = excluded.compras, ultima_em = excluded.ultima_em
  `);
}

// ------------------------------------------------------------ horário da campanha

/**
 * A janela de envio sugerida para quem pede em cada período: a mensagem chega
 * pouco antes do pedido — começa 1 h antes do período e dura 2 h —, e nunca
 * antes das 8h nem depois das 21h, porque promoção fora de hora é o jeito mais
 * rápido de a pessoa bloquear o número. Por isso o café da manhã começa às 8h
 * e a madrugada vira começo da noite.
 */
export const JANELA_SUGERIDA: Record<Periodo, { inicio: string; fim: string }> = {
  cafe: { inicio: '08:00', fim: '10:00' },
  almoco: { inicio: '10:00', fim: '12:00' },
  tarde: { inicio: '14:00', fim: '16:00' },
  noite: { inicio: '17:00', fim: '19:00' },
  madrugada: { inicio: '19:00', fim: '21:00' },
};

/** Com menos gente que isso com compra na lista, uma porcentagem engana. */
export const MINIMO_PARA_SUGERIR = 20;
/** O período que puxa a sugestão precisa reunir pelo menos esta parte de quem tem compra. */
export const PARTE_MINIMA_PARA_SUGERIR = 0.4;

export interface SugestaoDeHorario {
  /** Quem pode receber na lista. */
  total: number;
  /** Desses, quantos têm período (compras). */
  comHabito: number;
  /** Com menos gente com compra que isso, não há sugestão — a tela fica calada. */
  minimo: number;
  /** Os períodos que aparecem, do maior para o menor. */
  periodos: { periodo: Periodo; total: number }[];
  /** A janela sugerida — ou nula, com pouca gente ou sem um período que se destaque. */
  sugestao: { periodo: Periodo; percentual: number; inicio: string; fim: string } | null;
}

/** Monta a sugestão a partir da contagem de cada período na lista. Pura. */
export function sugerirHorario(total: number, contagem: Partial<Record<Periodo, number>>): SugestaoDeHorario {
  const periodos = PERIODOS.map((periodo) => ({ periodo, total: Math.max(0, contagem[periodo] ?? 0) }))
    .filter((p) => p.total > 0)
    .sort((a, b) => b.total - a.total || PERIODOS.indexOf(a.periodo) - PERIODOS.indexOf(b.periodo));
  const comHabito = periodos.reduce((soma, p) => soma + p.total, 0);
  const topo = periodos[0];
  const parte = topo && comHabito > 0 ? topo.total / comHabito : 0;
  const sugestao =
    topo && comHabito >= MINIMO_PARA_SUGERIR && parte >= PARTE_MINIMA_PARA_SUGERIR
      ? // Para baixo: 39,6% não aparece como "40%" sem virar sugestão.
        { periodo: topo.periodo, percentual: Math.floor(parte * 100), ...JANELA_SUGERIDA[topo.periodo] }
      : null;
  return { total, comHabito, minimo: MINIMO_PARA_SUGERIR, periodos, sugestao };
}
