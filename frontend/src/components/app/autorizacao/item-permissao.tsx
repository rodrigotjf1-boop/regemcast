import { IconeCadeado, IconeCheck, IconeMais, IconeSeta } from '@/components/app/icones';
import { cn } from '@/lib/cn';
import type { PermissaoNaTela } from '@/lib/tipos';

/**
 * Uma permissão na página de autorização: o que libera, numa frase (a do
 * catálogo), e o motivo que o aplicativo declara, que abre sem sair da tela.
 * Com `chave`, é opcional: nasce desligada e o dono liga (decisão B1-2).
 */
export function ItemPermissao({
  permissao,
  nomeDoAplicativo,
  icone = 'liberada',
  novo = false,
  chave,
}: {
  permissao: PermissaoNaTela;
  nomeDoAplicativo: string;
  icone?: 'liberada' | 'nova';
  novo?: boolean;
  chave?: { ligada: boolean; alternar: () => void };
}) {
  const desligada = chave ? !chave.ligada : false;
  const idRotulo = `permissao-${permissao.id.replace(/\./g, '-')}`;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-borda px-4 py-3 first:border-t-0 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <span className={cn('mt-0.5', desligada ? 'text-tinta-suave' : 'text-sucesso')}>
        {desligada ? <IconeCadeado className="h-[18px] w-[18px]" /> : icone === 'nova' ? <IconeMais className="h-[18px] w-[18px]" /> : <IconeCheck className="h-[18px] w-[18px]" />}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span id={idRotulo} className={cn('font-semibold', desligada ? 'text-tinta-suave' : 'text-tinta')}>
          {permissao.rotulo}
        </span>
        {permissao.dadoPessoal ? <span className="rounded-full bg-atencao/10 px-2 py-0.5 text-[11px] font-semibold text-atencao">Dado pessoal</span> : null}
        {novo ? <span className="rounded-full border border-borda bg-superficie-2 px-2 py-0.5 text-[11px] font-semibold text-tinta-suave">Novo</span> : null}
      </div>
      <p className="col-start-2 text-[13px] leading-relaxed text-tinta-suave">{permissao.frase}</p>
      {desligada && permissao.semEla ? <p className="col-start-2 text-xs text-atencao">{permissao.semEla}</p> : null}
      {permissao.motivo ? (
        <details className="group col-start-2 text-xs">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded font-semibold text-acento-forte [&::-webkit-details-marker]:hidden">
            <IconeSeta className="h-3 w-3 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
            Por que o {nomeDoAplicativo} pede
          </summary>
          <p className="pt-1 text-tinta-suave">{permissao.motivo}</p>
        </details>
      ) : null}
      {chave ? (
        <div className="col-start-2 mt-1 sm:col-start-3 sm:row-span-4 sm:row-start-1 sm:mt-0 sm:self-center">
          <button
            type="button"
            role="switch"
            aria-checked={chave.ligada}
            aria-labelledby={idRotulo}
            onClick={chave.alternar}
            // Ligada: trilho ameixa e botão lima no claro, o contrário no escuro (lima sobre lima sumiria). Desligada:
            // trilho em tinta suave, que passa dos 3:1 sobre o cartão nos dois temas.
            className={cn(
              'relative h-[26px] w-11 shrink-0 rounded-full transition-colors motion-reduce:transition-none',
              chave.ligada ? 'bg-acento-forte' : 'bg-tinta-suave',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'absolute left-[3px] top-[3px] h-5 w-5 rounded-full shadow-sm transition-transform motion-reduce:transition-none',
                chave.ligada ? 'translate-x-[18px] bg-acento dark:bg-acento-contraste' : 'bg-superficie',
              )}
            />
          </button>
        </div>
      ) : null}
    </li>
  );
}
