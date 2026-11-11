'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Um diálogo modal, pelo `<dialog>` nativo: o navegador prende o foco dentro dele, fecha no Esc (avisando por
 * `aoFechar`) e deixa o resto da página inerte para o leitor de tela. O foco volta a quem abriu quando fecha.
 *
 * Aberto = `aberto`; quem usa decide fechar (Voltar, Esc, depois de concluir). O título recebe o foco ao abrir, para o
 * leitor de tela anunciar o que é o diálogo antes do primeiro campo.
 */
export function Dialogo({
  aberto,
  titulo,
  descricao,
  aoFechar,
  children,
  className,
}: {
  aberto: boolean;
  titulo: string;
  descricao?: ReactNode;
  aoFechar: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const idTitulo = useId();
  const idDescricao = useId();
  const quemAbriu = useRef<Element | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) {
      quemAbriu.current = document.activeElement;
      d.showModal();
      tituloRef.current?.focus();
    } else if (!aberto && d.open) {
      d.close();
      (quemAbriu.current as HTMLElement | null)?.focus?.();
    }
  }, [aberto]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={idTitulo}
      aria-describedby={descricao ? idDescricao : undefined}
      // Esc: o navegador cancela; quem usa decide (e o estado fica certo).
      onCancel={(e) => {
        e.preventDefault();
        aoFechar();
      }}
      className={cn(
        'm-auto w-[calc(100%-2rem)] max-w-md rounded-card border border-borda bg-superficie p-0 text-tinta shadow-card backdrop:bg-black/50',
        className,
      )}
    >
      <div className="space-y-4 p-5">
        <div className="space-y-1.5">
          <h3 id={idTitulo} ref={tituloRef} tabIndex={-1} className="text-base font-semibold text-tinta outline-none">
            {titulo}
          </h3>
          {descricao ? (
            <div id={idDescricao} className="text-sm text-tinta-suave">
              {descricao}
            </div>
          ) : null}
        </div>
        {children}
      </div>
    </dialog>
  );
}
