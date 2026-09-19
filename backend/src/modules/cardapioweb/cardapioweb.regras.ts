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
 */
import { paraCloudApi } from '../../common/telefone';

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
