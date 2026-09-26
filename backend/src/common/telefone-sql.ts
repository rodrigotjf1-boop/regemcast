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

/**
 * Os telefones dos contatos da conta que atendem a `condicao` (sobre o alias
 * `c`), cada um nas DUAS formas do celular: o número como está e o gêmeo (com
 * ou sem o 9º dígito), quando existe. Para usar como CTE MATERIALIZED e cruzar
 * por IGUALDADE (`x.telefone_e164 = m.telefone`).
 *
 * O jeito ingênuo — `c.telefone_e164 in (x.telefone_e164, gêmeo(x.telefone_e164))`
 * entre as duas tabelas — impede o índice: o plano varria TODOS os contatos uma
 * vez por linha do outro lado (2.585 destinatários × 2.600 contatos = 7 s; com
 * 13 mil de cada lado, passava dos 30 s do limite — ERR-018). Sem o
 * MATERIALIZED, o planejador achata a subconsulta e volta ao mesmo plano (com
 * a RLS, como na LIC-069). O resultado é o mesmo: o gêmeo é uma troca de mão
 * dupla (o gêmeo do gêmeo é o próprio número).
 */
export function formasDosContatos(contaId: string, condicao: SQL): SQL {
  return sql`(
    select distinct f.telefone
      from contato c
      cross join lateral (values (c.telefone_e164), (${gemeoEmSql(sql`c.telefone_e164`)})) as f(telefone)
     where c.conta_id = ${contaId}
       and ${condicao}
       and f.telefone is not null
  )`;
}
