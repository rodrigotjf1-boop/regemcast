import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Tom = 'neutro' | 'acento' | 'sucesso' | 'atencao' | 'erro';

const TONS: Record<Tom, string> = {
  neutro: 'bg-superficie-2 text-tinta-suave border-borda',
  acento: 'bg-acento-suave text-acento-forte border-acento/25',
  sucesso: 'bg-sucesso/10 text-sucesso border-sucesso/25',
  atencao: 'bg-atencao/10 text-atencao border-atencao/25',
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
