/**
 * O destino depois de entrar (`/entrar?de=…`): só caminho interno.
 *
 * Começar com uma barra não basta. `//outro.site`, `/\outro.site` e
 * `/<tab>/outro.site` saem do site — o navegador lê a barra invertida como
 * barra e descarta tab e quebra de linha —, e a página de autorização por
 * clique depende deste retorno para voltar com o pedido. A conferência monta o
 * endereço sobre uma origem de referência e exige que a origem continue a
 * mesma (LIC-119). Devolve o texto CONFERIDO, nunca o caminho remontado:
 * remontar `/.//outro.site` dá `//outro.site`, que sai do site.
 */
const ORIGEM_DE_REFERENCIA = 'https://regemcast.invalido';

export function destinoSeguro(bruto: string | null, padrao = '/painel'): string {
  if (!bruto || !bruto.startsWith('/') || bruto.startsWith('//')) return padrao;
  if (bruto.includes('\\') || /[\u0000-\u001f\u007f]/.test(bruto)) return padrao;
  try {
    return new URL(bruto, ORIGEM_DE_REFERENCIA).origin === ORIGEM_DE_REFERENCIA ? bruto : padrao;
  } catch {
    return padrao;
  }
}

/** O caminho que entra no login é o da autorização por clique? (O login avisa que a pessoa volta para lá.) */
export function voltaParaAutorizacao(destino: string): boolean {
  return destino === '/integracoes/autorizar' || destino.startsWith('/integracoes/autorizar?');
}
