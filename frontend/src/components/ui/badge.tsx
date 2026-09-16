import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Tom = 'neutro' | 'acento' | 'sucesso' | 'atencao' | 'erro';

const TONS: Record<Tom, string> = {
  neutro: 'bg-superficie-2 text-tinta-suave border-borda',
  acento: 'bg-acento-suave text-acento-forte border-acento/25',
  sucesso: 'bg-sucesso/10 text-sucesso border-sucesso/25',
  // Preenchimento no amarelo do kit, texto em ameixa (11,8:1). Antes era o
  // âmbar escuro a 10% — legível, mas apagado e sem relação com a marca.
  atencao: 'bg-realce/60 text-tinta border-realce',
  erro: 'bg-erro/10 text-erro border-erro/25',
};

export function Badge({
  children,
  tom = 'neutro',
  className,
}: {
  children: ReactNode;
  tom?: Tom;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        TONS[tom],
        className,
      )}
    >
      {children}
    </span>
  );
}
