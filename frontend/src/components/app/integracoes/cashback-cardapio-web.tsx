'use client';

import Link from 'next/link';

import { Numero } from '@/components/app/integracoes/compras-cardapio-web';
import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { formatarDataHora, formatarNumero, formatarReais } from '@/lib/formato';
import type { SituacaoCardapioWeb } from '@/lib/tipos';

/**
 * O cashback dos clientes: lido junto com a importação e, depois, todo dia às
 * 4h (no fuso da conta). Mostra quantos têm saldo que vale hoje, quantos vencem
 * em até 7 dias, a soma e quando foi a última leitura — e para onde isso vai
 * (os públicos e as variáveis da campanha).
 */
export function CashbackCardapioWeb({ situacao: s }: { situacao: SituacaoCardapioWeb }) {
  const c = s.saldos;
  // API mais antiga que a tela, ou loja que ainda não importou os clientes: nada a mostrar.
  if (!c || s.sincronizacao.status === 'parada') return null;
  const selo = c.lendo
    ? { texto: 'Lendo', tom: 'acento' as const }
    : c.erro
      ? { texto: 'Parou', tom: 'atencao' as const }
      : c.ultimaLeitura
        ? { texto: 'Em dia', tom: 'sucesso' as const }
        : { texto: 'Aguardando', tom: 'neutro' as const };

  return (
    <section aria-labelledby="cashback-cw" className="space-y-3 rounded-card border border-borda p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="cashback-cw" className="text-sm font-semibold text-tinta">
          Cashback
        </h3>
        <Badge tom={selo.tom} ponto={!c.lendo} vivo={c.lendo}>
          {selo.texto}
        </Badge>
      </div>

      {c.ultimaLeitura ? (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Numero rotulo="Clientes com cashback" valor={formatarNumero(c.comCashback)} />
          <Numero rotulo="Vencem em até 7 dias" valor={formatarNumero(c.vencendo)} />
          <Numero rotulo="Cashback na base" valor={formatarReais(c.totalCentavos)} />
        </dl>
      ) : (
        <p className="text-sm leading-relaxed text-tinta-suave">
          O saldo de cashback de cada cliente vem com a importação e é relido todo dia às 4h da manhã.
        </p>
      )}

      {c.erro && <Alerta tom="atencao">{c.erro}</Alerta>}

      <p className="text-xs leading-relaxed text-tinta-suave">
        {c.ultimaLeitura ? `Última leitura em ${formatarDataHora(c.ultimaLeitura)}. ` : ''}
        {c.proximaLeitura ? `Próxima: ${formatarDataHora(c.proximaLeitura)}. ` : ''}A cada pedido novo, o saldo de
        quem comprou é relido. Use os públicos <strong>Têm cashback</strong> e{' '}
        <strong>Cashback vence em até 7 dias</strong> em{' '}
        <Link href="/contatos" className="font-medium text-acento-forte underline-offset-2 hover:underline">
          Contatos
        </Link>{' '}
        e as variáveis <strong>Saldo do cashback</strong> e <strong>Validade do cashback</strong> na campanha — que só
        vai para quem tem saldo.
      </p>
    </section>
  );
}
