'use client';

import { useEffect, useRef, useState } from 'react';

import { Ficha } from '@/components/app/ficha-de-publico';
import { Alerta } from '@/components/ui/alerta';
import { Input } from '@/components/ui/input';
import { mensagemDoErro } from '@/lib/api';
import { contatos as servico } from '@/lib/servicos';
import type { AlvoDePublico, ProdutoDaBase } from '@/lib/tipos';

/** Quantos produtos aparecem antes de "mais produtos". */
const PRODUTOS_VISIVEIS = 12;
/** Espera depois da última tecla antes de buscar. */
const ESPERA_DA_BUSCA_MS = 300;

/**
 * "Já compraram…": os produtos que mais gente comprou, com busca pelo nome.
 * Cada ficha é um público — o número é exatamente quem aparece ao clicar (só
 * quem pode receber). Carrega à parte do resto dos públicos: numa loja grande
 * a lista demora mais, e não segura a tela.
 */
export function ProdutosDaBase({
  selecionado,
  aoEscolher,
}: {
  selecionado: AlvoDePublico | null;
  aoEscolher: (alvo: AlvoDePublico) => void;
}) {
  const [busca, setBusca] = useState('');
  const [produtos, setProdutos] = useState<ProdutoDaBase[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [todos, setTodos] = useState(false);
  /** Houve algum produto sem busca? Sem nenhum, a seção nem aparece. */
  const [temProdutos, setTemProdutos] = useState<boolean | null>(null);
  // Só a resposta da ÚLTIMA busca vale: a de uma tecla antiga pode chegar depois.
  const ultimaBusca = useRef(0);

  const termo = busca.replace(/\s+/g, ' ').trim();

  useEffect(() => {
    const numero = ++ultimaBusca.current;
    setCarregando(true);
    const espera = setTimeout(
      () => {
        servico
          .produtos(termo || undefined)
          .then((r) => {
            if (numero !== ultimaBusca.current) return;
            setErro('');
            setProdutos(r.produtos);
            setTodos(false);
            if (!termo) setTemProdutos(r.produtos.length > 0);
          })
          .catch((e) => {
            if (numero !== ultimaBusca.current) return;
            setErro(mensagemDoErro(e));
          })
          .finally(() => {
            if (numero === ultimaBusca.current) setCarregando(false);
          });
      },
      termo ? ESPERA_DA_BUSCA_MS : 0,
    );
    return () => clearTimeout(espera);
  }, [termo]);

  if (temProdutos === false && !termo) return null;
  if (temProdutos === null && !erro) return null;

  const lista = produtos ?? [];
  const visiveis = todos ? lista : lista.slice(0, PRODUTOS_VISIVEIS);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-tinta-suave">
          Já compraram <span className="font-normal normal-case tracking-normal">— os produtos que mais gente pediu</span>
        </h3>
        <Input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar produto"
          aria-label="Buscar produto"
          maxLength={80}
          className="w-full sm:w-64"
        />
      </div>

      {erro && <Alerta tom="erro">{erro}</Alerta>}

      <div aria-live="polite" aria-busy={carregando}>
        {termo && !carregando && lista.length === 0 && !erro ? (
          <p className="text-sm text-tinta-suave">
            Nenhum produto com &ldquo;{termo}&rdquo; entre as compras de quem pode receber.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {visiveis.map((p) => (
              <li key={p.nome} className="max-w-full">
                <Ficha
                  ativa={selecionado?.publico === 'produto' && selecionado.valor === p.nome}
                  onClick={() =>
                    aoEscolher({ publico: 'produto', valor: p.nome, nome: `Já compraram ${p.nome}`, total: p.total })
                  }
                  rotulo={p.nome}
                  total={p.total}
                />
              </li>
            ))}
            {lista.length > PRODUTOS_VISIVEIS && (
              <li>
                <button
                  type="button"
                  onClick={() => setTodos((v) => !v)}
                  aria-expanded={todos}
                  className="rounded-full px-3 py-1.5 text-sm font-medium text-acento-forte underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento"
                >
                  {todos ? 'Mostrar menos' : `Mais ${lista.length - PRODUTOS_VISIVEIS} produtos`}
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
