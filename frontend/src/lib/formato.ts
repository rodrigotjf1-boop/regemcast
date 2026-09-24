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

/** "5521989751705" → "(21) 98975-1705". Número de fora sai como "+1 6505551234". */
export function formatarTelefone(e164?: string | null): string {
  const d = (e164 ?? '').replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const numero = d.slice(4);
    return `(${ddd}) ${numero.slice(0, numero.length - 4)}-${numero.slice(-4)}`;
  }
  return d ? `+${d}` : '—';
}

/** "14:32". */
export function formatarHora(iso?: string | null): string {
  if (!iso) return '';
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? '' : data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function mesmoDia(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Separador de dia na conversa: "Hoje", "Ontem", "segunda-feira" (até 6 dias) ou "12/03/2026". */
export function rotuloDoDia(iso: string): string {
  const data = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (mesmoDia(data, hoje)) return 'Hoje';
  if (mesmoDia(data, ontem)) return 'Ontem';
  if (hoje.getTime() - data.getTime() < 6 * 86_400_000) {
    return data.toLocaleDateString('pt-BR', { weekday: 'long' });
  }
  return formatarData(iso);
}

/** Na lista de conversas: a hora se foi hoje; senão "Ontem", o dia da semana ou a data curta. */
export function quandoNaLista(iso?: string | null): string {
  if (!iso) return '';
  const rotulo = rotuloDoDia(iso);
  if (rotulo === 'Hoje') return formatarHora(iso);
  if (rotulo.includes('/')) {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }
  return rotulo;
}
