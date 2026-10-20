import { cn } from '@/lib/cn';

/**
 * O selo do aplicativo que pede acesso: a inicial dele num quadrado. Não é o
 * logotipo do outro produto, de propósito: nome e logotipo sozinhos não provam
 * quem é (a tela mostra a empresa e o CNPJ ao lado).
 */
export function SeloDoAplicativo({ letra, pequeno = false }: { letra: string; pequeno?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-xl bg-tinta font-bold text-superficie',
        pequeno ? 'h-8 w-8 rounded-lg text-sm' : 'h-11 w-11 text-xl',
      )}
    >
      {letra}
    </span>
  );
}
