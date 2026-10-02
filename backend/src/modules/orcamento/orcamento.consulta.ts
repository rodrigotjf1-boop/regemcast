/**
 * O orçamento de disparos, lido do banco.
 *
 * Funções que recebem o executor de quem chama, como `saldoDoPlano`: a rodada
 * do envio usa dentro da transação dela (com a trava por conta), e as rotas da
 * conta, dentro da transação do pedido. As regras ficam em `orcamento.regras.ts`.
 *
 * Conta sem teto nenhum custa UMA consulta aqui (a linha da conta), e a rodada
 * segue sem olhar mais nada.
 */
import { sql, type SQL } from 'drizzle-orm';

import { TARIFA_COBRADA } from '../meta/tarifa.regras';
import { moedaETarifas } from './custo.consulta';
import { categoriaNaMeta, DIGITOS_DO_PREFIXO, type TarifaDaTabela } from './custo.regras';
import {
  PERIODOS,
  precoDaRodada,
  quantasCabem,
  usoDoOrcamento,
  type GrupoDoOrcamento,
  type Janelas,
  type NivelAtingido,
  type Tetos,
  type UsoDoPeriodo,
} from './orcamento.regras';

type Executor = { execute: (q: SQL) => Promise<unknown> };

const PREFIXO = sql.raw(String(DIGITOS_DO_PREFIXO));

export interface EstadoDoOrcamento {
  tetos: Tetos;
  /** A moeda em que a Meta cobra a conta. Nulo = ainda não lida (ou conta sem teto: nem foi lida). */
  moeda: string | null;
  tarifas: TarifaDaTabela[];
  /** "Hoje" no fuso da conta, AAAA-MM-DD: o dia que escolhe a tarifa. */
  hoje: string;
  /** O uso de cada período que tem teto. Vazio = a conta não tem teto. */
  usos: UsoDoPeriodo[];
}

/**
 * Os tetos da conta e quanto já saiu em cada período (dia, semana a partir de
 * segunda, mês — no fuso da conta).
 *
 * Conta como gasto o que SAIU no período: quem está saindo agora (`enviando`) e
 * quem a Meta aceitou, menos a que falhou e a que ela avisou que sai de graça.
 * A categoria é a que a Meta disse, quando já disse; senão, a do modelo.
 */
export async function estadoDoOrcamento(db: Executor, contaId: string): Promise<EstadoDoOrcamento> {
  const agora = sql`(now() at time zone c.timezone)`;
  const r = (await db.execute(sql`
    select c.orcamento_dia_centavos as dia,
           c.orcamento_semana_centavos as semana,
           c.orcamento_mes_centavos as mes,
           to_char(${agora}::date, 'YYYY-MM-DD') as hoje,
           date_trunc('day', ${agora}) at time zone c.timezone as "diaInicio",
           date_trunc('week', ${agora}) at time zone c.timezone as "semanaInicio",
           date_trunc('month', ${agora}) at time zone c.timezone as "mesInicio",
           (date_trunc('day', ${agora}) + interval '1 day') at time zone c.timezone as "diaVira",
           (date_trunc('week', ${agora}) + interval '1 week') at time zone c.timezone as "semanaVira",
           (date_trunc('month', ${agora}) + interval '1 month') at time zone c.timezone as "mesVira",
           to_char(date_trunc('week', ${agora}), 'YYYY-MM-DD') as "semanaDia",
           to_char(date_trunc('month', ${agora}), 'YYYY-MM-DD') as "mesDia"
      from conta c
     where c.id = ${contaId}
  `)) as { rows: Array<Record<string, unknown>> };

  const linha = r.rows[0];
  const numero = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  const tetos: Tetos = { dia: numero(linha?.dia), semana: numero(linha?.semana), mes: numero(linha?.mes) };
  const hoje = String(linha?.hoje ?? '');
  if (!linha || PERIODOS.every((p) => tetos[p] === null)) {
    return { tetos, moeda: null, tarifas: [], hoje, usos: [] };
  }

  const data = (v: unknown) => new Date(String(v));
  const inicio = { dia: data(linha.diaInicio), semana: data(linha.semanaInicio), mes: data(linha.mesInicio) };
  const janelas: Janelas = {
    dia: { inicio: hoje, viraEm: data(linha.diaVira) },
    semana: { inicio: String(linha.semanaDia), viraEm: data(linha.semanaVira) },
    mes: { inicio: String(linha.mesDia), viraEm: data(linha.mesVira) },
  };

  const { moeda, tarifas } = await moedaETarifas(db, contaId);

  // Só olha até o começo do período mais antigo que tem teto (a semana pode começar no mês anterior).
  const desde = new Date(Math.min(...PERIODOS.filter((p) => tetos[p] !== null).map((p) => inicio[p].getTime())));
  const noPeriodo = (p: 'dia' | 'semana' | 'mes') =>
    sql`count(*) filter (where d.status = 'enviando' or d.enviada_em >= ${inicio[p].toISOString()}::timestamptz)::int`;
  const g = (await db.execute(sql`
    select left(d.telefone_e164, ${PREFIXO}) as prefixo,
           d.tarifa_categoria as "daMeta",
           c.modelo_categoria as "doModelo",
           ${noPeriodo('dia')} as dia,
           ${noPeriodo('semana')} as semana,
           ${noPeriodo('mes')} as mes
      from campanha_destinatario d
      join campanha c on c.id = d.campanha_id
     where d.conta_id = ${contaId}
       and (d.status = 'enviando'
            or (d.enviada_em >= ${desde.toISOString()}::timestamptz and d.status in ('enviada', 'entregue', 'lida')))
       and coalesce(d.tarifa_tipo, ${TARIFA_COBRADA}) = ${TARIFA_COBRADA}
     group by 1, 2, 3
  `)) as { rows: Array<{ prefixo: string; daMeta: string | null; doModelo: string | null; dia: number; semana: number; mes: number }> };

  const grupos: GrupoDoOrcamento[] = g.rows.map((l) => ({
    prefixo: l.prefixo,
    categoria: l.daMeta ?? categoriaNaMeta(l.doModelo),
    dia: Number(l.dia),
    semana: Number(l.semana),
    mes: Number(l.mes),
  }));

  return { tetos, moeda, tarifas, hoje, usos: usoDoOrcamento(tetos, grupos, tarifas, hoje, janelas) };
}

