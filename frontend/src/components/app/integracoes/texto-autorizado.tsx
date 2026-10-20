'use client';

import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { formatarDataHora } from '@/lib/formato';
import type { AutorizacaoGuardada } from '@/lib/tipos';

/**
 * "Ver o texto que você autorizou": o texto que a página mostrou e a decisão do
 * dono, como ficaram guardados (a prova, com a versão). Num `<dialog>` nativo:
 * o navegador prende o foco, fecha com Esc e escurece o fundo.
 */
export function TextoAutorizado({
  aplicativo,
  autorizacao,
  aberto,
  onFechar,
}: {
  aplicativo: string;
  autorizacao: AutorizacaoGuardada;
  aberto: boolean;
  onFechar: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = autorizacao.texto;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);

  return (
    <dialog
      ref={ref}
      onClose={onFechar}
      aria-labelledby="titulo-texto-autorizado"
      className="max-h-[85vh] w-[min(100%-2rem,34rem)] overflow-y-auto rounded-2xl border border-borda bg-superficie p-0 text-tinta backdrop:bg-lateral/60"
    >
      <div className="grid gap-4 p-5 sm:p-6">
        <header className="grid gap-1">
          <h2 id="titulo-texto-autorizado" className="text-lg font-bold">
            O texto que você autorizou
          </h2>
          <p className="text-sm text-tinta-suave">
            Versão {autorizacao.versao} · confirmado com a senha em {formatarDataHora(autorizacao.em)}, por {autorizacao.por}.
          </p>
        </header>

        <div className="grid gap-3 rounded-xl border border-borda bg-superficie-2 px-4 py-3 text-[13px] leading-relaxed text-tinta-suave">
          <p>
            <strong className="font-semibold text-tinta">{t.titulo}.</strong> Quem pediu: {aplicativo}, aplicativo de {t.aplicativo.empresa} (CNPJ {t.aplicativo.cnpj}),
            pela conta {t.contaQuePede.nome} ({t.contaQuePede.cnpj ? `CNPJ ${t.contaQuePede.cnpj}` : 'sem CNPJ'}, {t.contaQuePede.email}).
          </p>
          {t.confirmouOutraEmpresa ? <p>Você confirmou ligar a conta de outra empresa.</p> : null}
          <div>
            <p className="font-semibold text-tinta">Necessárias</p>
            <ul className="list-disc pl-5">
              {t.necessarias.map((p) => (
                <li key={p.id}>
                  {p.rotulo}: {p.frase}
                </li>
              ))}
            </ul>
          </div>
          {t.opcionais.length ? (
            <div>
              <p className="font-semibold text-tinta">Você decidiu</p>
              <ul className="list-disc pl-5">
                {t.opcionais.map((p) => (
                  <li key={p.id}>
                    {p.rotulo}: {p.ligada ? 'ligada' : 'desligada'}.
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <p className="font-semibold text-tinta">Não pode</p>
            <ul className="list-disc pl-5">
              {t.naoPode.map((n) => (
                <li key={n.rotulo}>{n.rotulo}.</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="button" variante="secundario" onClick={onFechar}>
            Fechar
          </Button>
        </div>
      </div>
    </dialog>
  );
}
