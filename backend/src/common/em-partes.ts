/**
 * Quebra uma lista em partes para comandos em lote.
 *
 * O Postgres aceita no máximo 65.535 parâmetros por comando: um `insert` de
 * 10 colunas estoura por volta de 6.500 linhas. Partes de algumas centenas
 * ficam longe do teto e continuam sendo UM comando por parte — nunca um por
 * linha.
 */
export function emPartes<T>(lista: T[], tamanho = 500): T[][] {
  const partes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) partes.push(lista.slice(i, i + tamanho));
  return partes;
}
