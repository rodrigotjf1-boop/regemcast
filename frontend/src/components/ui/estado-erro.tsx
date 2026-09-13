import { cn } from '@/lib/cn';

import { Alerta } from './alerta';
import { Button } from './button';

/**
 * Estado de FALHA de carga.
 *
 * Existe para a tela nunca preencher o buraco com zero: quando a leitura falha,
 * o produto não sabe o uso, o teto nem quantas pessoas tem a conta — e mostrar
 * "0 de 0" ou "nada por aqui" é afirmar um fato que ninguém verificou.
 *
 * Sempre traz o MOTIVO que o servidor deu (a `mensagem` já vem em pt-BR) e a
 * ação que resolve, porque erro sem saída deixa o usuário só com o F5.
 */
export function EstadoErro({
  titulo,
  mensagem,
  aoTentarDeNovo,
  className,
}: {
  titulo: string;
  mensagem: string;
  aoTentarDeNovo: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-card border border-dashed border-borda',
        'bg-superficie-2/50 px-4 py-8 text-center',
        className,
      )}
    >
      <h3 className="text-sm font-semibold text-tinta">{titulo}</h3>
      <Alerta className="max-w-prose text-left">{mensagem}</Alerta>
      <Button variante="secundario" onClick={aoTentarDeNovo}>
        Tentar de novo
      </Button>
    </div>
  );
}
