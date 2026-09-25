/**
 * As regras de telefone que precisam rodar DENTRO de uma consulta.
 *
 * Espelho de `telefone.ts`: mudou lá, muda aqui (e nos testes que comparam os
 * dois contra o Postgres real).
 */
import { sql, type SQL } from 'drizzle-orm';

/**
 * O mesmo celular brasileiro na outra forma — a regra de `gemeoDoCelular`, em
 * SQL. Nulo para fixo, número de fora e celular novo que nunca existiu sem o 9.
 * Recebe a coluna (ou expressão) com o número no formato do `contato`.
 */
export function gemeoEmSql(coluna: SQL): SQL<string | null> {
  return sql<string | null>`(case
    when ${coluna} ~ '^55[0-9]{2}9[6-9][0-9]{7}$' then substr(${coluna}, 1, 4) || substr(${coluna}, 6)
    when ${coluna} ~ '^55[0-9]{2}[6-9][0-9]{7}$' then substr(${coluna}, 1, 4) || '9' || substr(${coluna}, 5)
  end)`;
}
