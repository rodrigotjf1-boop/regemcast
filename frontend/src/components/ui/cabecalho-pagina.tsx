import type { ReactNode } from 'react';

/**
 * O cabeçalho de uma tela.
 *
 * Existe porque cada página estava escrevendo o seu, com tamanhos e espaçamentos
 * um pouco diferentes. Ninguém nota uma tela isolada; todo mundo sente o
 * conjunto — o produto parece montado por pessoas que não conversaram.
 *
 * O `max-w-prose` na descrição não é detalhe: linha de texto que atravessa a
 * tela inteira obriga o olho a voltar do fim ao começo, e é por isso que
 * descrição longa em tela larga não é lida.
 */
export function CabecalhoPagina({
  titulo,
  descricao,
  acao,
}: {
  titulo: ReactNode;
  descricao?: ReactNode;
  /** Botão principal da tela, quando houver. */
  acao?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 space-y-1">
        <h1 className="text-[1.375rem] font-semibold tracking-tight text-tinta">{titulo}</h1>
        {descricao ? (
          <p className="max-w-prose text-sm leading-relaxed text-tinta-suave">{descricao}</p>
        ) : null}
      </div>
      {acao ? <div className="shrink-0">{acao}</div> : null}
    </header>
  );
}
