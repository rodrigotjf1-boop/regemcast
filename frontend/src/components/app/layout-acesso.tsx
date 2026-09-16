import Link from 'next/link';
import type { ReactNode } from 'react';

import { IconeCheck } from '@/components/app/icones';
import { CenaDisparo } from '@/components/marca/cena-disparo';
import { Logotipo } from '@/components/marca/logotipo';

/**
 * Moldura das telas de acesso: entrar, lista de espera e convite.
 *
 * Metade marca, metade formulário. O lado escuro é a primeira impressão do
 * produto — mostra a campanha saindo em vez de descrever o que ela faz. O lado
 * claro é só o formulário, sem distração: é ali que a pessoa tem uma tarefa.
 *
 * No celular a cena sai (não cabe sem empurrar o formulário para baixo da
 * dobra) e fica uma faixa com a marca e a frase.
 *
 * O descritor da integração é o EXATO que o kit manda usar com a Meta.
 */

const PONTOS = [
  'Modelos conferidos nas regras da Meta antes do envio',
  'Cada mensagem com o seu estado: enviada, entregue, lida',
  'Janela de envio e ritmo que protegem o seu número',
];

export function LayoutAcesso({
  titulo,
  descricao,
  children,
  rodape,
}: {
  titulo: string;
  descricao?: ReactNode;
  children: ReactNode;
  rodape?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-fundo lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Lado da marca */}
      <section className="relative isolate overflow-hidden bg-lateral text-lateral-tinta">
        <div aria-hidden="true" className="fundo-pontos-claro absolute inset-0 -z-10" />
        <div
          aria-hidden="true"
          className="anima-aurora absolute -left-32 -top-32 -z-10 h-[28rem] w-[28rem] rounded-full bg-acento/[0.12] blur-3xl"
        />
        <div
          aria-hidden="true"
          className="anima-aurora absolute -bottom-40 right-[-20%] -z-10 h-[30rem] w-[30rem] rounded-full bg-realce/[0.08] blur-3xl [animation-delay:-6s]"
        />

        <div className="flex h-full flex-col px-6 py-6 sm:px-10 lg:min-h-screen lg:py-10">
          <Link href="/" aria-label="RegemCast — início" className="w-fit">
            <Logotipo sobreEscuro animado />
          </Link>

          <div className="escalonado mt-6 max-w-lg lg:mt-14">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-acento">
              Integração via API Oficial do WhatsApp Business
            </p>
            <p className="mt-3 text-balance text-2xl font-semibold leading-tight tracking-tight text-lateral-tinta sm:text-4xl">
              Suas campanhas saindo{' '}
              <span className="texto-gradiente-marca">uma a uma</span>, com o registro de cada
              entrega.
            </p>
            <ul className="mt-6 hidden space-y-2.5 sm:block">
              {PONTOS.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-sm text-lateral-suave">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-acento/15 text-acento">
                    <IconeCheck className="h-3.5 w-3.5" />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative mt-12 hidden flex-1 items-center pb-10 lg:flex">
            <CenaDisparo />
          </div>
        </div>
      </section>

      {/* Lado do formulário */}
      <main id="conteudo" className="relative flex items-center justify-center px-4 py-10 sm:px-8">
        <div aria-hidden="true" className="fundo-pontos pointer-events-none absolute inset-0 opacity-60" />
        <div className="anima-entrada relative w-full max-w-md">
          <div className="mb-7 space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-tinta sm:text-3xl">{titulo}</h1>
            {descricao ? <p className="text-sm leading-relaxed text-tinta-suave">{descricao}</p> : null}
          </div>
          <div className="rounded-2xl border border-borda bg-superficie p-6 shadow-flutuante sm:p-7">
            {children}
          </div>
          {rodape ? <div className="mt-6 text-center text-sm text-tinta-suave">{rodape}</div> : null}
        </div>
      </main>
    </div>
  );
}
