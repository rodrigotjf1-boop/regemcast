import { cn } from '@/lib/cn';

/**
 * MARCA PROVISÓRIA.
 *
 * O logo definitivo ainda não chegou. Este monograma existe só para a interface
 * não ficar sem âncora visual — é deliberadamente sóbrio e usa apenas tokens,
 * então trocar por um SVG real é substituir o corpo deste arquivo e mais nada.
 */
export function Logotipo({ className, mostrarNome = true }: { className?: string; mostrarNome?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden="true"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-acento text-sm font-bold text-acento-contraste"
      >
        RC
      </span>
      {mostrarNome ? (
        <span className="text-base font-semibold tracking-tight text-tinta">RegemCast</span>
      ) : (
        <span className="sr-only">RegemCast</span>
      )}
    </span>
  );
}
