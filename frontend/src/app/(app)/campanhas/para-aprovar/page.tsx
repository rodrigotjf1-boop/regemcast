'use client';

import Link from 'next/link';

import { IconeCampanha, IconeSetaDireita } from '@/components/app/icones';
import { dinheiroNaMoeda } from '@/components/app/teto-do-disparo';
import { Badge } from '@/components/ui/badge';
import { CabecalhoPagina } from '@/components/ui/cabecalho-pagina';
import { EmptyState } from '@/components/ui/empty-state';
import { EsqueletoLista } from '@/components/ui/esqueleto';
import { EstadoErro } from '@/components/ui/estado-erro';
import { nomeDoAplicativo } from '@/lib/aplicativo';
import { formatarData, formatarDataHora, formatarNumero } from '@/lib/formato';
import { aprovacoes } from '@/lib/servicos';
import type { PedidoParaTela } from '@/lib/tipos';
import { useCarga } from '@/lib/use-carga';

/**
 * Campanhas › Para aprovar (Hub DMS, F5 parte B): os disparos que outro produto da DMS pediu e que esperam uma pessoa
 * da conta. Nada sai sem a aprovação, com o código do aplicativo autenticador. Qualquer pessoa da conta vê; quem
 * aprova é o dono, ou quem ele autorizou — conferido no servidor.
 */
export default function PaginaParaAprovar() {
  const carga = useCarga(() => aprovacoes.listar());
  const dados = carga.dados;

  return (
    <div className="space-y-6 lg:space-y-8">
      <CabecalhoPagina
        icone={<IconeCampanha />}
        sobretitulo="Campanhas"
        titulo="Para aprovar"
        descricao="Disparos que outro produto da DMS pediu. Nada sai sem a sua aprovação."
      />

      {carga.carregando && <EsqueletoLista linhas={3} />}

      {!carga.carregando && carga.erro && (
        <EstadoErro titulo="Não consegui carregar os pedidos" mensagem={carga.erro} aoTentarDeNovo={() => void carga.recarregar()} />
      )}

      {!carga.carregando && !carga.erro && dados && (
        <>
          <section aria-labelledby="h-esperam" className="space-y-3">
            <h2 id="h-esperam" className="text-base font-semibold text-tinta">
              Esperando {dados.podeAprovar ? 'você' : 'o dono'} · {dados.esperando.length}
            </h2>
            {dados.esperando.length === 0 ? (
              <EmptyState
                icone={<IconeCampanha />}
                titulo="Nenhum pedido esperando"
                descricao="Quando um produto da DMS, como o Liame, pedir para disparar uma campanha, o pedido aparece aqui, e quem aprova recebe um e-mail."
              />
            ) : (
              <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {dados.esperando.map((p) => (
                  <li key={p.pedido.id}>
                    <CartaoDoPedido item={p} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {dados.decididos.length > 0 && (
            <section aria-labelledby="h-decididos" className="space-y-3">
              <h2 id="h-decididos" className="text-base font-semibold text-tinta">
                Decididos nos últimos 30 dias
              </h2>
              <ul className="divide-y divide-borda rounded-card border border-borda bg-superficie">
                {dados.decididos.map((p) => (
                  <li key={p.pedido.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-start sm:gap-4">
                    <span className="numerico shrink-0 text-xs text-tinta-suave">{formatarData(p.pedido.criado_em)}</span>
                    <span className="min-w-0 text-sm text-tinta">
                      <Link href={`/campanhas/para-aprovar/${p.pedido.id}`} className="font-medium underline-offset-4 hover:underline">
                        {p.plano.nome}
                      </Link>
                      : {fraseDaDecisao(p)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function CartaoDoPedido({ item }: { item: PedidoParaTela }) {
  const quem = nomeDoAplicativo(item.plano.aplicativo) ?? item.plano.aplicativo;
  const custo = item.plano.custo.estimadoCentavos;
  return (
    <Link
      href={`/campanhas/para-aprovar/${item.pedido.id}`}
      className="cartao-interativo group flex h-full items-center gap-4 rounded-card border border-borda bg-superficie p-4 shadow-card"
    >
      <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-superficie-2 text-sm font-bold text-tinta">
        {quem.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block truncate text-base font-semibold text-tinta">{item.plano.nome}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-tinta-suave">
          <span>{quem}</span>
          <span aria-hidden="true">·</span>
          <span className="numerico">
            {formatarNumero(item.plano.publico.aceitaram)} {item.plano.publico.aceitaram === 1 ? 'pessoa' : 'pessoas'}
            {item.plano.continuacao ? (item.plano.publico.aceitaram === 1 ? ' que falta' : ' que faltam') : ''}
          </span>
          {item.plano.continuacao ? (
            <>
              <span aria-hidden="true">·</span>
              <span>continuar depois do teto</span>
            </>
          ) : null}
          {custo !== null ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="numerico">cerca de {dinheiroNaMoeda(custo, item.plano.custo.moeda)}</span>
            </>
          ) : null}
        </span>
        <Badge tom="atencao">vence {formatarDataHora(item.pedido.vence_em)}</Badge>
      </span>
      <IconeSetaDireita className="h-5 w-5 shrink-0 text-tinta-suave transition-transform group-hover:translate-x-1" />
    </Link>
  );
}

/** Uma linha do que aconteceu com o pedido decidido. */
function fraseDaDecisao(p: PedidoParaTela): string {
  const quem = p.decididoPorNome ? ` por ${p.decididoPorNome}` : '';
  switch (p.pedido.situacao) {
    case 'executado':
      return p.pedido.motivo === 'teto-de-gasto' ? `aprovado${quem}; parou no teto de gasto.` : `aprovado${quem} e disparado.`;
    case 'aprovado':
    case 'executando':
      return `aprovado${quem}; o disparo está saindo.`;
    case 'recusado':
      return `recusado${quem}${p.pedido.motivo_da_recusa ? `: "${p.pedido.motivo_da_recusa}"` : ''}.`;
    case 'vencido':
      return 'venceu sem resposta; nada saiu.';
    case 'cancelado':
      return p.pedido.motivo === 'plano-mudou'
        ? 'encerrado: o plano mudou depois do pedido; nada saiu.'
        : 'cancelado antes de sair; nada saiu.';
    default:
      return 'não saiu.';
  }
}
