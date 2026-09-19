/**
 * Colunas que a planilha PODE trazer além de nome e telefone: e-mail,
 * aniversário e o histórico de compra (pedidos, total gasto, última compra ou
 * dias inativo).
 *
 * Cada sistema de cardápio exporta com um título diferente ("Total gasto",
 * "Valor total", "Qtd. pedidos", "Última compra", "Dias sem comprar"…). A
 * detecção é pelo título, sem acento e sem caixa, e cada coluna vira no máximo
 * um campo. Valor que não dá para ler vira vazio — nunca um número inventado.
 */
import type { Linha } from './tabela';

export interface ColunasExtras {
  email: number;
  nascimento: number;
  pedidos: number;
  total: number;
  ultimoPedido: number;
  diasInativo: number;
}

export interface Extras {
  email?: string;
  /** `AAAA-MM-DD` */
  dataNascimento?: string;
  pedidos?: number;
  totalGastoCentavos?: number;
  /** ISO 8601 */
  ultimoPedidoEm?: string;
}

const NENHUMA: ColunasExtras = { email: -1, nascimento: -1, pedidos: -1, total: -1, ultimoPedido: -1, diasInativo: -1 };

function chave(texto: string): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/** Qual campo este título representa (ou nenhum). A ordem das perguntas importa. */
export function campoDoTitulo(titulo: string): keyof ColunasExtras | null {
  const t = chave(titulo);
  if (!t) return null;
  if (/e-?\s?mail/.test(t)) return 'email';
  if (/nascimento|aniversario|birth/.test(t)) return 'nascimento';
  // Médias não são nenhum dos campos: "Ticket médio" não é total gasto, e
  // "Média de dias entre pedidos" não é dias inativo.
  if (/ticket|medio|media|entre/.test(t)) return null;
  // "Dias sem comprar", "Inativo há", "Recência" — antes de "último", porque
  // "dias desde o último pedido" é dias, não data.
  if (/\bdias?\b|inativ|recencia/.test(t)) return 'diasInativo';
  if (/ultim/.test(t)) return 'ultimoPedido';
  if (/valor|gasto|faturamento|ltv|receita/.test(t) || (/total/.test(t) && !/pedido|compra/.test(t))) return 'total';
  if (/pedido|compras|qtd|quantidade|frequencia/.test(t)) return 'pedidos';
  return null;
}

/** Acha as colunas extras pelo cabeçalho, sem reusar as de telefone e nome. */
export function detectarExtras(cabecalho: Linha | null, ocupadas: number[]): ColunasExtras {
  if (!cabecalho) return NENHUMA;
  const r: ColunasExtras = { ...NENHUMA };
  cabecalho.forEach((titulo, i) => {
    if (ocupadas.includes(i)) return;
    const campo = campoDoTitulo(titulo);
    if (campo && r[campo] < 0) r[campo] = i;
  });
  return r;
}

/** "R$ 1.234,56", "1234.56", "1.234" → centavos. */
export function lerDinheiro(bruto: string): number | undefined {
  let s = (bruto ?? '').replace(/[^\d,.-]/g, '');
  if (!s || s === '-') return undefined;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, '');
  else if (/^\d{1,3}\.\d{3}$/.test(s)) s = s.replace('.', ''); // "1.234" = mil e pouco
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100);
}

export function lerInteiro(bruto: string): number | undefined {
  const s = (bruto ?? '').replace(/[^\d,.-]/g, '').replace(',', '.');
  if (!s) return undefined;
  const n = Math.round(Number(s));
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? n : undefined;
}

/**
 * Data de planilha → `AAAA-MM-DD`. Aceita DD/MM/AAAA (o jeito brasileiro),
 * AAAA-MM-DD (ISO, também o que o Excel devolve para célula de data) e o
 * número de série do Excel.
 */
export function lerData(bruto: string): string | undefined {
  const s = (bruto ?? '').trim();
  if (!s || s === '-') return undefined;
  let a: number, m: number, d: number;
  let r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (r) {
    d = Number(r[1]);
    m = Number(r[2]);
    a = Number(r[3]);
    if (a < 100) a += a > 30 ? 1900 : 2000;
  } else if ((r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) {
    a = Number(r[1]);
    m = Number(r[2]);
    d = Number(r[3]);
  } else if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    // Série do Excel: dias desde 30/12/1899.
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86_400_000);
    a = dt.getUTCFullYear();
    m = dt.getUTCMonth() + 1;
    d = dt.getUTCDate();
  } else return undefined;
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  if (a < 1900 || a > 2100) return undefined;
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Lê os extras de uma linha. `hoje` entra de fora para o teste ser estável. */
export function lerExtras(linha: Linha, c: ColunasExtras, hoje = new Date()): Extras {
  const cel = (i: number) => (i >= 0 ? (linha[i] ?? '').trim() : '');
  const x: Extras = {};

  const email = cel(c.email).toLowerCase();
  if (email && EMAIL.test(email) && email.length <= 180) x.email = email;

  const nasc = lerData(cel(c.nascimento));
  if (nasc && nasc <= hoje.toISOString().slice(0, 10)) x.dataNascimento = nasc;

  const pedidos = lerInteiro(cel(c.pedidos));
  if (pedidos !== undefined) x.pedidos = pedidos;

  const total = lerDinheiro(cel(c.total));
  if (total !== undefined) x.totalGastoCentavos = total;

  const ultimo = lerData(cel(c.ultimoPedido));
  if (ultimo) x.ultimoPedidoEm = `${ultimo}T12:00:00.000Z`;
  else {
    const dias = lerInteiro(cel(c.diasInativo));
    if (dias !== undefined) {
      const dt = new Date(hoje.getTime() - dias * 86_400_000);
      x.ultimoPedidoEm = `${dt.toISOString().slice(0, 10)}T12:00:00.000Z`;
    }
  }
  return x;
}

/** Os rótulos das colunas extras encontradas, para a prévia dizer o que vem junto. */
export function rotulosExtras(c: ColunasExtras): string[] {
  const r: string[] = [];
  if (c.email >= 0) r.push('e-mail');
  if (c.nascimento >= 0) r.push('aniversário');
  if (c.pedidos >= 0) r.push('pedidos');
  if (c.total >= 0) r.push('total gasto');
  if (c.ultimoPedido >= 0 || c.diasInativo >= 0) r.push('última compra');
  return r;
}
