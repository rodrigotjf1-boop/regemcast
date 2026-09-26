'use client';

import { cn } from '@/lib/cn';
import { formatarNumero } from '@/lib/formato';

/** Um público em forma de ficha (bairro, mês, produto): o nome e quantos há. Clicar escolhe. */
export function Ficha({
  ativa,
  onClick,
  rotulo,
  total,
  destaque = false,
}: {
  ativa: boolean;
  onClick: () => void;
  rotulo: string;
  total: number;
  destaque?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativa}
      onClick={onClick}
      className={cn(
        'inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento',
        ativa
          ? 'border-acento bg-acento/10 text-tinta ring-2 ring-acento'
          : destaque
            ? 'border-acento/60 bg-superficie text-tinta hover:border-acento'
            : 'border-borda bg-superficie text-tinta hover:border-acento',
      )}
    >
      <span className="min-w-0 break-words font-semibold first-letter:uppercase">{rotulo}</span>
      <span className="numerico shrink-0 text-tinta-suave">{formatarNumero(total)}</span>
    </button>
  );
}
