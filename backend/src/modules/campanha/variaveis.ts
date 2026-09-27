/**
 * As variáveis da campanha quando o público sai da base (uma lista ou "Da
 * base"): de onde vem cada uma e o valor, em SQL, para cada contato.
 *
 * - `fixo` — o mesmo texto para todos;
 * - `nome` / `primeiro_nome` — do contato; sem nome, o texto reserva (a Meta
 *   recusa variável vazia);
 * - `cashback_saldo` — o saldo de cashback do contato ("R$ 12,50");
 * - `cashback_validade` — o dia em que o cashback vence ("30/09"); sem data,
 *   o texto reserva.
 *
 * Mensagem com variável de cashback só vai para quem tem cashback válido: a
 * montagem filtra, e a conferência na hora do envio (`cashback-da-fila.ts`)
 * tira quem perdeu o saldo e atualiza o valor de quem ainda tem. Por isso a
 * campanha guarda a lista (`campanha.variaveis_lista`).
 *
 * Números digitados trazem as variáveis prontas, uma por pessoa — nada disto
 * vale para eles.
 */
import { sql, type SQL } from 'drizzle-orm';

import { dataCurtaEmSql, reaisEmSql } from '../contato/cashback';

export const ORIGENS_VARIAVEL = ['fixo', 'nome', 'primeiro_nome', 'cashback_saldo', 'cashback_validade'] as const;
export type OrigemDaVariavel = (typeof ORIGENS_VARIAVEL)[number];

export interface VariavelDaLista {
  origem: OrigemDaVariavel;
  /** O texto (fixo) ou o reserva (nome, primeiro nome, validade). O saldo não usa. */
  valor: string;
}

const DE_CASHBACK: readonly string[] = ['cashback_saldo', 'cashback_validade'] satisfies OrigemDaVariavel[];

export function ehDeCashback(v: { origem: string }): boolean {
  return DE_CASHBACK.includes(v.origem);
}

/** A campanha fala do cashback — e então só vai para quem tem cashback válido. */
export function usaCashback(lista: readonly { origem: string }[] | null | undefined): boolean {
  return Boolean(lista?.some(ehDeCashback));
}

/** Como a campanha guarda: o saldo sai sempre do contato, sem texto reserva. */
export function normalizarVariaveis(lista: readonly VariavelDaLista[] | undefined): VariavelDaLista[] {
  return (lista ?? []).map((v) => ({ origem: v.origem, valor: v.origem === 'cashback_saldo' ? '' : v.valor }));
}

/** O que a campanha guardou em `variaveis_lista`, conferido; `null` se não for uma lista válida. */
export function lerVariaveis(json: unknown): VariavelDaLista[] | null {
  if (!Array.isArray(json)) return null;
  const validas = json.filter(
    (v): v is VariavelDaLista =>
      Boolean(v) &&
      typeof v === 'object' &&
      (ORIGENS_VARIAVEL as readonly string[]).includes((v as VariavelDaLista).origem) &&
      typeof (v as VariavelDaLista).valor === 'string',
  );
  return validas.length === json.length ? validas : null;
}

/** O valor de uma variável para o contato (texto, em SQL), na tabela `contato` com ou sem o apelido `c`. */
export function valorDaVariavel(v: VariavelDaLista, apelido: 'c' | 'contato', hoje: SQL): SQL {
  const t = sql.raw(apelido);
  switch (v.origem) {
    case 'fixo':
      return sql`${v.valor}::text`;
    case 'nome':
      return sql`coalesce(nullif(btrim(${t}.nome), ''), ${v.valor}::text)`;
    case 'primeiro_nome':
      return sql`coalesce(nullif(split_part(btrim(${t}.nome), ' ', 1), ''), ${v.valor}::text)`;
    case 'cashback_saldo':
      return reaisEmSql(sql`${t}.cashback_centavos`);
    case 'cashback_validade':
      return sql`coalesce(${dataCurtaEmSql(sql`${t}.cashback_vence_em`, hoje)}, ${v.valor}::text)`;
  }
}

/** Todas as variáveis, na ordem, como o `jsonb` que o destinatário guarda. */
export function variaveisEmSql(lista: readonly VariavelDaLista[], apelido: 'c' | 'contato', hoje: SQL): SQL {
  if (!lista.length) return sql`'[]'::jsonb`;
  return sql`jsonb_build_array(${sql.join(
    lista.map((v) => valorDaVariavel(v, apelido, hoje)),
    sql`, `,
  )})`;
}
