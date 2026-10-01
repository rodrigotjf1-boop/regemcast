'use client';

import Link from 'next/link';

import { Numero } from '@/components/app/integracoes/compras-cardapio-web';
import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatarData, formatarDataHora, formatarNumero } from '@/lib/formato';
import type { SituacaoRegem, StatusRegem } from '@/lib/tipos';

const SELO: Record<StatusRegem, { texto: string; tom: 'neutro' | 'acento' | 'sucesso' | 'erro' }> = {
  parado: { texto: 'Não buscadas', tom: 'neutro' },
  carga: { texto: 'Lendo o histórico', tom: 'acento' },
  em_dia: { texto: 'Em dia', tom: 'sucesso' },
  falhou: { texto: 'Parou', tom: 'erro' },
};

/**
 * As compras: as vendas de cada cliente nos últimos 3 anos, que viram os
 * totais do contato (pedidos, gasto, primeira e última compra) e alimentam os
 * perfis da base. Começam quando os clientes terminam; depois, as vendas
 * novas e as canceladas chegam a cada 30 minutos.
 */
export function ComprasRegem({
  situacao: s,
  ehDono,
  ocupado,
  aoAtualizar,
}: {
  situacao: SituacaoRegem;
  ehDono: boolean;
  ocupado: boolean;
  aoAtualizar: () => void;
}) {
  const p = s.pedidos;
  const selo = SELO[p.status];

  return (
    <section aria-labelledby="compras-regem" className="space-y-3 rounded-card border border-borda p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="compras-regem" className="text-sm font-semibold text-tinta">
          Compras
        </h3>
        <Badge tom={selo.tom} ponto={p.status !== 'carga'} vivo={p.status === 'carga'}>
          {selo.texto}
        </Badge>
      </div>

      {p.status === 'parado' && (
        <p className="text-sm leading-relaxed text-tinta-suave">
          As vendas dos últimos 3 anos, cliente por cliente: quanto gastou, quantas vezes comprou, a primeira e a última
          compra, o bairro e o que pediu.{' '}
          {s.clientes.status === 'carga'
            ? 'Começam assim que a leitura dos clientes terminar.'
            : 'Vêm depois da importação dos clientes.'}
        </p>
      )}

      {p.status === 'carga' && (
        <div className="space-y-2" role="status">
          <p className="text-sm leading-relaxed text-tinta">
            Lendo as vendas dos últimos 3 anos. Pode fechar esta tela: a leitura continua no servidor.
          </p>
          <p className="numerico text-xs text-tinta-suave">
            {formatarNumero(p.lidos)} vendas lidas · {formatarNumero(p.compras)} compras de {formatarNumero(p.clientes)}{' '}
            clientes até agora
          </p>
          {p.erro && <Alerta tom="atencao">{p.erro}</Alerta>}
        </div>
      )}

      {p.status === 'em_dia' && (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-3">
            <Numero rotulo="Compras" valor={formatarNumero(p.compras)} />
            <Numero rotulo="Clientes que compraram" valor={formatarNumero(p.clientes)} />
            <Numero rotulo="Primeira compra" valor={formatarData(p.primeira)} />
            <Numero rotulo="Última compra" valor={formatarData(p.ultima)} />
          </dl>
          {p.compras === 0 && (
            <p className="text-sm leading-relaxed text-tinta-suave">
              Nenhuma venda virou compra ainda: entram só as dos canais da sua empresa, com telefone.
            </p>
          )}
          {p.erro && <Alerta tom="atencao">{p.erro}</Alerta>}
          <p className="text-xs leading-relaxed text-tinta-suave">
            Atualizado em {formatarDataHora(p.ultimaConsulta)}. As vendas novas chegam a cada 30 minutos, e os totais de
            cada cliente aparecem em{' '}
            <Link href="/contatos" className="font-medium text-acento-forte underline-offset-2 hover:underline">
              Contatos
            </Link>{' '}
            e nos perfis da base.
          </p>
          {ehDono && (
            <Button variante="secundario" tamanho="sm" onClick={aoAtualizar} carregando={ocupado}>
              Atualizar agora
            </Button>
          )}
        </div>
      )}

      {p.status === 'falhou' && (
        <div className="space-y-3">
          <Alerta tom="erro">{p.erro ?? 'A leitura das vendas parou.'}</Alerta>
          {ehDono && (
            <Button onClick={aoAtualizar} carregando={ocupado}>
              Tentar de novo
            </Button>
          )}
        </div>
      )}

      {p.status !== 'parado' && (
        <p className="border-t border-borda pt-3 text-xs leading-relaxed text-tinta-suave">
          Ficam de fora as vendas do iFood e dos outros marketplaces (a 99, só com a sua autorização), as sem telefone e
          as de quem pediu para não receber mensagens. Venda cancelada sai das compras.
        </p>
      )}
    </section>
  );
}
