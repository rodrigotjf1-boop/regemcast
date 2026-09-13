import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Tom = 'erro' | 'sucesso' | 'informacao';

const TONS: Record<Tom, string> = {
  erro: 'border-erro/30 bg-erro/10 text-erro',
  sucesso: 'border-sucesso/30 bg-sucesso/10 text-sucesso',
  informacao: 'border-acento/25 bg-acento-suave text-acento-forte',
};

/**
 * Mensagem de resultado de uma ação. Sempre em região viva: quem usa leitor de
 * tela precisa ouvir o erro de login sem ter que caçar o texto na página.
 */
export function Alerta({
  children,
  tom = 'erro',
  className,
}: {
  children: ReactNode;
  tom?: Tom;
  className?: string;
}) {
  return (
    <p
      role={tom === 'erro' ? 'alert' : 'status'}
      className={cn('rounded-lg border px-3 py-2 text-sm', TONS[tom], className)}
    >
      {children}
    </p>
  );
}
