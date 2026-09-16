import { cn } from '@/lib/cn';

/**
 * Esqueleto de carregamento.
 *
 * Melhor que spinner quando se sabe o FORMATO do que vem: a tela já mostra onde
 * cada coisa vai ficar, e o conteúdo entra no lugar sem empurrar nada. Spinner
 * continua certo para ação do usuário (salvar, enviar), onde não há forma.
 */
export function Esqueleto({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('esqueleto rounded-lg', className)} />;
}

/** Bloco de linhas, para cartões e listas enquanto carregam. */
export function EsqueletoLista({ linhas = 3, className }: { linhas?: number; className?: string }) {
  return (
    <div role="status" aria-label="Carregando" className={cn('space-y-3', className)}>
      {Array.from({ length: linhas }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-card border border-borda bg-superficie p-4 shadow-card"
        >
          <Esqueleto className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Esqueleto className="h-3.5 w-1/3" />
            <Esqueleto className="h-3 w-2/3" />
          </div>
          <Esqueleto className="hidden h-7 w-20 rounded-full sm:block" />
        </div>
      ))}
      <span className="sr-only">Carregando…</span>
    </div>
  );
}
