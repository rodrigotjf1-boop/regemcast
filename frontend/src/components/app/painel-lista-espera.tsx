'use client';

import { useCallback, useEffect, useState } from 'react';

import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { EsqueletoLista } from '@/components/ui/esqueleto';
import { mensagemDoErro } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  distribuicao,
  type PaginaListaEspera,
  type PedidoListaEspera,
  type RespostaConviteConsole,
  type StatusListaEspera,
} from '@/lib/servicos';

const STATUS_PEDIDO: Record<StatusListaEspera, { rotulo: string; classe: string }> = {
  aguardando: { rotulo: 'Aguardando', classe: 'bg-realce text-tinta' },
  convidada: { rotulo: 'Convidada', classe: 'bg-acento-suave text-acento-forte' },
  convertida: { rotulo: 'Virou conta', classe: 'bg-sucesso/15 text-sucesso' },
  recusada: { rotulo: 'Recusada', classe: 'bg-superficie-2 text-tinta-suave' },
};

function quando(iso: string | null): string {
  if (!iso) return '—';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

/**
 * Lista de espera no console: quem pediu vaga, em ordem de chegada, com o teto
 * da Meta à vista.
 *
 * O teto da semana aparece ANTES da lista: convidar gasta uma vaga de uma janela
 * de 7 dias, e o operador precisa ver quanto ainda cabe antes de clicar. O link
 * do convite aparece uma única vez — se o e-mail não sair, é por ele que a
 * pessoa recebe.
 */
export function PainelListaEspera() {
  const [filtro, setFiltro] = useState<StatusListaEspera | 'todos'>('aguardando');
  const [pagina, setPagina] = useState<PaginaListaEspera | null>(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ nome: string; resposta: RespostaConviteConsole } | null>(null);
  const [recusando, setRecusando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');

  const carregar = useCallback(async () => {
    setErro('');
    try {
      setPagina(await distribuicao.listaEspera(filtro === 'todos' ? undefined : filtro));
    } catch (e) {
      setErro(mensagemDoErro(e));
    }
  }, [filtro]);

  useEffect(() => {
    setPagina(null);
    void carregar();
  }, [carregar]);

  async function convidar(p: PedidoListaEspera) {
    setErro('');
    setResultado(null);
    setOcupado(p.id);
    try {
      const resposta = await distribuicao.convidar(p.id);
      setResultado({ nome: p.nome, resposta });
      await carregar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado(null);
    }
  }

  async function recusar(id: string) {
    if (!motivo.trim()) {
      setErro('Escreva o motivo da recusa.');
      return;
    }
    setErro('');
    setOcupado(id);
    try {
      await distribuicao.recusar(id, motivo.trim());
      setRecusando(null);
      setMotivo('');
      await carregar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado(null);
    }
  }

  const cap = pagina?.capacidade;
  const opcoes: (StatusListaEspera | 'todos')[] = ['aguardando', 'convidada', 'convertida', 'recusada', 'todos'];

  return (
    <div className="space-y-4">
      {cap ? (
        <div className="anima-entrada rounded-card border border-borda bg-superficie p-4 shadow-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-tinta">Convites nesta janela de 7 dias</p>
            <p className="text-sm text-tinta-suave">
              <span className="numerico text-lg font-semibold text-tinta">{cap.enviados7d}</span> de{' '}
              <span className="numerico">{cap.teto}</span> · {cap.restantes} vaga(s)
            </p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-superficie-2" aria-hidden="true">
            <div
              className={cn(
                'h-full rounded-full',
                cap.restantes === 0 ? 'bg-erro' : cap.restantes <= 2 ? 'bg-realce' : 'bg-acento',
              )}
              style={{ width: `${Math.min(100, (cap.enviados7d / Math.max(cap.teto, 1)) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-tinta-suave">
            Teto da Meta para clientes novos: 10 a cada 7 dias até a Access Verification, 200 depois dela
            (variável TETO_CLIENTES_NOVOS_7D).
            {cap.proximaVagaEm
              ? ` Próxima vaga abre em ${new Date(cap.proximaVagaEm).toLocaleString('pt-BR')}.`
              : ''}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar pedidos">
        {opcoes.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={filtro === o}
            onClick={() => setFiltro(o)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              filtro === o
                ? 'border-transparent bg-acento text-acento-contraste'
                : 'border-borda bg-superficie text-tinta-suave hover:border-acento',
            )}
          >
            {o === 'todos' ? 'Todos' : STATUS_PEDIDO[o].rotulo}
          </button>
        ))}
      </div>

      {erro ? <Alerta tom="erro">{erro}</Alerta> : null}

      {resultado ? (
        <Alerta tom={resultado.resposta.emailEnviado ? 'sucesso' : 'atencao'}>
          <span className="block space-y-2">
            <span className="block font-medium">
              {resultado.resposta.emailEnviado
                ? `Convite enviado por e-mail para ${resultado.nome}.`
                : `Convite emitido para ${resultado.nome}, mas o e-mail NÃO saiu. Mande o link abaixo.`}
            </span>
            <span className="block text-xs">{resultado.resposta.aviso}</span>
            <code className="block break-all rounded bg-superficie p-2 font-mono text-[0.72rem] text-tinta">
              {resultado.resposta.link}
            </code>
          </span>
        </Alerta>
      ) : null}

      {!pagina && !erro ? (
        <EsqueletoLista linhas={4} />
      ) : pagina ? (
        <div className="relative overflow-x-auto rounded-card border border-borda bg-superficie shadow-card">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <caption className="sr-only">Pedidos da lista de espera, em ordem de chegada</caption>
            <thead>
              <tr className="border-b border-borda bg-superficie-2 text-xs uppercase tracking-wide text-tinta-suave">
                <th scope="col" className="px-3 py-2.5 font-medium">Pessoa</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Empresa</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Situação</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Pediu</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {pagina.itens.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-tinta-suave">
                    Nenhum pedido nesta situação.
                  </td>
                </tr>
              )}
              {pagina.itens.map((p) => (
                <tr key={p.id} className="border-b border-borda/60 align-top last:border-0 hover:bg-superficie-2/60">
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-tinta">{p.nome}</p>
                    <p className="text-xs text-tinta-suave">{p.email}</p>
                    {p.telefoneE164 ? (
                      <p className="font-mono text-xs text-tinta-suave">{p.telefoneE164}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-tinta-suave">{p.empresa ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                        STATUS_PEDIDO[p.status].classe,
                      )}
                    >
                      {STATUS_PEDIDO[p.status].rotulo}
                    </span>
                    {p.status === 'convidada' && p.conviteExpiraEm ? (
                      <p className={cn('mt-1 text-xs', p.conviteExpirado ? 'text-erro' : 'text-tinta-suave')}>
                        {p.conviteExpirado
                          ? 'convite vencido'
                          : `vale até ${new Date(p.conviteExpiraEm).toLocaleDateString('pt-BR')}`}
                      </p>
                    ) : null}
                    {p.status === 'recusada' && p.observacao ? (
                      <p className="mt-1 text-xs text-tinta-suave">{p.observacao}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-tinta-suave">{quando(p.criadoEm)}</td>
                  <td className="px-3 py-2.5">
                    {p.status === 'aguardando' || p.status === 'convidada' ? (
                      recusando === p.id ? (
                        <div className="ml-auto flex max-w-xs flex-col gap-2">
                          <input
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            placeholder="Motivo da recusa"
                            aria-label="Motivo da recusa"
                            className="rounded-lg border border-borda bg-superficie px-2 py-1.5 text-xs text-tinta"
                            autoFocus
                          />
                          <div className="flex justify-end gap-1.5">
                            <Button tamanho="sm" variante="discreto" onClick={() => setRecusando(null)}>
                              Cancelar
                            </Button>
                            <Button
                              tamanho="sm"
                              variante="perigo"
                              carregando={ocupado === p.id}
                              onClick={() => void recusar(p.id)}
                            >
                              Recusar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button
                            tamanho="sm"
                            carregando={ocupado === p.id}
                            disabled={ocupado !== null || (cap?.restantes === 0 && p.status === 'aguardando')}
                            onClick={() => void convidar(p)}
                          >
                            {p.status === 'convidada' ? 'Reenviar convite' : 'Convidar'}
                          </Button>
                          <Button
                            tamanho="sm"
                            variante="discreto"
                            onClick={() => {
                              setRecusando(p.id);
                              setMotivo('');
                            }}
                          >
                            Recusar
                          </Button>
                        </div>
                      )
                    ) : (
                      <span className="block text-right text-xs text-tinta-suave">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
