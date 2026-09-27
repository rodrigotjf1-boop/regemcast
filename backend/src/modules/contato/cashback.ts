/**
 * O cashback do Cardápio Web no contato (migration 034) — uma definição só.
 *
 * O saldo VALE quando é positivo e não venceu. O dia do vencimento ainda vale
 * inteiro, no fuso da conta: "vence em 30/09" quer dizer que dá para usar no
 * dia 30. Os públicos, a coluna de Contatos, a prévia, a montagem da campanha
 * e a conferência na hora do envio usam estas mesmas funções — o número de uma
 * tela é o da outra.
 *
 * O formato das variáveis ("R$ 1.234,50", "30/09") é montado em SQL, porque a
 * campanha é montada no banco (dezenas de milhares de contatos numa consulta),
 * e sem `to_char` de número: ele usa o idioma do servidor, que não é o nosso.
 */
import { sql, type SQL } from 'drizzle-orm';

/** "Cashback vence em até 7 dias": de hoje até hoje + 7. */
export const DIAS_CASHBACK_VENCENDO = 7;

/** A tabela `contato` sem apelido (públicos) ou com o apelido `c`. */
type Apelido = 'contato' | 'c';

/** "Hoje" no fuso da conta: subconsulta sem correlação, calculada uma vez por comando. */
export function hojeDaConta(contaId: string): SQL {
  return sql`((now() at time zone (select timezone from conta where id = ${contaId}))::date)`;
}

/** "Hoje" num fuso já conhecido (o worker leu o da conta junto com a campanha). */
export function hojeNoFuso(fuso: string): SQL {
  return sql`((now() at time zone ${fuso})::date)`;
}

/** Tem cashback que ainda vale hoje. */
export function cashbackValido(apelido: Apelido, hoje: SQL): SQL {
  const t = sql.raw(apelido);
  return sql`(${t}.cashback_centavos > 0 and (${t}.cashback_vence_em is null or ${t}.cashback_vence_em >= ${hoje}))`;
}

/** O cashback vence de hoje até daqui a 7 dias (o dia do vencimento conta). */
export function cashbackVencendo(apelido: Apelido, hoje: SQL): SQL {
  const t = sql.raw(apelido);
  return sql`(${t}.cashback_centavos > 0 and ${t}.cashback_vence_em >= ${hoje}
              and ${t}.cashback_vence_em <= ${hoje} + ${sql.raw(String(DIAS_CASHBACK_VENCENDO))})`;
}

/** "R$ 1.234,50", de centavos inteiros. */
export function reaisEmSql(centavos: SQL): SQL {
  return sql`('R$ ' || regexp_replace((${centavos} / 100)::text, '(\\d)(?=(\\d{3})+$)', '\\1.', 'g')
              || ',' || lpad((${centavos} % 100)::text, 2, '0'))`;
}

/** "30/09" — ou "30/09/2027", quando não é deste ano. */
export function dataCurtaEmSql(data: SQL, hoje: SQL): SQL {
  return sql`(case when extract(year from ${data}) = extract(year from ${hoje})
                   then to_char(${data}, 'DD/MM') else to_char(${data}, 'DD/MM/YYYY') end)`;
}
