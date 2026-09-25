/**
 * Limite de envio da Meta: quantas pessoas DIFERENTES a empresa pode alcançar
 * com modelo, fora de conversa aberta, numa janela MÓVEL de 24 horas.
 *
 * Desde 07/10/2025 o limite é do PORTFÓLIO — todos os números do portfólio
 * dividem o mesmo teto — e os degraus são 250 → 2.000 → 10.000 → 100.000 →
 * sem teto. O degrau de 1.000 deixou de existir. Conferido em 25/09/2026:
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits/
 *
 * A Meta informa o limite de três jeitos, e a documentação se contradiz sobre
 * qual vem onde:
 *
 * - nome do degrau (`TIER_250`, `TIER_2K`, `TIER_10K`, `TIER_100K`,
 *   `TIER_UNLIMITED`): o campo `whatsapp_business_manager_messaging_limit` do
 *   número e, segundo a referência, `max_daily_conversations_per_business` do
 *   aviso `business_capability_update`;
 * - número inteiro (`2000`): o EXEMPLO do mesmo aviso;
 * - `-1` para sem teto: o campo antigo `max_daily_conversation_per_phone`.
 *
 * `limiteInformado` aceita os três. Valor que não reconhece devolve
 * `undefined` — "não sabemos" —, que não grava nem libera nada. Sem teto é
 * `limite: null`, com nome `TIER_UNLIMITED`: é o nome que diferencia "sem teto"
 * de "nunca lido" (os dois guardam `null` no número).
 */

export interface LimiteDaMeta {
  /** Pessoas diferentes por 24 h; `null` = sem teto. */
  limite: number | null;
  /** Nome canônico do degrau, como a Meta chama (`TIER_2K`…). */
  nome: string;
}

export const SEM_TETO = 'TIER_UNLIMITED';

/** Os degraus conhecidos. `TIER_50` e `TIER_1K` só aparecem em registro antigo. */
const DEGRAUS: Record<string, number | null> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1_000,
  TIER_2K: 2_000,
  TIER_10K: 10_000,
  TIER_100K: 100_000,
  [SEM_TETO]: null,
};

function nomeDoDegrau(pessoas: number): string {
  for (const [nome, valor] of Object.entries(DEGRAUS)) {
    if (valor === pessoas) return nome;
  }
  return pessoas % 1_000 === 0 ? `TIER_${pessoas / 1_000}K` : `TIER_${pessoas}`;
}

export function limiteInformado(bruto: unknown): LimiteDaMeta | undefined {
  if (typeof bruto === 'string') {
    const texto = bruto.trim().toUpperCase();
    if (Object.prototype.hasOwnProperty.call(DEGRAUS, texto)) {
      return { limite: DEGRAUS[texto] ?? null, nome: texto };
    }
    return /^-?\d+$/.test(texto) ? limiteInformado(Number(texto)) : undefined;
  }
  if (typeof bruto === 'number' && Number.isInteger(bruto)) {
    if (bruto === -1) return { limite: null, nome: SEM_TETO };
    if (bruto > 0) return { limite: bruto, nome: nomeDoDegrau(bruto) };
  }
  return undefined;
}
