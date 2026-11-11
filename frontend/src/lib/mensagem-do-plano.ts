/**
 * A mensagem como sai, para quem aprova um disparo (Hub DMS, F5 parte B): o corpo do modelo com o valor das variáveis
 * FIXAS no lugar (o cupom, o "10%" que o rascunho grava) e as de cada pessoa como marcador ("{nome}"). É o que a
 * aprovação prende: trocar um valor fixo muda o plano e encerra o pedido.
 */

const MARCADOR: Record<string, string> = {
  nome: '{nome}',
  primeiro_nome: '{primeiro nome}',
  cashback_saldo: '{saldo de cashback}',
  cashback_validade: '{validade do cashback}',
};

/** O corpo com as variáveis resolvidas: fixa pelo valor, de cada pessoa pelo marcador, sem origem conhecida como está. */
export function mensagemDoPlano(corpo: string, variaveis: ReadonlyArray<{ origem: string; valor: string | null }> | null): string {
  return corpo.replace(/\{\{\s*(\d+)\s*\}\}/g, (inteiro, n: string) => {
    const v = variaveis?.[Number(n) - 1];
    if (!v) return inteiro;
    if (v.origem === 'fixo') return v.valor ?? inteiro;
    return MARCADOR[v.origem] ?? inteiro;
  });
}

/** O código curto do plano para a pessoa conferir ("7F3A-21C9"): os 8 primeiros do resumo. */
export function codigoDoPlano(resumo: string): string {
  const r = resumo.slice(0, 8).toUpperCase();
  return `${r.slice(0, 4)}-${r.slice(4)}`;
}

/**
 * Reais digitados ("150", "150,50", "1.500,00", "150.50") em centavos; nulo = não é um valor. Com vírgula, o ponto é
 * de milhar; sem vírgula, um ponto seguido de 1 ou 2 dígitos no fim é o dos centavos.
 */
export function centavosDoTexto(texto: string): number | null {
  const bruto = texto.trim().replace(/^R\$\s*/i, '');
  const limpo = bruto.includes(',')
    ? bruto.replace(/\./g, '').replace(',', '.')
    : /^\d+\.\d{1,2}$/.test(bruto)
      ? bruto
      : bruto.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(limpo)) return null;
  return Math.round(Number(limpo) * 100);
}
