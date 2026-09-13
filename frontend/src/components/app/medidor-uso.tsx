'use client';

import { cn } from '@/lib/cn';
import { formatarNumero, percentual } from '@/lib/formato';

/**
 * Consumo do ciclo. O número é o dado; a barra é só apoio visual — por isso
 * ela é `aria-hidden` e o valor acessível vai no `role="meter"` do conjunto.
 */
export function MedidorUso({ usado, teto }: { usado: number; teto: number }) {
  const pct = percentual(usado, teto);
  const tom =
    pct >= 100 ? 'bg-erro' : pct >= 80 ? 'bg-atencao' : 'bg-acento';

  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={teto}
      aria-valuenow={usado}
      aria-valuetext={formatarNumero(usado) + ' de ' + formatarNumero(teto) + ' disparos usados'}
      aria-label="Disparos usados no ciclo"
      className="space-y-2"
    >
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="numerico text-2xl font-semibold text-tinta">{formatarNumero(usado)}</span>
        <span className="text-sm text-tinta-suave">
          de <span className="numerico">{formatarNumero(teto)}</span> disparos
        </span>
      </p>
      <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-superficie-2">
        <div className={cn('h-full rounded-full transition-[width]', tom)} style={{ width: pct + '%' }} />
      </div>
      <p className="text-xs text-tinta-suave">
        {teto > 0 ? pct + '% do teto do seu plano neste ciclo.' : 'Seu plano ainda não tem teto definido.'}
      </p>
    </div>
  );
}
