import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { Esqueleto } from './esqueleto';
import { NumeroAnimado } from './numero-animado';

type Tom = 'acento' | 'realce' | 'sucesso' | 'erro' | 'neutro';

/** O ícone ganha um ladrilho colorido; o número continua na tinta da tela. */
const LADRILHO: Record<Tom, string> = {
  acento: 'bg-acento text-acento-contraste',
  realce: 'bg-realce text-tinta',
  sucesso: 'bg-sucesso/15 text-sucesso',
  erro: 'bg-erro/15 text-erro',
  neutro: 'bg-superficie-2 text-tinta-suave',
};

/**
 * Um indicador: rótulo, número e contexto.
 *
 * `valor` nulo NÃO vira zero. Nulo quer dizer "não consegui ler", e a tela diz
 * isso com um travessão e o `indisponivel` — zero é um fato, e ninguém mediu.
 */
export function Estatistica({
  rotulo,
  valor,
  icone,
  apoio,
  tom = 'neutro',
  carregando = false,
  indisponivel = 'Não consegui ler agora.',
  className,
}: {
  rotulo: string;
  valor: number | null;
  icone?: ReactNode;
  apoio?: ReactNode;
  tom?: Tom;
  carregando?: boolean;
  indisponivel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-card border border-borda bg-superficie p-4 shadow-card sm:p-5',
        'cartao-interativo',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-tinta-suave">{rotulo}</p>
        {icone ? (
          <span
            aria-hidden="true"
            className={cn(
              'grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6',
              LADRILHO[tom],
            )}
          >
            {icone}
          </span>
        ) : null}
      </div>

      <div className="mt-2 min-h-[2.25rem]">
        {carregando ? (
          <Esqueleto className="h-8 w-24" />
        ) : valor === null ? (
          <p className="text-3xl font-semibold text-tinta-suave" title={indisponivel}>
            —
          </p>
        ) : (
          <NumeroAnimado valor={valor} className="numerico text-3xl font-semibold text-tinta" />
        )}
      </div>

      {carregando ? (
        <Esqueleto className="mt-2 h-3 w-32" />
      ) : (
        <p className="mt-1 text-xs text-tinta-suave">{valor === null ? indisponivel : apoio}</p>
      )}
    </div>
  );
}
