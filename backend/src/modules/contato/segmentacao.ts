/**
 * Classificação da base: Campeões, Fiéis, Em risco, Perdidos…
 *
 * Quatro números que o dono ajusta (migration 022) e duas perguntas sobre cada
 * contato: há quantos dias comprou pela última vez, e quantos pedidos tem.
 * O perfil é CALCULADO — no banco, com `expressaoSegmento`, para contar e
 * filtrar sem trazer a base inteira; e aqui, com `classificar`, a mesma regra
 * escrita em TypeScript para os testes provarem que as duas batem.
 *
 * Mudar a regra é mudar os DOIS lugares e o teste que os compara.
 */
import { sql, type SQL } from 'drizzle-orm';

export interface ParametrosSegmentacao {
  /** Comprou recentemente: última compra até N dias. */
  recenteDias: number;
  /** Ainda ativo: até N dias. */
  ativoDias: number;
  /** Em risco: até N dias. Depois disso, perdido. */
  riscoDias: number;
  /** Compra com frequência: N pedidos ou mais. */
  fielPedidos: number;
}

export const PARAMETROS_PADRAO: ParametrosSegmentacao = {
  recenteDias: 30,
  ativoDias: 90,
  riscoDias: 180,
  fielPedidos: 5,
};

export const SEGMENTOS = [
  'campeoes',
  'novos',
  'promissores',
  'fieis',
  'atencao',
  'nao_posso_perder',
  'em_risco',
  'perdidos',
  'sem_historico',
] as const;
export type Segmento = (typeof SEGMENTOS)[number];

/** Nome e a regra em português, com os números da conta — a tela mostra isto. */
export function descreverSegmentos(p: ParametrosSegmentacao): Record<Segmento, { nome: string; regra: string }> {
  const f = p.fielPedidos;
  return {
    campeoes: { nome: 'Campeões', regra: `Comprou nos últimos ${p.recenteDias} dias e tem ${f}+ pedidos.` },
    novos: { nome: 'Novos', regra: `Fez o primeiro pedido nos últimos ${p.recenteDias} dias.` },
    promissores: {
      nome: 'Promissores',
      regra: `2 a ${f - 1} pedidos, última compra em até ${p.ativoDias} dias.`,
    },
    fieis: { nome: 'Fiéis', regra: `${f}+ pedidos, última compra entre ${p.recenteDias + 1} e ${p.ativoDias} dias.` },
    atencao: { nome: 'Precisam de atenção', regra: `Um pedido só, entre ${p.recenteDias + 1} e ${p.ativoDias} dias atrás.` },
    nao_posso_perder: {
      nome: 'Não posso perder',
      regra: `${f}+ pedidos, mas sumiu há ${p.ativoDias + 1} a ${p.riscoDias} dias.`,
    },
    em_risco: { nome: 'Em risco', regra: `2 a ${f - 1} pedidos, sumiu há ${p.ativoDias + 1} a ${p.riscoDias} dias.` },
    perdidos: {
      nome: 'Perdidos',
      regra: `Sem comprar há mais de ${p.riscoDias} dias, ou um pedido só há mais de ${p.ativoDias} dias.`,
    },
    sem_historico: {
      nome: 'Sem histórico',
      regra: 'Ainda sem dados de compra: conecte o cardápio em Integrações ou importe uma planilha com pedidos.',
    },
  };
}

/**
 * A regra, em TypeScript. `pedidos` ausente com data de compra conta como 1:
 * se comprou, comprou ao menos uma vez.
 */
export function classificar(
  diasDesdeUltima: number | null,
  pedidos: number | null,
  p: ParametrosSegmentacao,
): Segmento {
  if (diasDesdeUltima == null) return 'sem_historico';
  const n = pedidos ?? 1;
  if (diasDesdeUltima <= p.recenteDias) return n >= p.fielPedidos ? 'campeoes' : n <= 1 ? 'novos' : 'promissores';
  if (diasDesdeUltima <= p.ativoDias) return n >= p.fielPedidos ? 'fieis' : n >= 2 ? 'promissores' : 'atencao';
  if (diasDesdeUltima <= p.riscoDias) return n >= p.fielPedidos ? 'nao_posso_perder' : n >= 2 ? 'em_risco' : 'perdidos';
  return 'perdidos';
}

/** Dias inteiros desde a última compra, em SQL. */
const DIAS = sql`floor(extract(epoch from (now() - contato.ultimo_pedido_em)) / 86400)`;
const PEDIDOS = sql`coalesce(contato.pedidos, 1)`;

/** A mesma regra de `classificar`, como expressão SQL sobre a tabela `contato`. */
export function expressaoSegmento(p: ParametrosSegmentacao): SQL<Segmento> {
  return sql<Segmento>`(case
    when contato.ultimo_pedido_em is null then 'sem_historico'
    when ${DIAS} <= ${p.recenteDias} then
      case when ${PEDIDOS} >= ${p.fielPedidos} then 'campeoes' when ${PEDIDOS} <= 1 then 'novos' else 'promissores' end
    when ${DIAS} <= ${p.ativoDias} then
      case when ${PEDIDOS} >= ${p.fielPedidos} then 'fieis' when ${PEDIDOS} >= 2 then 'promissores' else 'atencao' end
    when ${DIAS} <= ${p.riscoDias} then
      case when ${PEDIDOS} >= ${p.fielPedidos} then 'nao_posso_perder' when ${PEDIDOS} >= 2 then 'em_risco' else 'perdidos' end
    else 'perdidos'
  end)`;
}

/** Os limites precisam andar em ordem: recente < ativo < risco. */
export function problemaNosParametros(p: ParametrosSegmentacao): string | null {
  if (!(p.recenteDias < p.ativoDias && p.ativoDias < p.riscoDias)) {
    return 'Os dias precisam crescer: "recente" menor que "ativo", e "ativo" menor que "em risco".';
  }
  return null;
}
