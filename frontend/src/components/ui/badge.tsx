import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Tom = 'neutro' | 'acento' | 'sucesso' | 'atencao' | 'erro';

const TONS: Record<Tom, string> = {
  neutro: 'bg-superficie-2 text-tinta-suave border-borda',
  acento: 'bg-acento-suave text-acento-forte border-acento/40',
  sucesso: 'bg-sucesso/10 text-sucesso border-sucesso/25',
  // Preenchimento no amarelo do kit, texto em ameixa (11,8:1). Antes era o
  // âmbar escuro a 10% — legível, mas apagado e sem relação com a marca.
  atencao: 'bg-realce/60 text-tinta border-realce',
  erro: 'bg-erro/10 text-erro border-erro/25',
};

/** Cor do ponto: o estado lido de relance, antes do texto. */
const PONTOS: Record<Tom, string> = {
  neutro: 'bg-tinta-suave',
  acento: 'bg-acento',
  sucesso: 'bg-sucesso',
  atencao: 'bg-atencao',
  erro: 'bg-erro',
};

export function Badge({
  children,
  tom = 'neutro',
  ponto = false,
  vivo = false,
  className,
}: {
  children: ReactNode;
  tom?: Tom;
  /** Mostra um ponto colorido antes do texto. */
  ponto?: boolean;
  /** O ponto pulsa: o estado está mudando agora (enviando, sincronizando). */
  vivo?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium',
        TONS[tom],
        className,
      )}
    >
      {ponto || vivo ? (
        <span
          aria-hidden="true"
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', PONTOS[tom], vivo && 'ponto-vivo')}
        />
      ) : null}
      {children}
    </span>
  );
}
