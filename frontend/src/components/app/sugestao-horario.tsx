'use client';

import { Button } from '@/components/ui/button';
import { formatarNumero } from '@/lib/formato';
import { NOME_DO_PERIODO, QUANDO_PEDE, horaCurta } from '@/lib/periodos';
import type { SugestaoDeHorario } from '@/lib/tipos';

/**
 * Em que período do dia o público escolhido costuma pedir e a janela de envio
 * sugerida — a mensagem chega pouco antes do pedido. "Usar das 17h às 19h"
 * preenche o "Das / Até" da janela de envio, que continua editável.
 *
 * Os números vêm da prévia do público (`POST /campanhas/previa`). Sem gente
 * suficiente com compra, fica calada: uma porcentagem de meia dúzia de
 * pessoas engana mais do que ajuda.
 */
export function SugestaoHorario({
  dados,
  janelaAtual,
  aoUsar,
}: {
  dados: SugestaoDeHorario | null;
  /** O "Das / Até" de agora, para dizer quando a sugestão já está aplicada. */
  janelaAtual: { ativa: boolean; inicio: string; fim: string };
  aoUsar: (inicio: string, fim: string) => void;
}) {
  if (!dados || dados.comHabito === 0) return null;
  const { sugestao } = dados;

  if (!sugestao) {
    // Pouca gente com compra: nada a dizer. Gente suficiente, mas espalhada pelo dia: diz isso.
    if (dados.comHabito < dados.minimo) return null;
    const partes = dados.periodos
      .slice(0, 3)
      .map((p) => `${NOME_DO_PERIODO[p.periodo]} ${Math.floor((p.total / dados.comHabito) * 100)}%`);
    return (
      <p className="rounded-lg border border-borda bg-superficie-2 p-3 text-xs leading-relaxed text-tinta">
        Quem já comprou neste público pede em horários variados ({partes.join(', ')}). Nenhum período se destaca para
        sugerir um horário de envio.
      </p>
    );
  }

  const aplicada = janelaAtual.ativa && janelaAtual.inicio === sugestao.inicio && janelaAtual.fim === sugestao.fim;
  const faixa = `das ${horaCurta(sugestao.inicio)} às ${horaCurta(sugestao.fim)}`;

  return (
    <div className="space-y-2 rounded-lg border border-borda bg-superficie-2 p-3 text-xs leading-relaxed text-tinta">
      <p>
        <strong className="numerico">{sugestao.percentual}%</strong> de quem já comprou neste público costuma pedir{' '}
        <strong>{QUANDO_PEDE[sugestao.periodo]}</strong> (
        <span className="numerico">{formatarNumero(dados.comHabito)}</span> com compras de{' '}
        <span className="numerico">{formatarNumero(dados.total)}</span>). Para a mensagem chegar antes do pedido,
        envie {faixa}.
      </p>
      {aplicada ? (
        <p className="font-medium text-acento-forte">Horário aplicado na janela de envio abaixo.</p>
      ) : (
        <Button tamanho="sm" variante="secundario" onClick={() => aoUsar(sugestao.inicio, sugestao.fim)}>
          Usar {faixa}
        </Button>
      )}
    </div>
  );
}
