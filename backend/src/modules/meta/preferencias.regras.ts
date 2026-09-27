/**
 * A pessoa escolheu, no próprio WhatsApp, parar ou voltar a receber marketing
 * da empresa. Regras puras, sem banco.
 *
 * Conferido na documentação oficial em 26/09/2026:
 * - aviso `user_preferences` (webhooks/reference/user_preferences):
 *   `value.user_preferences[]` com `wa_id`, `category` (hoje só
 *   `marketing_messages`), `value` (`stop` | `resume`), `detail` e `timestamp`;
 *   não dispara para "Interessado/Não interessado" das ofertas;
 * - erro `131050` (support/error-codes): "a pessoa escolheu não receber mais
 *   mensagens de marketing da sua empresa" — só no aviso de entrega, nunca no
 *   envio; a Meta manda não reenviar e assinar o `user_preferences`.
 */

/** A origem do bloqueio quando vem da preferência do WhatsApp (ou do 131050). */
export const ORIGEM_PREFERENCIA = 'preferencia_whatsapp';

/** "Parou o marketing" chegando como falha no aviso de entrega. */
export const ERRO_MARKETING_PARADO = 131050;

export interface PreferenciaDeMarketing {
  /** Só dígitos, como a Meta manda (`wa_id`). */
  telefone: string;
  acao: 'parar' | 'voltar';
}

/**
 * As preferências de marketing do aviso, na ordem em que a pessoa as tomou
 * (pelo `timestamp`; sem ele, a ordem da Meta): parar e voltar no mesmo
 * aviso termina em "voltou". Categoria, ação ou telefone que não reconhecemos
 * ficam de fora — nunca viram bloqueio nem liberação.
 */
export function preferenciasDoAviso(value: Record<string, unknown>): PreferenciaDeMarketing[] {
  const itens = Array.isArray(value.user_preferences) ? (value.user_preferences as unknown[]) : [];
  const lidas: (PreferenciaDeMarketing & { quando: number; ordem: number })[] = [];
  itens.forEach((bruto, ordem) => {
    if (!bruto || typeof bruto !== 'object') return;
    const i = bruto as Record<string, unknown>;
    if (i.category !== 'marketing_messages') return;
    const telefone = typeof i.wa_id === 'string' ? i.wa_id.replace(/\D/g, '') : '';
    if (!telefone) return;
    const acao = i.value === 'stop' ? 'parar' : i.value === 'resume' ? 'voltar' : null;
    if (!acao) return;
    const quando = typeof i.timestamp === 'number' ? i.timestamp : Number(i.timestamp);
    lidas.push({ telefone, acao, quando: Number.isFinite(quando) ? quando : Number.MAX_SAFE_INTEGER, ordem });
  });
  return lidas
    .sort((a, b) => a.quando - b.quando || a.ordem - b.ordem)
    .map(({ telefone, acao }) => ({ telefone, acao }));
}
