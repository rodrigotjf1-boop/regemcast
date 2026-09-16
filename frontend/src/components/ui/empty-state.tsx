import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Estado vazio de verdade: diz o que aquilo vai mostrar, por que está vazio e
 * qual é o próximo passo. Tela vazia sem explicação é bug de produto.
 *
 * O ícone fica num ladrilho com um anel que se expande devagar — é o convite
 * visual para o primeiro passo, e a única coisa animada no bloco.
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
        'anima-entrada relative flex flex-col items-center gap-3 overflow-hidden rounded-card border border-dashed border-borda',
        'fundo-pontos bg-superficie px-4 py-12 text-center',
        className,
      )}
    >
      {icone ? (
        <div aria-hidden="true" className="relative mb-1 grid h-14 w-14 place-items-center">
          <span className="ponto-vivo absolute inset-2 rounded-2xl text-acento/40" />
          <span className="relative grid h-14 w-14 place-items-center rounded-2xl bg-acento text-acento-contraste shadow-brilho [&>svg]:h-7 [&>svg]:w-7">
            {icone}
          </span>
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-tinta">{titulo}</h3>
      <p className="max-w-prose text-sm leading-relaxed text-tinta-suave">{descricao}</p>
      {acao ? <div className="pt-2">{acao}</div> : null}
    </div>
  );
}
