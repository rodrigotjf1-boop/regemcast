import { cn } from '@/lib/cn';

interface SpinnerProps {
  className?: string;
  /** Some para o leitor de tela quando já existe um `aria-live` por perto. */
  rotulo?: string | null;
}

/** Indicador de carregando. Com `prefers-reduced-motion` ele para de girar (globals.css). */
export function Spinner({ className, rotulo = 'Carregando…' }: SpinnerProps) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent align-[-0.125em]',
          className,
        )}
      />
      {rotulo ? <span className="sr-only">{rotulo}</span> : null}
    </span>
  );
}
