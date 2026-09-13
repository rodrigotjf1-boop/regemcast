/**
 * CNPJ: normalização e dígitos verificadores.
 *
 * Desde julho de 2026 o CNPJ é alfanumérico: as 12 primeiras posições aceitam
 * letras, e o DV passa a usar o valor ASCII menos 48 de cada caractere. Para um
 * CNPJ só de números a conta dá exatamente o mesmo resultado da regra antiga,
 * então uma única função atende os dois formatos — e a base não rejeita empresa
 * aberta este ano.
 */

const PESOS_DV1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_DV2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * Tira máscara e espaços e devolve o CNPJ em caixa alta.
 * String vazia vira `null` — é assim que o dono limpa o campo.
 */
export function normalizarCnpj(bruto: string): string | null {
  const limpo = bruto.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return limpo.length === 0 ? null : limpo;
}

function digito(base: string, pesos: number[]): number {
  let soma = 0;
  for (let i = 0; i < base.length; i += 1) {
    soma += (base.charCodeAt(i) - 48) * pesos[i];
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Espera o valor já normalizado por `normalizarCnpj`. */
export function cnpjValido(valor: string): boolean {
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(valor)) return false;
  // 00000000000000 e afins passam no DV e não existem na Receita.
  if (/^(.)\1{13}$/.test(valor)) return false;

  const base = valor.slice(0, 12);
  const dv1 = digito(base, PESOS_DV1);
  const dv2 = digito(base + String(dv1), PESOS_DV2);
  return valor.slice(12) === `${dv1}${dv2}`;
}
