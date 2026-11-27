'use client';

import { Fragment } from 'react';

import { IconeMais } from '@/components/app/icones';
import { LinhaDaRegra } from '@/components/app/regras/linha-da-regra';
import { useOpcoesDaBase } from '@/components/app/regras/use-catalogo-das-regras';
import { campoDe, regraNova, type RegraNaTela } from '@/lib/regras-do-publico';
import type { CatalogoDasRegras } from '@/lib/tipos';

/**
 * A caixa "Regras": uma linha por regra, "e" entre elas (o contato precisa
 * cumprir todas) e "Adicionar regra" até o máximo do catálogo. Serve à
 * campanha e à edição de um público salvo, em Contatos.
 */
export function EditorDeRegras({
  catalogo,
  regras,
  aoMudar,
  prefixo,
}: {
  catalogo: CatalogoDasRegras;
  regras: RegraNaTela[];
  aoMudar: (regras: RegraNaTela[]) => void;
  /** Separa os `id` de dois editores na mesma página. */
  prefixo: string;
}) {
  const opcoesDaBase = useOpcoesDaBase({
    bairros: regras.some((r) => campoDe(catalogo, r.campo)?.opcoesDe === 'bairros'),
    produtos: regras.some((r) => campoDe(catalogo, r.campo)?.opcoesDe === 'produtos'),
  });
  const cheio = regras.length >= catalogo.maxRegras;

  function adicionar() {
    const nova = regraNova(catalogo);
    if (!nova || cheio) return;
    aoMudar([...regras, nova]);
    // O campo da regra nova recebe o foco: dá para escolher sem procurar onde ela apareceu.
    requestAnimationFrame(() => document.getElementById(`${prefixo}-${nova.chave}-campo`)?.focus());
  }

  function tirar(chave: string) {
    aoMudar(regras.filter((r) => r.chave !== chave));
    requestAnimationFrame(() => document.getElementById(`${prefixo}-adicionar`)?.focus());
  }

  return (
    <div className="space-y-2 rounded-2xl bg-superficie-2 p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-tinta">Regras</h3>
        <p className="text-xs text-tinta-suave">
          O contato precisa cumprir todas. Até {catalogo.maxRegras} regras.
        </p>
      </div>

      {regras.length === 0 && (
        <p className="text-sm text-tinta-suave">Nenhuma regra ainda. Toque em &quot;Adicionar regra&quot;.</p>
      )}

      {regras.map((r, i) => (
        <Fragment key={r.chave}>
          {i > 0 && (
            <p aria-hidden="true" className="pl-2 text-xs font-bold uppercase tracking-wider text-tinta-suave">
              e
            </p>
          )}
          <LinhaDaRegra
            catalogo={catalogo}
            regra={r}
            numero={i + 1}
            prefixo={prefixo}
            opcoesDaBase={opcoesDaBase}
            aoMudar={(nova) => aoMudar(regras.map((x) => (x.chave === r.chave ? nova : x)))}
            aoTirar={() => tirar(r.chave)}
          />
        </Fragment>
      ))}

      {opcoesDaBase.erro && (
        <p className="text-xs text-erro" role="alert">
          Não consegui carregar as opções da base: {opcoesDaBase.erro}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          id={`${prefixo}-adicionar`}
          type="button"
          onClick={adicionar}
          disabled={cheio}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-acento-forte transition-colors hover:bg-superficie focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento disabled:cursor-not-allowed disabled:opacity-50"
        >
          <IconeMais className="h-4 w-4" />
          Adicionar regra
        </button>
        {cheio && (
          <span className="text-xs text-tinta-suave">
            Chegou a {catalogo.maxRegras} regras: tire uma para pôr outra.
          </span>
        )}
      </div>
    </div>
  );
}