export interface FolgaDaCampanha {
  estado: EstadoDoOrcamento;
  /** O preço de uma mensagem da vez (o maior entre os países de quem está na fila agora). Nulo = sem tarifa. */
  precoMicros: number | null;
  /** Quantas mensagens ainda cabem no orçamento. Nulo = nada limita. */
  cabem: number | null;
}

/**
 * Quanto do orçamento sobra para a próxima rodada desta campanha: olha quem
 * está na vez (até `quantas`), pega o preço de uma mensagem e vê quantas cabem.
 */
export async function folgaParaACampanha(
  db: Executor,
  contaId: string,
  campanha: { id: string; modeloCategoria: string | null },
  quantas: number,
): Promise<FolgaDaCampanha> {
  const estado = await estadoDoOrcamento(db, contaId);
  if (!estado.usos.length) return { estado, precoMicros: null, cabem: null };

  const r = (await db.execute(sql`
    select distinct left(x.telefone_e164, ${PREFIXO}) as prefixo
      from (select telefone_e164 from campanha_destinatario
             where campanha_id = ${campanha.id} and status = 'pendente'
               and (proxima_tentativa_em is null or proxima_tentativa_em <= now())
             order by criado_em
             limit ${Math.max(1, Math.trunc(quantas))}) x
  `)) as { rows: Array<{ prefixo: string }> };

  const precoMicros = precoDaRodada(
    estado.tarifas,
    r.rows.map((l) => l.prefixo),
    categoriaNaMeta(campanha.modeloCategoria),
    estado.hoje,
  );
  return { estado, precoMicros, cabem: quantasCabem(estado.usos, precoMicros) };
}

/**
 * Anota os avisos que o orçamento pede e devolve só os que são NOVOS — a chave
 * única da tabela é o que impede o mesmo aviso de sair duas vezes. O 100%
 * anota o 80% junto, para ele não sair depois.
 */
export async function registrarAvisos(db: Executor, contaId: string, niveis: readonly NivelAtingido[]): Promise<NivelAtingido[]> {
  if (!niveis.length) return [];
  const linhas = niveis.flatMap((n) =>
    (n.nivel === 100 ? [80, 100] : [80]).map((nivel) => sql`(${contaId}, ${n.periodo}, ${n.inicio}::date, ${nivel})`),
  );
  const r = (await db.execute(sql`
    insert into orcamento_aviso (conta_id, periodo, inicio, nivel)
    values ${sql.join(linhas, sql`, `)}
    on conflict (conta_id, periodo, inicio, nivel) do nothing
    returning periodo, nivel
  `)) as { rows: Array<{ periodo: string; nivel: number }> };

  return niveis.filter((n) => r.rows.some((l) => l.periodo === n.periodo && Number(l.nivel) === n.nivel));
}

/**
 * Devolve à fila as campanhas pausadas pelo orçamento cuja hora de voltar
 * chegou (a virada do período). Quando `contaId` vem, devolve as da conta sem
 * olhar a hora — o dono mudou o orçamento. Não confere a folga: a rodada
 * seguinte confere e, se ainda não couber, pausa de novo.
 */
export async function retomarPausadasPeloOrcamento(db: Executor, contaId?: string): Promise<number> {
  const filtro = contaId ? sql`and conta_id = ${contaId}` : sql`and retomar_em is not null and retomar_em <= now()`;
  const r = (await db.execute(sql`
    update campanha
       set status = 'agendada', pausa_motivo = null, retomar_em = null
     where status = 'pausada' and pausa_motivo = 'orcamento'
       ${filtro}
    returning id
  `)) as { rows: unknown[] };
  return r.rows.length;
}
