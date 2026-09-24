'use client';

import { Fragment, useLayoutEffect, useRef, useState } from 'react';

import { IconeVoltar } from '@/components/app/icones';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatarTelefone, rotuloDoDia } from '@/lib/formato';
import type { ConversaResumo, MensagemDaConversa } from '@/lib/tipos';

import { AdicionarNaLista } from './adicionar-na-lista';
import { BolhaMensagem } from './bolha-mensagem';
import { CaixaResposta } from './caixa-resposta';

/** A que distância do fim ainda conta como "lendo o fim" (e a tela acompanha o que chega). */
const PERTO_DO_FIM_PX = 120;

/**
 * A conversa aberta: quem é, as mensagens e a caixa de resposta.
 *
 * A rolagem respeita quem está lendo: mensagem nova só puxa a tela para baixo
 * se a pessoa já estava no fim. Carregar as anteriores mantém o ponto de
 * leitura no lugar, em vez de pular.
 */
export function PainelConversa({
  conversa,
  mensagens,
  temAnteriores,
  carregandoAnteriores,
  aoCarregarAnteriores,
  aoVoltar,
  aoEnviar,
}: {
  conversa: ConversaResumo;
  mensagens: MensagemDaConversa[];
  temAnteriores: boolean;
  carregandoAnteriores: boolean;
  aoCarregarAnteriores: () => void;
  aoVoltar: () => void;
  aoEnviar: (texto: string) => Promise<boolean>;
}) {
  const [organizando, setOrganizando] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const pertoDoFim = useRef(true);
  const alturaAntes = useRef<number | null>(null);

  const primeiraId = mensagens[0]?.id;
  const ultimaId = mensagens[mensagens.length - 1]?.id;

  // Trocou de conversa: começa no fim.
  useLayoutEffect(() => {
    pertoDoFim.current = true;
    setOrganizando(false);
  }, [conversa.id]);

  // Chegou mensagem nova no fim: acompanha só se a pessoa estava no fim.
  useLayoutEffect(() => {
    const el = caixa.current;
    if (el && pertoDoFim.current) el.scrollTop = el.scrollHeight;
  }, [ultimaId, conversa.id]);

  // Entraram mensagens ANTERIORES no topo: mantém o ponto de leitura.
  useLayoutEffect(() => {
    const el = caixa.current;
    if (el && alturaAntes.current !== null) {
      el.scrollTop += el.scrollHeight - alturaAntes.current;
      alturaAntes.current = null;
    }
  }, [primeiraId]);

  let ultimoDia = '';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-borda px-3 py-2.5">
        <button
          type="button"
          onClick={aoVoltar}
          className="grid h-9 w-9 place-items-center rounded-lg text-tinta-suave hover:bg-superficie-2 md:hidden"
        >
          <IconeVoltar className="h-5 w-5" />
          <span className="sr-only">Voltar para a lista</span>
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-tinta">{conversa.nome ?? formatarTelefone(conversa.telefone)}</h2>
          <p className="numerico truncate text-xs text-tinta-suave">{formatarTelefone(conversa.telefone)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {conversa.optOut ? (
            <Badge tom="atencao">Saiu das promoções</Badge>
          ) : !conversa.contatoId ? (
            <Badge tom="neutro">Fora da sua base</Badge>
          ) : (
            <Button tamanho="sm" variante="secundario" onClick={() => setOrganizando((v) => !v)} aria-expanded={organizando}>
              Adicionar à lista
            </Button>
          )}
        </div>
      </header>

      {organizando && conversa.contatoId && (
        <AdicionarNaLista contatoId={conversa.contatoId} aoFechar={() => setOrganizando(false)} />
      )}

      <div
        ref={caixa}
        onScroll={(e) => {
          const el = e.currentTarget;
          pertoDoFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < PERTO_DO_FIM_PX;
        }}
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-superficie-2/50 px-3 py-4"
        aria-live="polite"
        aria-relevant="additions"
      >
        {temAnteriores && (
          <div className="flex justify-center pb-2">
            <Button
              tamanho="sm"
              variante="secundario"
              carregando={carregandoAnteriores}
              onClick={() => {
                alturaAntes.current = caixa.current?.scrollHeight ?? null;
                aoCarregarAnteriores();
              }}
            >
              Carregar mensagens anteriores
            </Button>
          </div>
        )}

        {mensagens.length === 0 && (
          <p className="py-10 text-center text-sm text-tinta-suave">Nenhuma mensagem nesta conversa ainda.</p>
        )}

        {mensagens.map((m) => {
          const dia = rotuloDoDia(m.criadaEm);
          const mostrarDia = dia !== ultimoDia;
          ultimoDia = dia;
          return (
            <Fragment key={m.id}>
              {mostrarDia && (
                <div className="flex justify-center py-2">
                  <span className="rounded-full bg-superficie px-3 py-0.5 text-[11px] font-medium text-tinta-suave shadow-sm">
                    {dia}
                  </span>
                </div>
              )}
              <BolhaMensagem conversaId={conversa.id} m={m} />
            </Fragment>
          );
        })}
      </div>

      <CaixaResposta janelaAteEm={conversa.janelaAteEm} aoEnviar={aoEnviar} />
    </div>
  );
}
