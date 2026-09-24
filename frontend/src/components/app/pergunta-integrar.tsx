'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * A pergunta da coexistência: trazer, ou não, os contatos e as conversas do
 * WhatsApp Business para o Regemcast.
 *
 * Nenhuma opção vem marcada: guardar a agenda de alguém exige uma resposta
 * explícita, e rádio pré-marcado não é resposta.
 *
 * A declaração aparece junto do "sim" porque é ela que o dono aceita ao
 * escolher. O texto vem do servidor — é o mesmo que a auditoria grava.
 */
export function PerguntaIntegrar({
  nome,
  valor,
  aoEscolher,
  declaracao,
  desabilitada,
}: {
  /** `name` do grupo de rádio: precisa ser único na tela. */
  nome: string;
  valor: boolean | null;
  aoEscolher: (integrar: boolean) => void;
  declaracao: string;
  desabilitada?: boolean;
}) {
  return (
    <fieldset className="space-y-3" disabled={desabilitada}>
      <legend className="text-sm font-semibold text-tinta">
        Trazer os contatos e as conversas deste número para o Regemcast?
      </legend>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Opcao nome={nome} marcada={valor === true} aoMarcar={() => aoEscolher(true)} titulo="Sim, trazer">
          <p>
            Os contatos da agenda entram na sua base, numa lista própria, e as conversas dos
            últimos 6 meses ficam guardadas.
          </p>
          <p className="mt-2">
            Ao escolher sim, você declara: “{declaracao}”
          </p>
        </Opcao>

        <Opcao nome={nome} marcada={valor === false} aoMarcar={() => aoEscolher(false)} titulo="Não trazer">
          <p>
            O número serve só para as campanhas. Nada da agenda nem das conversas fica guardado
            aqui.
          </p>
        </Opcao>
      </div>

      <p className="text-xs leading-relaxed text-tinta-suave">
        A Meta manda o histórico de conversas uma vez só, logo depois da conexão. Se responder
        não, as conversas antigas não poderão ser trazidas depois — só o que chegar dali para
        frente.
      </p>
    </fieldset>
  );
}

/**
 * Uma resposta. `<input type="radio">` de verdade, só escondido: o grupo anda
 * com as setas do teclado e o leitor de tela anuncia "opção 1 de 2".
 */
function Opcao({
  nome,
  marcada,
  aoMarcar,
  titulo,
  children,
}: {
  nome: string;
  marcada: boolean;
  aoMarcar: () => void;
  titulo: string;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer flex-col gap-2 rounded-card border p-3 transition',
        'focus-within:ring-2 focus-within:ring-acento/40',
        marcada ? 'border-acento bg-acento-suave' : 'border-borda bg-superficie hover:border-acento/40',
      )}
    >
      <span className="flex items-start gap-2">
        <input type="radio" name={nome} checked={marcada} onChange={aoMarcar} className="sr-only" />
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border',
            marcada ? 'border-acento' : 'border-borda',
          )}
        >
          {marcada && <span className="h-2 w-2 rounded-full bg-acento" />}
        </span>
        <span className="text-sm font-semibold text-tinta">{titulo}</span>
      </span>
      <div className="pl-6 text-xs leading-relaxed text-tinta-suave">{children}</div>
    </label>
  );
}
