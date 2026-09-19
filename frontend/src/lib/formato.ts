/** Formatação pt-BR. Tudo que o usuário lê passa por aqui. */

const numero = new Intl.NumberFormat('pt-BR');

/** 102050 → "R$ 1.020,50". */
export function formatarReais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Dias inteiros desde a data (0 = hoje). */
export function diasDesde(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : null;
}

export function formatarNumero(valor: number): string {
  return numero.format(valor);
}

export function formatarData(iso?: string | null): string {
  if (!iso) return '—';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatarDataHora(iso?: string | null): string {
  if (!iso) return '—';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Percentual de uso, travado em 0–100 para a barra nunca estourar o trilho. */
export function percentual(usado: number, teto: number): number {
  if (!Number.isFinite(teto) || teto <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((usado / teto) * 100)));
}
