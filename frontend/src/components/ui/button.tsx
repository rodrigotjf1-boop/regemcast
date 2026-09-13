'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';
import { Spinner } from './spinner';

type Variante = 'primario' | 'secundario' | 'discreto' | 'perigo';
type Tamanho = 'md' | 'sm';

const VARIANTES: Record<Variante, string> = {
  primario: 'bg-acento text-acento-contraste hover:bg-acento-forte',
  secundario: 'bg-superficie text-tinta border border-borda hover:bg-superficie-2',
  discreto: 'bg-transparent text-tinta-suave hover:bg-superficie-2 hover:text-tinta',
  perigo: 'bg-transparent text-erro border border-erro/40 hover:bg-erro/10',
};

const TAMANHOS: Record<Tamanho, string> = {
  md: 'h-10 px-4 text-sm',
  sm: 'h-8 px-3 text-xs',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  tamanho?: Tamanho;
  carregando?: boolean;
  larguraTotal?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variante = 'primario',
    tamanho = 'md',
    carregando = false,
    larguraTotal = false,
    disabled,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  const bloqueado = disabled || carregando;
  return (
    <button
      ref={ref}
      type={type}
      disabled={bloqueado}
      aria-busy={carregando || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTES[variante],
        TAMANHOS[tamanho],
        larguraTotal && 'w-full',
        className,
      )}
      {...props}
    >
      {carregando ? <Spinner rotulo={null} className="h-4 w-4" /> : null}
      {children}
    </button>
  );
});
