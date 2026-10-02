/**
 * O nome de um aplicativo conectado, para a tela.
 *
 * A campanha e o rascunho de modelo montados por outro produto (pela porta de
 * integração) guardam o identificador dele em minúsculas — `liame`,
 * `agencia-x`. A tela mostra com a inicial maiúscula e os hífens como espaço:
 * "Liame", "Agencia X".
 */
export function nomeDoAplicativo(produto: string | null | undefined): string | null {
  const limpo = (produto ?? '').trim();
  if (!limpo) return null;
  return limpo
    .split(/[-_]+/)
    .filter(Boolean)
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(' ');
}
