/**
 * O custo de uma campanha na Meta, lido do banco.
 *
 * Duas consultas por pedido, do tamanho que a campanha tiver: a moeda da conta
 * com as tarifas dela, e as mensagens contadas em grupos (começo do telefone,
 * categoria, dia, situação). A conta do dinheiro é de `custo.regras.ts`.
 *
 * Roda na conexão de quem pede (a transação do pedido, com a conta dela): a
 * tabela de tarifas é de leitura livre (`docs/rls.md`), o resto é da conta.
 */
import { sql, type SQL } from 'drizzle-orm';

import { hojeDaConta } from '../contato/cashback';
import { TARIFA_COBRADA } from '../meta/tarifa.regras';
import {
  calcularCusto,
  categoriaNaMeta,
  custoParaTela,
  DIGITOS_DO_PREFIXO,
  type CustoParaTela,
  type FaseDoCusto,
  type GrupoDeMensagens,
  type SituacaoDaMensagem,
  type TarifaDaTabela,
} from './custo.regras';
import { numericParaMicros } from './tarifa.regras';

type Executor = { execute: (q: SQL) => Promise<unknown> };

const PREFIXO = sql.raw(String(DIGITOS_DO_PREFIXO));

/** A moeda em que a Meta cobra a conta e as tarifas cadastradas nessa moeda. */
async function moedaETarifas(db: Executor, contaId: string): Promise<{ moeda: string | null; tarifas: TarifaDaTabela[] }> {
  const r = (await db.execute(sql`
    select w.moeda, t.ddi, t.categoria, t.valor::text as valor, to_char(t.vigente_de, 'YYYY-MM-DD') as "vigenteDe"
      from (select upper(nullif(trim(moeda), '')) as moeda
              from wa_conta where conta_id = ${contaId} order by criado_em limit 1) w
      left join tarifa_meta t on t.moeda = w.moeda
  `)) as { rows: Array<{ moeda: string | null; ddi: string | null; categoria: string | null; valor: string | null; vigenteDe: string | null }> };

  return {
    moeda: r.rows[0]?.moeda ?? null,
    tarifas: r.rows.flatMap((l) =>
      l.ddi && l.categoria && l.vigenteDe
        ? [{ ddi: l.ddi, categoria: l.categoria, valorMicros: numericParaMicros(l.valor), vigenteDe: l.vigenteDe }]
        : [],
    ),
  };
}

function faseDaCampanha(status: string): FaseDoCusto {
  if (status === 'rascunho') return 'antes';
  return status === 'concluida' || status === 'cancelada' ? 'encerrada' : 'saindo';
}

/**
 * O custo de uma campanha: o que a Meta já cobrou e o que ainda pode cobrar.
 *
 * - Cobrada é a mensagem entregue (ou lida) que a Meta marcou como `regular`,
 *   na categoria que ELA disse, pela tarifa do dia da entrega.
 * - Ainda pode sair o que está na fila ou a caminho, pela categoria do modelo e
 *   a tarifa de hoje — menos o que a Meta já avisou que sai de graça.
 * - Falha, cancelamento e descanso não custam nada e ficam de fora.
 */
export async function custoDaCampanha(
  db: Executor,
  contaId: string,
  c: { id: string; status: string; modeloCategoria: string | null },
): Promise<CustoParaTela> {
  const { moeda, tarifas } = await moedaETarifas(db, contaId);
  const categoria = categoriaNaMeta(c.modeloCategoria);
  const hoje = hojeDaConta(contaId);

  const r = (await db.execute(sql`
    select left(d.telefone_e164, ${PREFIXO}) as prefixo,
           coalesce(d.tarifa_categoria, ${categoria}::text) as categoria,
           case when d.status in ('entregue', 'lida')
                then to_char((coalesce(d.entregue_em, d.lida_em, d.enviada_em, now())
                              at time zone (select timezone from conta where id = ${contaId}))::date, 'YYYY-MM-DD')
                else to_char(${hoje}, 'YYYY-MM-DD')
           end as dia,
           case when d.status not in ('entregue', 'lida') then 'a_sair'
                when d.tarifa_tipo is null then 'sem_aviso'
                when d.tarifa_tipo = ${TARIFA_COBRADA} then 'cobrada'
                else 'gratis'
           end as situacao,
           count(*)::int as quantas
      from campanha_destinatario d
     where d.campanha_id = ${c.id}
       and d.conta_id = ${contaId}
       and (d.status in ('entregue', 'lida')
            or (d.status in ('pendente', 'enviando', 'enviada')
                and coalesce(d.tarifa_tipo, ${TARIFA_COBRADA}) = ${TARIFA_COBRADA}))
     group by 1, 2, 3, 4
  `)) as { rows: Array<{ prefixo: string; categoria: string | null; dia: string; situacao: SituacaoDaMensagem; quantas: number }> };

  const grupos: GrupoDeMensagens[] = r.rows.map((l) => ({ ...l, quantas: Number(l.quantas) }));
  return custoParaTela(calcularCusto(grupos, tarifas), moeda, faseDaCampanha(c.status));
}

/**
 * O custo estimado de um público que ainda não virou campanha: todos os que
 * podem receber, pela categoria do modelo escolhido e a tarifa de hoje.
 *
 * `quemPode` é o MESMO filtro da prévia (sobre `contato`, sem apelido): o
 * número de mensagens daqui é o total que a tela mostra ao lado.
 *
 * A categoria vem da tela, e pode: aqui nada é gravado, é só a estimativa que
 * a própria pessoa vai ler. Na campanha criada vale a categoria lida da Meta.
 * Nulo quando a tela ainda não escolheu o modelo.
 */
export async function custoDoPublico(
  db: Executor,
  contaId: string,
  quemPode: SQL,
  categoriaDaTela: unknown,
): Promise<CustoParaTela | null> {
  const categoria = categoriaNaMeta(categoriaDaTela);
  if (!categoria) return null;

  const { moeda, tarifas } = await moedaETarifas(db, contaId);
  const r = (await db.execute(sql`
    select left(contato.telefone_e164, ${PREFIXO}) as prefixo,
           to_char(${hojeDaConta(contaId)}, 'YYYY-MM-DD') as dia,
           count(*)::int as quantas
      from contato
     where ${quemPode}
     group by 1
  `)) as { rows: Array<{ prefixo: string; dia: string; quantas: number }> };

  const grupos: GrupoDeMensagens[] = r.rows.map((l) => ({
    prefixo: l.prefixo,
    categoria,
    dia: l.dia,
    situacao: 'a_sair',
    quantas: Number(l.quantas),
  }));
  return custoParaTela(calcularCusto(grupos, tarifas), moeda, 'antes');
}
