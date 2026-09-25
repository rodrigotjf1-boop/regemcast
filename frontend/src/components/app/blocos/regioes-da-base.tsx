'use client';

import { IconeMapa } from '@/components/app/icones';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { formatarNumero } from '@/lib/formato';
import type { RegioesDaBase } from '@/lib/tipos';

/**
 * A base por estado, pelo DDD — a classificação que existe até na lista mais
 * crua, só com nome e número: o número já diz a região.
 *
 * Clicar num estado filtra a tabela; com um estado escolhido, "Dividir em
 * blocos" separa só aquela região (campanha de frete grátis no Rio, por
 * exemplo).
 */
export function RegioesPeloDdd({
  regioes,
  selecionada,
  aoSelecionar,
  aoDividir,
}: {
  regioes: RegioesDaBase;
  selecionada: string | null;
  aoSelecionar: (uf: string | null) => void;
  aoDividir: (uf: string, estado: string, total: number) => void;
}) {
  const escolhida = regioes.regioes.find((r) => r.uf === selecionada) ?? null;

  return (
    <section aria-label="Regiões da base" className="anima-entrada space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-base font-semibold text-tinta">
          <IconeMapa className="h-4 w-4" />
          Regiões pelo DDD
        </h2>
        <p className="text-xs text-tinta-suave">
          O DDD diz onde a linha foi habilitada, não onde a pessoa mora hoje.
        </p>
      </div>

      <ul className="flex flex-wrap gap-2">
        {regioes.regioes.map((r) => {
          const ativa = r.uf === selecionada;
          return (
            <li key={r.uf}>
              <button
                type="button"
                aria-pressed={ativa}
                title={r.ddds.map((d) => `${d.ddd} ${d.cidade}: ${formatarNumero(d.total)}`).join(' · ')}
                onClick={() => aoSelecionar(ativa ? null : r.uf)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento',
                  ativa ? 'border-acento bg-acento/10 text-tinta ring-2 ring-acento' : 'border-borda bg-superficie text-tinta hover:border-acento',
                )}
              >
                <span className="font-semibold">{r.uf}</span>
                <span className="numerico text-tinta-suave">{formatarNumero(r.total)}</span>
              </button>
            </li>
          );
        })}
        {regioes.semRegiao > 0 && (
          <li className="inline-flex items-center rounded-full border border-dashed border-borda px-3 py-1.5 text-sm text-tinta-suave">
            Fora do Brasil ou sem DDD <span className="numerico ml-2">{formatarNumero(regioes.semRegiao)}</span>
          </li>
        )}
      </ul>

      {escolhida && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-acento/40 bg-acento/5 p-3">
          <p className="text-sm text-tinta">
            Mostrando <strong>{escolhida.estado}</strong>: {formatarNumero(escolhida.total)}{' '}
            {escolhida.total === 1 ? 'contato' : 'contatos'}
            <span className="text-tinta-suave">
              {' '}({escolhida.ddds.map((d) => `${d.ddd} ${d.cidade}`).join(', ')})
            </span>
            .
          </p>
          <div className="flex flex-wrap gap-2">
            <Button tamanho="sm" onClick={() => aoDividir(escolhida.uf, escolhida.estado, escolhida.total)}>
              Dividir em blocos
            </Button>
            <Button tamanho="sm" variante="secundario" onClick={() => aoSelecionar(null)}>
              Ver todos
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
