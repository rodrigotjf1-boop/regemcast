/**
 * Leitura dos avisos de sincronização da coexistência — sem banco.
 *
 * O formato, conferido na página oficial de onboarding de usuários do
 * WhatsApp Business app (24/09/2026), põe o que importa DENTRO de cada item de
 * `value.history[]`, e não em `value`:
 *
 *     value.history[] = {
 *       metadata: { phase: 0 | 1 | 2, chunk_order, progress },   // progress 100 = terminou
 *       threads: [...],
 *     }
 *     value.history[] = { errors: [{ code: 2593109, ... }] }     // o lojista não compartilhou
 *
 * Ler `value.progress` e `value.errors` — como o código fazia — nunca achava
 * nada: a cópia jamais aparecia como concluída, e o job de prazo marcava como
 * "expirado" quem tinha terminado, mandando conectar de novo sem motivo.
 *
 * Os campos no nível de `value` continuam aceitos: não custam nada e cobrem uma
 * mudança de formato da Meta.
 */

/** Código da Meta para "o lojista não compartilhou o histórico". */
export const HISTORICO_RECUSADO = 2593109;

function itensDoHistorico(value: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(value.history) ? (value.history as Array<Record<string, unknown>>) : [];
}

function numero(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * O maior progresso informado no aviso (0 a 100), ou `null` se não veio.
 *
 * Os lotes podem chegar fora de ordem (a Meta avisa: use `chunk_order` para
 * ordenar), então vale o maior valor visto, não o do último item.
 */
export function progressoDaSincronizacao(value: Record<string, unknown>): number | null {
  const valores = [
    numero(value.progress),
    ...itensDoHistorico(value).map((h) => numero((h.metadata as Record<string, unknown> | undefined)?.progress)),
  ].filter((n): n is number => n !== null);
  return valores.length ? Math.max(...valores) : null;
}

/** A sincronização terminou: progresso 100, ou o aviso de conclusão por status. */
export function sincronizacaoConcluida(value: Record<string, unknown>): boolean {
  if (value.sync_status === 'COMPLETED' || value.status === 'COMPLETED') return true;
  const progresso = progressoDaSincronizacao(value);
  return progresso !== null && progresso >= 100;
}

/** O lojista não compartilhou o histórico (código 2593109), onde quer que venha. */
export function historicoRecusado(value: Record<string, unknown>): boolean {
  const erros = [
    ...(Array.isArray(value.errors) ? value.errors : []),
    ...itensDoHistorico(value).flatMap((h) => (Array.isArray(h.errors) ? h.errors : [])),
  ] as Array<Record<string, unknown>>;
  return erros.some((e) => Number(e?.code) === HISTORICO_RECUSADO);
}
