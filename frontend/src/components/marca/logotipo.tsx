import { cn } from '@/lib/cn';

/**
 * Marca Regemcast — direção 04 "Pulso", versão Lima.
 *
 * O símbolo vem inline (são dois paths) em vez de `<img src="/marca/...">` por
 * dois motivos: não custa uma requisição, e o traço do pulso precisa mudar com
 * o tema — branco sobre o balão no claro, ameixa no escuro, exatamente como o
 * kit entrega nos arquivos `-cor-claro` e `-cor-escuro`. Com
 * `var(--cor-pulso)` isso sai de graça.
 *
 * Os vetores completos (horizontal, vertical, mono, PDF, EPS) estão em `kit/` e
 * os usados pela web em `public/marca/`. Este componente é o lockup da
 * interface, não a fonte da marca: se divergir do kit, o kit vence.
 */
export function Logotipo({
  className,
  mostrarNome = true,
}: {
  className?: string;
  mostrarNome?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg aria-hidden="true" viewBox="0 0 100 100" className="h-8 w-8 shrink-0" focusable="false">
        {/* Balão de conversa. Lima é a cor de ação da marca. */}
        <path
          d="M26 16H74A12 12 0 0 1 86 28V60A12 12 0 0 1 74 72H44L28 88L31 72H26A12 12 0 0 1 14 60V28A12 12 0 0 1 26 16Z"
          fill="rgb(var(--cor-acento))"
        />
        {/* O pulso — a batida de um disparo saindo. */}
        <path
          d="M24 48H32L38 38L44 48L50 30L56 48L62 40L68 48H76"
          fill="none"
          stroke="rgb(var(--cor-pulso))"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {mostrarNome ? (
        <span className="text-base font-bold tracking-tight text-tinta">regemcast</span>
      ) : (
        <span className="sr-only">Regemcast</span>
      )}
    </span>
  );
}
