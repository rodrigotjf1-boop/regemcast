'use client';

import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';

/**
 * Cena de demonstração: uma campanha saindo.
 *
 * Mostra o produto funcionando antes de a pessoa entrar — a mensagem chega no
 * celular, a fila avança contato a contato, e cada um passa por enviada →
 * entregue → lida. É o que o Regemcast faz, encenado em oito segundos.
 *
 * É ENCENAÇÃO, e diz isso: o selo "Demonstração" fica visível, e nomes e
 * números são fictícios. Número inventado passando por dado real seria mentir
 * na primeira tela.
 *
 * Com `prefers-reduced-motion`, a cena para no quadro final (todos lidos) em vez
 * de rodar em loop.
 */

const CONTATOS = ['Ana Souza', 'Bruno Lima', 'Carla Reis', 'Diego Alves', 'Elisa Prado'];

type Estado = 'fila' | 'enviada' | 'entregue' | 'lida';

const ESTADOS: Estado[] = ['fila', 'enviada', 'entregue', 'lida'];

const ROTULO: Record<Estado, string> = {
  fila: 'na fila',
  enviada: 'enviada',
  entregue: 'entregue',
  lida: 'lida',
};

const TOM: Record<Estado, string> = {
  fila: 'bg-white/5 text-lateral-suave border-white/10',
  enviada: 'bg-white/10 text-lateral-tinta border-white/15',
  entregue: 'bg-realce/20 text-realce border-realce/40',
  lida: 'bg-acento/20 text-acento border-acento/50',
};

/** Quantos passos a cena tem antes de recomeçar. */
const PASSOS = CONTATOS.length + ESTADOS.length + 3;

/** Em que estado está o contato `i` no passo `p`: cada um sai um passo depois do anterior. */
function estadoNoPasso(i: number, p: number): Estado {
  const indice = Math.max(0, Math.min(ESTADOS.length - 1, p - i));
  return ESTADOS[indice];
}

export function CenaDisparo({ className }: { className?: string }) {
  const [passo, setPasso] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setPasso(PASSOS - 1);
      return;
    }
    const t = setInterval(() => setPasso((p) => (p + 1) % PASSOS), 900);
    return () => clearInterval(t);
  }, []);

  const estados = CONTATOS.map((_, i) => estadoNoPasso(i, passo));
  const lidas = estados.filter((e) => e === 'lida').length;
  const saiu = estados.filter((e) => e !== 'fila').length;
  const primeiro = estados[0];

  return (
    <div aria-hidden="true" className={cn('relative mx-auto h-[27rem] w-full max-w-lg select-none', className)}>
      {/* Celular */}
      <div className="anima-flutuar absolute left-2 top-0 z-10 w-[15.5rem] rounded-[2.4rem] border border-white/15 bg-[#0E0914] p-2.5 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8)]">
        <div className="overflow-hidden rounded-[1.9rem] bg-[#161021]">
          <div className="flex items-center gap-2.5 border-b border-white/5 bg-white/[0.03] px-4 pb-3 pt-5">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-acento text-[0.65rem] font-bold text-acento-contraste">
              LJ
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-lateral-tinta">Sua loja</p>
              <p className="text-[0.6rem] text-lateral-suave">conta comercial</p>
            </div>
          </div>

          <div className="fundo-pontos-claro flex min-h-[15rem] flex-col justify-end gap-2 px-3 py-4">
            <p className="mx-auto rounded-full bg-white/5 px-2.5 py-0.5 text-[0.58rem] text-lateral-suave">
              hoje
            </p>
            {primeiro !== 'fila' ? (
              <div className="anima-surgir max-w-[88%] rounded-2xl rounded-tl-md bg-white/[0.08] p-2.5">
                <div className="mb-2 h-16 rounded-lg bg-gradient-to-br from-acento/70 via-realce/60 to-acento/30" />
                <p className="text-[0.7rem] leading-snug text-lateral-tinta">
                  Olá, Ana! Sua oferta de sexta chegou: 20% em toda a loja até domingo.
                </p>
                <p className="mt-1 flex items-center justify-end gap-1 text-[0.55rem] text-lateral-suave">
                  10:24
                  <Checks estado={primeiro} />
                </p>
                <div className="mt-2 border-t border-white/10 pt-1.5 text-center text-[0.68rem] font-medium text-acento">
                  Ver oferta
                </div>
              </div>
            ) : (
              <div className="flex gap-1 self-start rounded-2xl bg-white/[0.06] px-3 py-2.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-lateral-suave"
                    style={{ animationDelay: `${i * 120}ms` }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fila de envio */}
      <div className="absolute bottom-6 right-0 z-20 w-[16.5rem] rounded-2xl border border-white/10 bg-lateral-2/90 p-3.5 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.9)] backdrop-blur-md ">
        <div className="mb-2.5 flex items-center justify-between">
          <p className="text-xs font-semibold text-lateral-tinta">Campanha de sexta</p>
          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[0.55rem] uppercase tracking-wider text-lateral-suave">
            Demonstração
          </span>
        </div>

        <ul className="space-y-1.5">
          {CONTATOS.map((nome, i) => (
            <li key={nome} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 text-[0.5rem] font-semibold text-lateral-tinta">
                  {nome.split(' ').map((p) => p[0]).join('')}
                </span>
                <span className="truncate text-[0.7rem] text-lateral-tinta">{nome}</span>
              </span>
              <span
                className={cn(
                  'rounded-full border px-1.5 py-px text-[0.58rem] font-medium transition-colors duration-500',
                  TOM[estados[i]],
                )}
              >
                {ROTULO[estados[i]]}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex items-center justify-between text-[0.6rem] text-lateral-suave">
          <span>
            <span className="numerico text-lateral-tinta">{saiu}</span>/{CONTATOS.length} enviadas
          </span>
          <span>
            <span className="numerico text-acento">{lidas}</span> lidas
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-acento to-realce transition-[width] duration-700 ease-out"
            style={{ width: `${(saiu / CONTATOS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Pulso no chão da cena */}
      <svg viewBox="0 0 400 60" className="absolute -bottom-6 left-0 -z-0 w-full opacity-60" fill="none">
        <path
          d="M0 30H120L140 12L160 48L180 4L200 56L220 22L240 30H400"
          stroke="rgb(var(--cor-acento))"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="anima-pulso-traco"
        />
      </svg>
    </div>
  );
}

/** Os tiques do WhatsApp: um (enviada), dois (entregue), dois na cor (lida). */
function Checks({ estado }: { estado: Estado }) {
  const cor = estado === 'lida' ? 'text-acento' : 'text-lateral-suave';
  return (
    <svg viewBox="0 0 18 10" className={cn('h-2.5 w-4 transition-colors duration-500', cor)} fill="none">
      <path d="M1 5.5 4 8.5 10 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      {estado !== 'enviada' ? (
        <path d="M7 8.5 13 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      ) : null}
    </svg>
  );
}
