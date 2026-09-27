/**
 * Regras puras da importação do Cardápio Web — sem banco, sem rede, testáveis.
 *
 * O que decide se um cliente do Cardápio Web vira contato, e como:
 *
 * - `notifications_enabled = true`  → entra como contato, com o consentimento
 *   declarado pelo dono da conta e a evidência da origem.
 * - `notifications_enabled = false` → o cliente pediu para NÃO receber WhatsApp
 *   da loja. Entra já DESCADASTRADO: isso também impede que o mesmo número
 *   volte por uma importação de arquivo futura.
 * - telefone inválido, fixo 0800 (número mascarado de marketplace) ou ausente
 *   → fica de fora e é contado como inválido.
 *
 * E o saldo de cashback de cada cliente (Fase 4C): `saldoDoCliente` e
 * `saldosDaPagina`.
 */
import { gemeoDoCelular, paraCloudApi } from '../../common/telefone';

/** Cliente como `GET /api/partner/v1/merchant/customers` devolve. */
export interface ClienteCardapioWeb {
  id: number;
  name?: string | null;
  phone_number?: string | null;
  ddi?: string | null;
  email?: string | null;
  birth_date?: string | null;
  created_at?: string | null;
  notifications_enabled?: boolean | null;
  /**
   * "Saldo de cashback" (`type: number`, sem unidade na documentação, conferida
   * em 27/09/2026). Todo valor em dinheiro da API vem em reais com centavos —
   * `total: 103.8` é R$ 103,80 — e este é lido assim.
   */
  cashback_balance?: number | string | null;
  /** "Data de expiração do saldo de cashback" (`format: date`), ou nulo. */
  cashback_expires_at?: string | null;
}

export interface PaginaClientes {
  customers: ClienteCardapioWeb[];
  pagination: { current_page: number; total_pages: number; total_customers: number };
}

export type Decisao =
  | {
      tipo: 'contato';
      telefone: string;
      nome: string | null;
      desde: string | null;
      email: string | null;
      /** `AAAA-MM-DD` */
      dataNascimento: string | null;
    }
  | { tipo: 'bloqueado'; telefone: string; nome: string | null }
  | { tipo: 'invalido' };

/** Telefone do Cardápio Web → E.164 sem '+', ou '' quando não serve. */
export function telefoneDoCliente(c: Pick<ClienteCardapioWeb, 'phone_number' | 'ddi'>): string {
  const digitos = String(c.phone_number ?? '').replace(/\D/g, '');
  if (!digitos) return '';
  // 0800 é o número mascarado que marketplace (iFood) entrega: não é WhatsApp.
  if (digitos.startsWith('0800') || digitos.startsWith('800')) return '';
  const ddi = String(c.ddi ?? '').replace(/\D/g, '');
  // Com DDI conhecido, o número vai completo; sem ele, a normalização assume
  // Brasil — a mesma regra da importação de arquivo. "Já traz o DDI" exige
  // comprimento de número internacional: o DDD 55 (RS) começa igual ao DDI 55,
  // e "55 99999-9999" (11 dígitos) é um celular gaúcho, não um DDI.
  const jaTemDdi = ddi && digitos.startsWith(ddi) && digitos.length >= 12;
  const bruto = !ddi ? digitos : jaTemDdi ? `+${digitos}` : `+${ddi}${digitos}`;
  return paraCloudApi(bruto).e164;
}

export function decidir(c: ClienteCardapioWeb): Decisao {
  const telefone = telefoneDoCliente(c);
  if (!telefone) return { tipo: 'invalido' };
  const nome = (c.name ?? '').trim().slice(0, 120) || null;
  // Ausente conta como liberado: é o padrão do Cardápio Web (default true na doc).
  if (c.notifications_enabled === false) return { tipo: 'bloqueado', telefone, nome };
  const email = (c.email ?? '').trim().toLowerCase();
  const nasc = /^\d{4}-\d{2}-\d{2}$/.test(c.birth_date ?? '') ? c.birth_date! : null;
  return {
    tipo: 'contato',
    telefone,
    nome,
    desde: c.created_at ?? null,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 180 ? email : null,
    dataNascimento: nasc,
  };
}

