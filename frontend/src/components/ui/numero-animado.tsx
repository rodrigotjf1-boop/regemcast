'use client';

import { useEffect, useRef, useState } from 'react';

import { formatarNumero } from '@/lib/formato';

/**
 * Número que conta até o valor.
 *
 * É o movimento que mais comunica "isto é dado vivo": um KPI que sobe de zero
 * até 1.284 diz que alguém acabou de medir. Mas o número final é o que importa,
 * então:
 *
 * - quem pede menos movimento vê o valor direto, sem contagem;
 * - o leitor de tela lê só o valor final (a contagem é `aria-hidden`);
 * - quando o valor muda depois (atualização), conta a partir do anterior, não
 *   do zero — recomeçar do zero a cada 5 s faria a tela piscar.
 */
export function NumeroAnimado({
  valor,
  duracao = 900,
  formatar = formatarNumero,
  className,
}: {
  valor: number;
  duracao?: number;
  formatar?: (n: number) => string;
  className?: string;
}) {
  const [exibido, setExibido] = useState(0);
  const anterior = useRef(0);

  useEffect(() => {
    const semMovimento =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const de = anterior.current;
    anterior.current = valor;

    if (semMovimento || de === valor) {
      setExibido(valor);
      return;
    }

    let quadro = 0;
    const inicio = performance.now();
    const passo = (agora: number) => {
      const t = Math.min(1, (agora - inicio) / duracao);
      // Desacelera no fim: o olho acompanha a chegada, não a largada.
      const suave = 1 - Math.pow(1 - t, 3);
      setExibido(Math.round(de + (valor - de) * suave));
      if (t < 1) quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [valor, duracao]);

  return (
    <span className={className}>
      <span aria-hidden="true">{formatar(exibido)}</span>
      <span className="sr-only">{formatar(valor)}</span>
    </span>
  );
}
