import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Estado vazio de verdade: diz o que aquilo vai mostrar, por que está vazio e
 * qual é o próximo passo. Tela vazia sem explicação é bug de produto.
 */
export function EmptyState({
  titulo,
  descricao,
  acao,
  icone,
  className,
}: {
  titulo: string;
  descricao: ReactNode;
  acao?: ReactNode;
  icone?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-card border border-dashed border-borda',
        'bg-superficie-2/50 px-4 py-10 text-center',
        className,
      )}
    >
      {icone ? <div aria-hidden="true" className="text-acento-forte">{icone}</div> : null}
      <h3 className="text-sm font-semibold text-tinta">{titulo}</h3>
      <p className="max-w-prose text-sm text-tinta-suave">{descricao}</p>
      {acao ? <div className="pt-1">{acao}</div> : null}
    </div>
  );
}
