import { Card, CardCabecalho, CardCorpo } from '@/components/ui/card';
import { nomeDoAplicativo } from '@/lib/aplicativo';
import { formatarDataHora, formatarReais, percentual } from '@/lib/formato';
import type { TetoDoDisparo } from '@/lib/tipos';

/** Centavos na moeda da conta: reais com o símbolo; outra moeda, com o código dela. */
export function dinheiroNaMoeda(centavos: number, moeda: string | null): string {
  if (!moeda || moeda === 'BRL') return formatarReais(centavos);
  return `${moeda} ${(centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * O teto do disparo que quem aprovou o pedido fixou, e quanto a campanha já gastou dele (Hub DMS, F5 parte B). O gasto
 * sai da MESMA conta que o envio confere antes de cada lote: chegou ao teto, a campanha pausa e não volta sozinha.
 */
export function TetoDoDisparoAprovado({ teto }: { teto: TetoDoDisparo }) {
  const usado = percentual(teto.gastoCentavos, teto.tetoCentavos);
  const quem = nomeDoAplicativo(teto.aplicativo) ?? 'o aplicativo';
  return (
    <Card>
      <CardCabecalho
        titulo="Teto de gasto deste disparo"
        descricao={
          <>
            Pedido pelo {quem}
            {teto.aprovadoPor ? `, aprovado por ${teto.aprovadoPor}` : ''}
            {teto.aprovadoEm ? ` em ${formatarDataHora(teto.aprovadoEm)}` : ''}. Chegou ao teto, o envio para e não volta
            sozinho.
          </>
        }
      />
      <CardCorpo className="space-y-3">
        <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="text-tinta-suave">Gasto até agora</span>
          <span className="numerico font-semibold text-tinta">
            {dinheiroNaMoeda(teto.gastoCentavos, teto.moeda)} de {dinheiroNaMoeda(teto.tetoCentavos, teto.moeda)}
          </span>
        </p>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-superficie-2"
          role="progressbar"
          aria-label="Gasto do teto deste disparo"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={usado}
        >
          <div className={`h-full rounded-full ${usado >= 100 ? 'bg-erro' : usado >= 80 ? 'bg-atencao' : 'bg-acento'}`} style={{ width: `${Math.min(100, usado)}%` }} />
        </div>
        {teto.semComoContar ? (
          <p className="text-sm text-erro" role="status">
            {teto.semComoContar === 'moeda'
              ? 'O envio está parado: a moeda da conta na Meta não é mais a do plano aprovado, e o teto não consegue contar o gasto.'
              : 'O envio está parado: falta a tarifa da Meta para parte das mensagens, e o teto não consegue contar o gasto.'}
          </p>
        ) : null}
      </CardCorpo>
    </Card>
  );
}
