'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { formatarTelefone, quandoNaLista } from '@/lib/formato';
import type { ConversaResumo } from '@/lib/tipos';

/** Iniciais do nome (só letras: "Carlos (perfil)" vira "CP"); sem nome, os dois últimos dígitos. */
function iniciais(c: ConversaResumo): string {
  const partes = (c.nome ?? '')
    .split(/\s+/)
    .map((p) => p.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, ''))
    .filter(Boolean);
  if (partes.length >= 2) return (partes[0]![0]! + partes[partes.length - 1]![0]!).toUpperCase();
  if (partes.length === 1) return partes[0]!.slice(0, 2).toUpperCase();
  return c.telefone.slice(-2);
}

/**
 * A coluna da esquerda: as conversas, a mais recente primeiro.
 *
 * Mostra o que o atendente precisa para decidir onde clicar — quem é, o último
 * trecho, quando, quantas não lidas e se ainda dá para responder com texto
 * (janela de 24 horas aberta).
 */
export function ListaConversas({
  itens,
  selecionada,
  busca,
  aoBuscar,
  aoSelecionar,
  carregou,
}: {
  itens: ConversaResumo[];
  selecionada: string | null;
  busca: string;
  aoBuscar: (v: string) => void;
  aoSelecionar: (id: string) => void;
  carregou: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-borda p-3">
        <label htmlFor="busca-conversa" className="sr-only">
          Buscar conversa por nome ou telefone
        </label>
        <Input
          id="busca-conversa"
          type="search"
          value={busca}
          onChange={(e) => aoBuscar(e.target.value)}
          placeholder="Buscar por nome ou telefone"
          autoComplete="off"
        />
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Conversas">
        {carregou && itens.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-tinta-suave">
            {busca.trim() ? 'Nenhuma conversa com esse nome ou telefone.' : 'Nenhuma conversa ainda.'}
          </li>
        )}
        {itens.map((c) => {
          const ativa = c.id === selecionada;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => aoSelecionar(c.id)}
                aria-current={ativa ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-3 border-b border-borda/60 px-3 py-3 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-acento',
                  ativa ? 'bg-acento-suave' : 'hover:bg-superficie-2',
                )}
              >
                <span
                  aria-hidden="true"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-lateral text-xs font-semibold text-lateral-tinta"
                >
                  {iniciais(c)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-tinta">
                      {c.nome ?? formatarTelefone(c.telefone)}
                    </span>
                    <span className={cn('numerico shrink-0 text-[11px]', c.naoLidas > 0 ? 'font-semibold text-acento-forte' : 'text-tinta-suave')}>
                      {quandoNaLista(c.ultimaMensagemEm)}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-tinta-suave">
                      {c.janelaAteEm && (
                        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-sucesso align-middle" title="Dá para responder com texto" />
                      )}
                      {c.ultimaMensagem ?? formatarTelefone(c.telefone)}
                    </span>
                    {c.naoLidas > 0 && (
                      <span className="numerico grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-acento px-1.5 text-[11px] font-bold text-acento-contraste">
                        <span className="sr-only">Não lidas: </span>
                        {c.naoLidas > 99 ? '99+' : c.naoLidas}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
