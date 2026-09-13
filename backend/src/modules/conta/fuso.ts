/**
 * Validação de fuso horário IANA.
 *
 * O fuso da conta rege toda janela de envio e todo teto de período. Um valor
 * inválido não estoura na hora de salvar — estoura meses depois, no worker,
 * quando `at time zone 'Marte/Olimpo'` derruba o job de disparo. Por isso a
 * validação acontece no portão de entrada, e não na hora de usar.
 */

/** `Intl.supportedValuesOf` existe no Node 18+, mas o tipo depende da lib do TS. */
interface IntlComSuportados {
  supportedValuesOf?: (chave: 'timeZone') => string[];
}

let cache: Set<string> | null = null;

/** A lista é grande (600+ nomes) e imutável no processo: vale memorizar. */
function conhecidos(): Set<string> | null {
  if (cache) return cache;
  const api = Intl as unknown as IntlComSuportados;
  if (typeof api.supportedValuesOf !== 'function') return null;
  cache = new Set(api.supportedValuesOf('timeZone'));
  return cache;
}

/**
 * Aceita apenas nome canônico IANA (`America/Sao_Paulo`, `UTC`). Apelidos
 * antigos (`Brazil/East`) ficam de fora de propósito: o mesmo fuso escrito de
 * duas formas vira dois comportamentos na hora de comparar.
 */
export function fusoValido(valor: string): boolean {
  const lista = conhecidos();
  if (lista) return lista.has(valor);
  // Runtime sem supportedValuesOf: o construtor recusa fuso desconhecido.
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: valor });
    return true;
  } catch {
    return false;
  }
}
