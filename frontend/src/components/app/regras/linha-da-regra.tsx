'use client';

import { IconeFechar } from '@/components/app/icones';
import type { OpcoesDaBase } from '@/components/app/regras/use-catalogo-das-regras';
import { Input, Select } from '@/components/ui/input';
import { campoDe, trocarCampo, type RegraNaTela } from '@/lib/regras-do-publico';
import type { CampoDaRegra, CatalogoDasRegras } from '@/lib/tipos';

/** Os campos do catálogo agrupados como o servidor manda (Compras, Aniversário…), na ordem dele. */
function grupos(catalogo: CatalogoDasRegras): { grupo: string; campos: CampoDaRegra[] }[] {
  const lista: { grupo: string; campos: CampoDaRegra[] }[] = [];
  for (const c of catalogo.campos) {
    let g = lista.find((x) => x.grupo === c.grupo);
    if (!g) {
      g = { grupo: c.grupo, campos: [] };
      lista.push(g);
    }
    g.campos.push(c);
  }
  return lista;
}

/** As opções de um campo de lista: as fixas do catálogo, ou as da base (bairros, produtos). */
function opcoesDoCampo(campo: CampoDaRegra, base: OpcoesDaBase): { valor: string; nome: string }[] | null {
  if (campo.opcoes) return campo.opcoes;
  const daBase = campo.opcoesDe === 'bairros' ? base.bairros : campo.opcoesDe === 'produtos' ? base.produtos : [];
  return daBase === null ? null : daBase.map((v) => ({ valor: v, nome: v }));
}

const NADA_NA_BASE: Record<'bairros' | 'produtos', string> = {
  bairros: 'Nenhum bairro nas compras ainda',
  produtos: 'Nenhum produto nas compras ainda',
};

/**
 * Uma regra: campo, comparação e valor, e o botão de tirar. O valor muda com o
 * tipo do campo — número, reais (R$ à esquerda), dias ("dias" à direita), data
 * com o seletor do navegador, ou lista. No estreito, o campo fica com o botão
 * de tirar e a comparação e o valor descem, cada um na sua linha.
 */
export function LinhaDaRegra({
  catalogo,
  regra,
  numero,
  prefixo,
  opcoesDaBase,
  aoMudar,
  aoTirar,
}: {
  catalogo: CatalogoDasRegras;
  regra: RegraNaTela;
  /** A posição da regra (1, 2…), para os rótulos. */
  numero: number;
  /** Separa os `id` de dois editores na mesma página. */
  prefixo: string;
  opcoesDaBase: OpcoesDaBase;
  aoMudar: (regra: RegraNaTela) => void;
  aoTirar: () => void;
}) {
  const campo = campoDe(catalogo, regra.campo);
  const tipo = campo?.tipo ?? 'numero';
  const comparacoes = catalogo.comparacoes[tipo] ?? [];
  const base = `${prefixo}-${regra.chave}`;
  const opcoes = campo && tipo === 'lista' ? opcoesDoCampo(campo, opcoesDaBase) : null;
  // O valor gravado que não está mais entre as opções (um bairro que sumiu das compras) continua escolhível.
  const valorForaDaLista = opcoes !== null && regra.valor !== '' && !opcoes.some((o) => o.valor === regra.valor);
  const unidade = tipo === 'dias' ? ' (em dias)' : tipo === 'reais' ? ' (em reais)' : '';

  return (
    <div className="space-y-1">
      <div
        role="group"
        aria-label={`Regra ${numero}`}
        className="grid grid-cols-[minmax(0,1fr)_2.5rem] gap-2 rounded-xl border border-borda bg-superficie p-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_2.5rem] sm:items-center"
      >
        <div className="col-start-1 row-start-1 min-w-0">
          <label htmlFor={`${base}-campo`} className="sr-only">
            Campo da regra {numero}
          </label>
          <Select
            id={`${base}-campo`}
            value={regra.campo}
            onChange={(e) => aoMudar(trocarCampo(catalogo, regra, e.target.value))}
          >
            {!campo && <option value={regra.campo}>Campo que não existe mais</option>}
            {grupos(catalogo).map((g) => (
              <optgroup key={g.grupo} label={g.grupo}>
                {g.campos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>

        <div className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
          <label htmlFor={`${base}-comparacao`} className="sr-only">
            Comparação da regra {numero}
          </label>
          <Select
            id={`${base}-comparacao`}
            value={regra.comparacao}
            onChange={(e) => aoMudar({ ...regra, comparacao: e.target.value as RegraNaTela['comparacao'] })}
          >
            {comparacoes.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.nome}
              </option>
            ))}
          </Select>
        </div>

        <div className="col-span-2 row-start-3 flex min-w-0 items-center gap-2 sm:col-span-1 sm:col-start-3 sm:row-start-1">
          <label htmlFor={`${base}-valor`} className="sr-only">
            Valor da regra {numero}
            {unidade}
          </label>
          {tipo === 'reais' && (
            <span aria-hidden="true" className="shrink-0 text-sm text-tinta-suave">
              R$
            </span>
          )}
          {tipo === 'lista' ? (
            <Select
              id={`${base}-valor`}
              value={regra.valor}
              disabled={opcoes === null}
              onChange={(e) => aoMudar({ ...regra, valor: e.target.value })}
            >
              <option value="">
                {opcoes === null
                  ? 'Carregando…'
                  : opcoes.length === 0 && campo?.opcoesDe
                    ? NADA_NA_BASE[campo.opcoesDe]
                    : 'Escolha…'}
              </option>
              {valorForaDaLista && <option value={regra.valor}>{regra.valor}</option>}
              {(opcoes ?? []).map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.nome}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              id={`${base}-valor`}
              type={tipo === 'data' ? 'date' : 'number'}
              inputMode={tipo === 'reais' ? 'decimal' : tipo === 'data' ? undefined : 'numeric'}
              min={tipo === 'data' ? undefined : 0}
              step={tipo === 'reais' ? '0.01' : tipo === 'data' ? undefined : 1}
              placeholder={tipo === 'data' ? undefined : 'Informe um valor'}
              value={regra.valor}
              onChange={(e) => aoMudar({ ...regra, valor: e.target.value })}
              className="numerico"
            />
          )}
          {tipo === 'dias' && (
            <span aria-hidden="true" className="shrink-0 text-sm text-tinta-suave">
              dias
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={aoTirar}
          aria-label={`Tirar a regra ${numero}`}
          className="col-start-2 row-start-1 grid h-10 w-10 place-items-center rounded-xl border border-borda bg-superficie text-tinta-suave transition-colors hover:border-erro/40 hover:text-erro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento sm:col-start-4"
        >
          <IconeFechar className="h-4 w-4" />
        </button>
      </div>
      {campo?.ajuda && <p className="px-1 text-xs text-tinta-suave">{campo.ajuda}</p>}
    </div>
  );
}
