'use client';

import { useEffect, useState } from 'react';

import { NumeroAnimado } from '@/components/ui/numero-animado';
import { formatarNumero, percentual } from '@/lib/formato';

/**
 * O consumo do ciclo num anel.
 *
 * Feito para a faixa escura do painel: o traço enche até o percentual quando a
 * tela abre, e muda para amarelo a partir de 80% e para vermelho no teto — a
 * cor avisa antes de a pessoa ler o número.
 */
export function AnelUso({ usado, teto }: { usado: number; teto: number | null }) {
  const pct = teto ? percentual(usado, teto) : 0;
  const [cheio, setCheio] = useState(0);

  useEffect(() => {
    // Um quadro depois de montar, para a transição do traço acontecer.
    const q = requestAnimationFrame(() => setCheio(pct));
    return () => cancelAnimationFrame(q);
  }, [pct]);

  const raio = 52;
  const volta = 2 * Math.PI * raio;
  const cor =
    pct >= 100 ? 'rgb(var(--cor-erro))' : pct >= 80 ? 'rgb(var(--cor-realce))' : 'rgb(var(--cor-acento))';

  return (
    <div
      role="meter"
      aria-label="Disparos usados no ciclo"
      aria-valuemin={0}
      aria-valuemax={teto ?? undefined}
      aria-valuenow={usado}
      aria-valuetext={
        teto
          ? `${formatarNumero(usado)} de ${formatarNumero(teto)} disparos usados`
          : `${formatarNumero(usado)} disparos, sem teto definido`
      }
      className="relative grid h-40 w-40 shrink-0 place-items-center"
    >
      <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={raio} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="9" />
        <circle
          cx="60"
          cy="60"
          r={raio}
          fill="none"
          stroke={cor}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={volta}
          strokeDashoffset={volta - (volta * (teto ? Math.max(cheio, usado > 0 ? 1.5 : 0) : 0)) / 100}
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.2, 0.7, 0.2, 1)' }}
        />
      </svg>
      <div className="text-center" aria-hidden="true">
        <NumeroAnimado valor={usado} className="numerico block text-3xl font-semibold text-lateral-tinta" />
        <span className="block text-[0.7rem] text-lateral-suave">
          {teto ? `de ${formatarNumero(teto)}` : 'disparos'}
        </span>
        {teto ? <span className="numerico mt-0.5 block text-xs font-semibold text-acento">{pct}%</span> : null}
      </div>
    </div>
  );
}
