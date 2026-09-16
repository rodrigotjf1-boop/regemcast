'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';
import { Spinner } from './spinner';

type Variante = 'primario' | 'secundario' | 'discreto' | 'perigo';
type Tamanho = 'md' | 'sm';

/**
 * O hover do primário usa `acento-escuro`, e NÃO `acento-forte`.
 *
 * `acento-forte` é o token de TEXTO do acento — ameixa no tema claro, porque
 * lima não se lê sobre fundo claro. Usá-lo como FUNDO pintava o botão de
 * ameixa por baixo do texto, que também é ameixa: contraste 1,00, botão mudo
 * ao passar o mouse. Token de texto e token de fundo são trabalhos diferentes.
 */
const VARIANTES: Record<Variante, string> = {
  primario:
    'bg-acento text-acento-contraste font-semibold shadow-[inset_0_1px_0_rgb(255_255_255/0.35)] hover:bg-acento-escuro hover:shadow-brilho active:bg-acento-escuro',
  secundario:
    'bg-superficie text-tinta border border-borda shadow-sm hover:border-tinta/25 hover:bg-superficie-2',
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
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium',
        'transition-[background-color,border-color,box-shadow,transform] duration-200 active:scale-[0.98]',
        '[&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:active:scale-100',
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