/** O saldo de cashback de um cliente, como o contato guarda. */
export interface SaldoDeCashback {
  /** Centavos, nunca negativo. */
  centavos: number;
  /** `AAAA-MM-DD`; nulo quando não tem data (ou não tem saldo). */
  venceEm: string | null;
}

/** O maior saldo que o `integer` do banco guarda (R$ 20 milhões) — acima disso, é lixo. */
const MAIOR_SALDO_CENTAVOS = 2_000_000_000;

/** `AAAA-MM-DD` que existe no calendário (e não "2026-02-31" nem "0000-00-00"). */
function diaValido(texto: string | null | undefined): string | null {
  const dia = String(texto ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  const ano = Number(dia.slice(0, 4));
  if (ano < 2000 || ano > 2999) return null;
  const d = new Date(`${dia}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dia ? dia : null;
}

/**
 * O saldo de cashback do cliente, em centavos, e o dia em que vence.
 *
 * `null` = não dá para saber (campo ausente ou ilegível): quem chama não mexe
 * no que o contato já tem. Negativo vira zero. Sem saldo, a data não importa.
 */
export function saldoDoCliente(c: Pick<ClienteCardapioWeb, 'cashback_balance' | 'cashback_expires_at'>): SaldoDeCashback | null {
  const bruto = c.cashback_balance;
  if (bruto === undefined || bruto === null || (typeof bruto === 'string' && !bruto.trim())) return null;
  const reais = typeof bruto === 'string' ? Number(bruto.trim().replace(',', '.')) : Number(bruto);
  if (!Number.isFinite(reais)) return null;
  // `Math.round`: 103.8 * 100 dá 10379,999…; o saldo é 10380.
  const centavos = reais <= 0 ? 0 : Math.round(reais * 100);
  if (centavos > MAIOR_SALDO_CENTAVOS) return null;
  return { centavos, venceEm: centavos > 0 ? diaValido(c.cashback_expires_at) : null };
}

/** Vale o maior saldo; empatado, o que vence depois (sem data conta como o mais tarde). */
function maior(a: SaldoDeCashback, b: SaldoDeCashback): boolean {
  if (a.centavos !== b.centavos) return a.centavos > b.centavos;
  if (a.venceEm === b.venceEm) return false;
  if (a.venceEm === null) return true;
  if (b.venceEm === null) return false;
  return a.venceEm > b.venceEm;
}

/**
 * Os saldos de uma página, por telefone — nas DUAS formas do celular, porque
 * o contato pode estar na base com o 9 ou sem ele. O mesmo número em dois
 * cadastros da mesma página fica com o maior saldo.
 */
export function saldosDaPagina(clientes: ClienteCardapioWeb[]): Map<string, SaldoDeCashback> {
  const saldos = new Map<string, SaldoDeCashback>();
  for (const c of clientes) {
    const telefone = telefoneDoCliente(c);
    const saldo = saldoDoCliente(c);
    if (!telefone || !saldo) continue;
    for (const forma of [telefone, gemeoDoCelular(telefone)]) {
      if (!forma) continue;
      const atual = saldos.get(forma);
      if (!atual || maior(saldo, atual)) saldos.set(forma, saldo);
    }
  }
  return saldos;
}

/** Separa uma página em quem entra, quem entra bloqueado e quantos não servem. */
export function separarPagina(clientes: ClienteCardapioWeb[]): {
  contatos: Extract<Decisao, { tipo: 'contato' }>[];
  bloqueados: Extract<Decisao, { tipo: 'bloqueado' }>[];
  invalidos: number;
} {
  const contatos = new Map<string, Extract<Decisao, { tipo: 'contato' }>>();
  const bloqueados = new Map<string, Extract<Decisao, { tipo: 'bloqueado' }>>();
  let invalidos = 0;
  for (const c of clientes) {
    const d = decidir(c);
    if (d.tipo === 'invalido') invalidos++;
    // O mesmo número em dois cadastros: se um deles pediu para sair, vale a saída.
    else if (d.tipo === 'bloqueado') {
      bloqueados.set(d.telefone, d);
      contatos.delete(d.telefone);
    } else if (!bloqueados.has(d.telefone)) contatos.set(d.telefone, d);
  }
  return { contatos: [...contatos.values()], bloqueados: [...bloqueados.values()], invalidos };
}
