'use client';

import { useEffect, useState } from 'react';

import { mensagemDoErro } from '@/lib/api';
import { contatos, publicosSalvos } from '@/lib/servicos';
import type { CatalogoDasRegras } from '@/lib/tipos';

/**
 * O catálogo das regras (`GET /publicos-salvos/campos`): os campos, as
 * comparações de cada tipo e o máximo de regras. A tela não guarda lista
 * própria — o servidor é quem confere cada regra, pela mesma lista.
 */
export function useCatalogoDasRegras() {
  const [catalogo, setCatalogo] = useState<CatalogoDasRegras | null>(null);
  const [erro, setErro] = useState('');
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    setErro('');
    publicosSalvos.campos().then(
      (c) => vivo && setCatalogo(c),
      (e) => vivo && setErro(mensagemDoErro(e)),
    );
    return () => {
      vivo = false;
    };
  }, [tentativa]);

  return { catalogo, erro, tentarDeNovo: () => setTentativa((t) => t + 1) };
}

/** As opções que a regra busca na base: os bairros das entregas e os produtos comprados. */
export interface OpcoesDaBase {
  /** `null` = ainda não carregou (ou não foi pedido). */
  bairros: string[] | null;
  produtos: string[] | null;
  erro: string;
}

/**
 * Busca os bairros e os produtos só quando uma regra usa o campo — a maioria
 * das regras é de número e data, e a lista de públicos custa uma consulta.
 */
export function useOpcoesDaBase(precisa: { bairros: boolean; produtos: boolean }): OpcoesDaBase {
  const [bairros, setBairros] = useState<string[] | null>(null);
  const [produtos, setProdutos] = useState<string[] | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!precisa.bairros || bairros !== null) return;
    let vivo = true;
    contatos.publicos().then(
      (r) => vivo && setBairros(r.bairros.map((b) => b.bairro)),
      (e) => {
        if (!vivo) return;
        setBairros([]);
        setErro(mensagemDoErro(e));
      },
    );
    return () => {
      vivo = false;
    };
  }, [precisa.bairros, bairros]);

  useEffect(() => {
    if (!precisa.produtos || produtos !== null) return;
    let vivo = true;
    contatos.produtos().then(
      (r) => vivo && setProdutos(r.produtos.map((p) => p.nome)),
      (e) => {
        if (!vivo) return;
        setProdutos([]);
        setErro(mensagemDoErro(e));
      },
    );
    return () => {
      vivo = false;
    };
  }, [precisa.produtos, produtos]);

  return { bairros, produtos, erro };
}
