'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { mensagemDoErro } from './api';

export interface Carga<T> {
  dados: T | null;
  erro: string | null;
  carregando: boolean;
  recarregar: () => Promise<void>;
}

/**
 * Uma leitura da API com os três estados que toda tela precisa distinguir:
 * carregando, falhou (com o motivo) e pronto.
 *
 * Cada bloco de uma tela usa a SUA carga. Se o painel lesse tudo numa chamada
 * só, a Meta fora do ar apagaria também o consumo do plano, que não depende
 * dela — e a pessoa veria a tela inteira em erro por causa de um cartão.
 *
 * Se a leitura falha, `dados` volta a nulo: dado que não pôde ser relido não
 * vale como verdade, e a tela mostra o erro em vez do número velho.
 */
export function useCarga<T>(ler: () => Promise<T>, ativo = true): Carga<T> {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(ativo);
  const vivo = useRef(true);
  const leitor = useRef(ler);
  leitor.current = ler;

  const recarregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await leitor.current();
      if (vivo.current) setDados(r);
    } catch (falha) {
      if (!vivo.current) return;
      setDados(null);
      setErro(mensagemDoErro(falha));
    } finally {
      if (vivo.current) setCarregando(false);
    }
  }, []);

  useEffect(() => {
    vivo.current = true;
    if (ativo) void recarregar();
    else setCarregando(false);
    return () => {
      vivo.current = false;
    };
  }, [ativo, recarregar]);

  return { dados, erro, carregando, recarregar };
}
