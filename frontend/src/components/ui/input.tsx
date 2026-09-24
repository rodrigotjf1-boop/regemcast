'use client';

import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

import { cn } from '@/lib/cn';

const BASE_CAMPO =
  'w-full rounded-xl border border-borda bg-superficie px-3 py-2 text-sm text-tinta shadow-sm ' +
  'placeholder:text-tinta-suave/70 transition-[border-color,box-shadow] duration-200 ' +
  'hover:border-tinta/25 focus:border-acento-escuro focus:shadow-[0_0_0_4px_rgb(var(--cor-acento)/0.25)] ' +
  'read-only:bg-superficie-2 read-only:text-tinta-suave ' +
  'disabled:cursor-not-allowed disabled:bg-superficie-2 disabled:text-tinta-suave';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Marca o campo como inválido e liga o `aria-invalid` de uma vez só. */
  invalido?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalido, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalido || undefined}
      className={cn(BASE_CAMPO, 'h-10', invalido && 'border-erro', className)}
      {...props}
    />
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalido?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalido, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalido || undefined}
      className={cn(BASE_CAMPO, 'h-10 pr-8', invalido && 'border-erro', className)}
      {...props}
    >
      {children}
    </select>
  );
});

export interface AreaDeTextoProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalido?: boolean;
}

/** Campo de várias linhas, com o mesmo acabamento dos outros. */
export const AreaDeTexto = forwardRef<HTMLTextAreaElement, AreaDeTextoProps>(function AreaDeTexto(
  { className, invalido, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalido || undefined}
      className={cn(BASE_CAMPO, 'resize-none leading-relaxed', invalido && 'border-erro', className)}
      {...props}
    />
  );
});

/** Texto de apoio abaixo do campo (dica ou erro). */
export function AjudaCampo({
  children,
  tom = 'neutro',
  id,
}: {
  children: React.ReactNode;
  tom?: 'neutro' | 'erro';
  id?: string;
}) {
  return (
    <p
      id={id}
      className={cn('text-xs', tom === 'erro' ? 'text-erro' : 'text-tinta-suave')}
      role={tom === 'erro' ? 'alert' : undefined}
    >
      {children}
    </p>
  );
}
