'use client';

import Link from 'next/link';

import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatarData, formatarDataHora, formatarNumero } from '@/lib/formato';
import type { SituacaoCardapioWeb, StatusPedidosCardapioWeb } from '@/lib/tipos';

const SELO: Record<StatusPedidosCardapioWeb, { texto: string; tom: 'neutro' | 'acento' | 'sucesso' | 'erro' }> = {
  parado: { texto: 'Não buscadas', tom: 'neutro' },
  carga: { texto: 'Buscando histórico', tom: 'acento' },
  em_dia: { texto: 'Em dia', tom: 'sucesso' },
  falhou: { texto: 'Parou', tom: 'erro' },
};

/**
 * As compras: o histórico de pedidos de cada cliente, que vira os totais do
 * contato (pedidos, gasto, primeira e última compra) e alimenta os perfis da
 * base. Primeiro a carga dos últimos 3 anos; depois, os pedidos novos a cada
 * 30 minutos.
 */
export function ComprasCardapioWeb({
  situacao: s,
  ehDono,
  ocupado,
  aoBuscar,
  aoTrocarToken,
}: {
  situacao: SituacaoCardapioWeb;
  ehDono: boolean;
  ocupado: boolean;
  aoBuscar: () => void;
  /** Parou porque o Cardápio Web recusou o token: a saída é um token novo. */
  aoTrocarToken: () => void;
}) {
  const p = s.pedidos;
  const selo = SELO[p.status];
  const esperandoClientes = p.status === 'carga' && s.sincronizacao.status === 'rodando';

  return (
    <section aria-labelledby="compras-cw" className="space-y-3 rounded-card border border-borda p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="compras-cw" className="text-sm font-semibold text-tinta">
          Compras
        </h3>
        <Badge tom={selo.tom} ponto={p.status !== 'carga'} vivo={p.status === 'carga'}>
          {selo.texto}
        </Badge>
      </div>

      {p.status === 'parado' && (
        <>
          <p className="text-sm leading-relaxed text-tinta-suave">
            Os pedidos dos últimos 3 anos, cliente por cliente: quanto gastou, quantas vezes comprou, a primeira
            e a última compra, o bairro e o que pediu.
            {s.sincronizacao.status === 'parada' ? ' Vêm junto com a importação dos clientes.' : ''}
          </p>
          {ehDono && s.sincronizacao.status !== 'parada' && (
            <Button onClick={aoBuscar} carregando={ocupado}>
              Buscar pedidos
            </Button>
          )}
        </>
      )}

      {p.status === 'carga' &&
        (esperandoClientes ? (
          <p className="text-sm leading-relaxed text-tinta-suave">
            A busca dos pedidos começa assim que a importação dos clientes terminar.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-tinta">
              Lendo os pedidos de {formatarData(p.cargaDe)} a {formatarData(p.cargaAte)}. Pode fechar esta tela: a
              busca continua no servidor.
            </p>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-superficie-2"
              role="progressbar"
              aria-label="Busca do histórico de pedidos"
              aria-valuenow={p.progresso}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full rounded-full bg-acento transition-all" style={{ width: `${p.progresso}%` }} />
            </div>
            <p className="numerico text-xs text-tinta-suave">
              {p.progresso}% · {formatarNumero(p.lidos)} pedidos lidos · {formatarNumero(p.compras)} compras de{' '}
              {formatarNumero(p.clientes)} clientes até agora
            </p>
            {p.erro && <Alerta tom="atencao">{p.erro}</Alerta>}
          </div>
        ))}

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
              Nenhum pedido virou compra ainda: entram só os feitos no seu cardápio, com telefone.
            </p>
          )}
          {p.erro && <Alerta tom="atencao">{p.erro}</Alerta>}
          <p className="text-xs leading-relaxed text-tinta-suave">
            Atualizado em {formatarDataHora(p.ultimaConsulta)}. Os pedidos novos chegam a cada 30 minutos, e os
            totais de cada cliente aparecem em{' '}
            <Link href="/contatos" className="font-medium text-acento-forte underline-offset-2 hover:underline">
              Contatos
            </Link>{' '}
            e nos perfis da base.
          </p>
          {ehDono && (
            <Button variante="secundario" tamanho="sm" onClick={aoBuscar} carregando={ocupado}>
              Atualizar agora
            </Button>
          )}
        </div>
      )}

      {p.status === 'falhou' && (
        <div className="space-y-3">
          <Alerta tom="erro">{p.erro ?? 'A busca de pedidos parou.'}</Alerta>
          {ehDono && (
            <>
              <p className="text-xs leading-relaxed text-tinta-suave">
                Se o Cardápio Web recusou o token, troque por um novo: a busca retoma de onde parou. Senão, tente de
                novo — o que já foi guardado não é lido outra vez.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={aoBuscar} carregando={ocupado}>
                  Tentar de novo
                </Button>
                <Button variante="secundario" onClick={aoTrocarToken} disabled={ocupado}>
                  Trocar token
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {p.status !== 'parado' && (
        <p className="border-t border-borda pt-3 text-xs leading-relaxed text-tinta-suave">
          Ficam de fora os pedidos do iFood e de outros marketplaces (o cliente é do marketplace), os sem telefone e
          os de quem pediu para não receber mensagens. Pedido cancelado sai das compras.
        </p>
      )}
    </section>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg bg-superficie-2 px-3 py-2">
      <dt className="text-xs text-tinta-suave">{rotulo}</dt>
      <dd className="numerico text-base font-semibold text-tinta sm:text-lg">{valor}</dd>
    </div>
  );
}
