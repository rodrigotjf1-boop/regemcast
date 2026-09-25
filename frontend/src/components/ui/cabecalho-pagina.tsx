import type { ReactNode } from 'react';

/**
 * O cabeçalho de uma tela.
 *
 * Um componente só para todas as telas: ninguém nota uma tela isolada com
 * espaçamento diferente, mas todo mundo sente o conjunto — o produto parece
 * montado por pessoas que não conversaram.
 *
 * O ícone em ladrilho lima é a âncora visual da tela: é o mesmo desenho do item
 * na barra lateral, então a pessoa reconhece onde está sem ler o título.
 *
 * O `max-w-prose` na descrição não é detalhe: linha que atravessa a tela inteira
 * obriga o olho a voltar do fim ao começo, e descrição longa não é lida.
 */
export function CabecalhoPagina({
  titulo,
  descricao,
  acao,
  icone,
  sobretitulo,
}: {
  titulo: ReactNode;
  descricao?: ReactNode;
  /** Botão principal da tela, quando houver. */
  acao?: ReactNode;
  icone?: ReactNode;
  /** Linha pequena acima do título — contexto, não repetição do título. */
  sobretitulo?: ReactNode;
}) {
  return (
    <header className="anima-entrada flex flex-wrap items-start justify-between gap-x-4 gap-y-4">
      <div className="flex min-w-0 items-start gap-4">
        {icone ? (
          <span
            aria-hidden="true"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-acento text-acento-contraste shadow-brilho [&>svg]:h-6 [&>svg]:w-6"
          >
            {icone}
          </span>
        ) : null}
        <div className="min-w-0 space-y-1">
          {typeof sobretitulo === 'string' ? (
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-tinta-suave">
              {sobretitulo}
            </p>
          ) : sobretitulo ? (
            <div>{sobretitulo}</div>
          ) : null}
          <h1 className="text-2xl font-semibold tracking-tight text-tinta sm:text-[1.75rem]">
            {titulo}
          </h1>
          {descricao ? (
            <p className="max-w-prose text-sm leading-relaxed text-tinta-suave">{descricao}</p>
          ) : null}
        </div>
      </div>
      {/* No celular a fila de botões quebra dentro da largura; lado a lado com o título, não encolhe. */}
      {acao ? <div className="flex max-w-full flex-wrap items-center gap-2 sm:shrink-0">{acao}</div> : null}
    </header>
  );
}
