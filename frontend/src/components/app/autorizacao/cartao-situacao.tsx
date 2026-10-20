import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Tom = 'sucesso' | 'atencao' | 'erro';

const DISCO: Record<Tom, string> = {
  sucesso: 'bg-sucesso/10 text-sucesso',
  atencao: 'bg-atencao/10 text-atencao',
  erro: 'bg-erro/10 text-erro',
};

/**
 * O cartão curto da página de autorização: pedido que não vale, aplicativo
 * parado, quem não é o dono, a trava da senha e a volta ao aplicativo. O título
 * recebe o foco quando a situação muda, para o leitor de tela anunciar.
 */
export function CartaoSituacao({
  tom,
  icone,
  titulo,
  children,
  acoes,
}: {
  tom: Tom;
  icone: ReactNode;
  titulo: string;
  children?: ReactNode;
  acoes?: ReactNode;
}) {
  return (
    <section
      aria-labelledby="titulo-situacao"
      className="grid w-full max-w-lg justify-items-center gap-4 rounded-2xl border border-borda bg-superficie p-6 text-center shadow-sm sm:p-8"
    >
      <span className={cn('grid h-14 w-14 place-items-center rounded-full', DISCO[tom])}>{icone}</span>
      <h1
        id="titulo-situacao"
        tabIndex={-1}
        ref={(el) => el?.focus({ preventScroll: true })}
        className="text-balance text-xl font-bold text-tinta focus:outline-none"
      >
        {titulo}
      </h1>
      {children ? <div className="grid gap-3 text-sm leading-relaxed text-tinta-suave">{children}</div> : null}
      {acoes ? <div className="flex w-full flex-wrap justify-center gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">{acoes}</div> : null}
    </section>
  );
}
