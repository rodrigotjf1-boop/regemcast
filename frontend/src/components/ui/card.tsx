import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * O cartão.
 *
 * Ele **preenche por padrão**, e isso conserta um defeito que estava espalhado:
 * o `Card` nascia sem padding e esperava que cada tela embrulhasse o conteúdo
 * num `CardCorpo`. Duas telas faziam isso; as outras vinte e três não — e nelas
 * o texto encostava na borda. É o tipo de descuido que, somado, faz um produto
 * parecer inacabado sem que se consiga apontar o motivo.
 *
 * Quando o cartão É composto (cabeçalho com divisória + corpo), o padding do
 * contêiner atrapalharia: a divisória precisa ir de borda a borda. Por isso o
 * `has-[[data-card-bloco]]:p-0` — se houver um bloco interno que se preenche
 * sozinho, o contêiner sai da frente. Uma regra, nenhuma tela para editar.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-card border border-borda bg-superficie p-4 shadow-card sm:p-5',
        'has-[[data-card-bloco]]:p-0',
        className,
      )}
      {...props}
    />
  );
}

export function CardCabecalho({
  titulo,
  descricao,
  acao,
  className,
}: {
  titulo: ReactNode;
  descricao?: ReactNode;
  acao?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-card-bloco
      className={cn(
        'flex flex-col gap-3 border-b border-borda p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5',
        className,
      )}
    >
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{titulo}</h2>
        {descricao ? <p className="text-sm text-tinta-suave">{descricao}</p> : null}
      </div>
      {acao ? <div className="shrink-0">{acao}</div> : null}
    </div>
  );
}

export function CardCorpo({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-card-bloco className={cn('p-4 sm:p-5', className)} {...props} />;
}
