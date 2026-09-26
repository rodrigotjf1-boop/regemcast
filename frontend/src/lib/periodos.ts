import type { Periodo } from './tipos';

/**
 * Os períodos do dia como a tela fala deles. A regra (onde cada um começa e
 * acaba, no fuso da conta) mora no servidor, em `contato/habitos.ts`.
 */

/** "costuma pedir à noite" */
export const QUANDO_PEDE: Record<Periodo, string> = {
  cafe: 'no café da manhã',
  almoco: 'no almoço',
  tarde: 'à tarde',
  noite: 'à noite',
  madrugada: 'de madrugada',
};

/** "noite 35%" */
export const NOME_DO_PERIODO: Record<Periodo, string> = {
  cafe: 'café da manhã',
  almoco: 'almoço',
  tarde: 'tarde',
  noite: 'noite',
  madrugada: 'madrugada',
};

/** '17:00' → '17h'; '10:30' → '10h30'. */
export function horaCurta(hhmm: string): string {
  const [h, m] = hhmm.split(':');
  return `${Number(h)}h${m && m !== '00' ? m : ''}`;
}
