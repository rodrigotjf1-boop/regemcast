import { cn } from '@/lib/cn';

/**
 * Marca Regemcast — direção 04 "Pulso", versão Lima.
 *
 * O símbolo vem inline (são dois paths) em vez de `<img src="/marca/...">` por
 * dois motivos: não custa uma requisição, e o traço do pulso precisa mudar com
 * o fundo — branco sobre o balão no claro, ameixa no escuro, exatamente como o
 * kit entrega nos arquivos `-cor-claro` e `-cor-escuro`.
 *
 * `animado` faz o pulso correr pelo balão, como um disparo saindo. Só vale em
 * lugar de destaque (barra lateral, login, carregamento): o logotipo animado em
 * três pontos da mesma tela disputa atenção consigo mesmo.
 *
 * `sobreEscuro` é para as superfícies ameixa fixas (barra lateral, cena do
 * login), que são escuras nos DOIS temas — ali o nome é claro e o traço, ameixa.
 */
export function Logotipo({
  className,
  mostrarNome = true,
  animado = false,
  sobreEscuro = false,
  tamanho = 'md',
}: {
  className?: string;
  mostrarNome?: boolean;
  animado?: boolean;
  sobreEscuro?: boolean;
  tamanho?: 'md' | 'lg';
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        className={cn('shrink-0', tamanho === 'lg' ? 'h-11 w-11' : 'h-8 w-8')}
        focusable="false"
      >
        {/* Balão de conversa. Lima é a cor de ação da marca. */}
        <path
          d="M26 16H74A12 12 0 0 1 86 28V60A12 12 0 0 1 74 72H44L28 88L31 72H26A12 12 0 0 1 14 60V28A12 12 0 0 1 26 16Z"
          fill="rgb(var(--cor-acento))"
        />
        {/* O pulso — a batida de um disparo saindo. */}
        <path
          d="M24 48H32L38 38L44 48L50 30L56 48L62 40L68 48H76"
          fill="none"
          stroke={sobreEscuro ? 'rgb(var(--cor-lateral))' : 'rgb(var(--cor-pulso))'}
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={animado ? 'anima-pulso-traco' : undefined}
        />
      </svg>
      {mostrarNome ? (
        <span
          className={cn(
            'font-bold tracking-tight',
            tamanho === 'lg' ? 'text-2xl' : 'text-base',
            sobreEscuro ? 'text-lateral-tinta' : 'text-tinta',
          )}
        >
          RegemCast
        </span>
      ) : (
        <span className="sr-only">RegemCast</span>
      )}
    </span>
  );
}
