'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { FormularioCampanha } from '@/components/app/formulario-campanha';
import {
  IconeCampanha,
  IconeFechar,
  IconeMais,
  IconeModelo,
  IconeSetaDireita,
} from '@/components/app/icones';
import { BadgeCampanha, BarraStatus } from '@/components/app/status-campanha';
import { CabecalhoPagina } from '@/components/ui/cabecalho-pagina';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { EsqueletoLista } from '@/components/ui/esqueleto';
import { EstadoErro } from '@/components/ui/estado-erro';
import { mensagemDoErro } from '@/lib/api';
import { formatarData, formatarNumero } from '@/lib/formato';
import { campanhas } from '@/lib/servicos';
import type { ResumoCampanha } from '@/lib/tipos';

/**
 * Campanhas.
 *
 * A tela separa **montar** de **disparar**, e isso não é preciosismo: a
 * campanha é gravada antes de qualquer mensagem sair, então um erro no meio do
 * envio deixa o registro de pé — dá para ver o que ia ser enviado, o que saiu e
 * o que falhou. Fazer os dois no mesmo clique significa que um erro no fim
 * apaga o registro de mensagens que já foram cobradas.
 *
 * Por enquanto o disparo acontece no próprio request, com teto de
 * destinatários. É limite de arquitetura, não de produto — some quando a fila
 * entrar —, e aparece na tela como número, não como surpresa.
 */

export default function PaginaCampanhas() {
  const [lista, setLista] = useState<ResumoCampanha[] | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [montando, setMontando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      setLista(await campanhas.listar());
    } catch (e) {
      setErro(mensagemDoErro(e));
      setLista(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Chegou pelo atalho "Nova campanha" do painel: já abre a montagem.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('nova') === '1') setMontando(true);
  }, []);

  const saindo = lista?.filter((c) => c.status === 'enviando' || c.status === 'agendada').length ?? 0;

  return (
    <div className="space-y-6 lg:space-y-8">
      <CabecalhoPagina
        icone={<IconeCampanha />}
        sobretitulo={
          lista && lista.length > 0
            ? `${lista.length} ${lista.length === 1 ? 'campanha' : 'campanhas'}${saindo ? ` · ${saindo} saindo agora` : ''}`
            : 'Operação'
        }
        titulo="Campanhas"
        descricao="Cada campanha usa um modelo aprovado e mostra, por pessoa, o que de fato aconteceu com a mensagem."
        acao={
          <Button
            variante={montando ? 'secundario' : 'primario'}
            onClick={() => setMontando((v) => !v)}
            aria-expanded={montando}
          >
            {montando ? <IconeFechar /> : <IconeMais />}
            {montando ? 'Cancelar' : 'Nova campanha'}
          </Button>
        }
      />

      {montando && (
        <FormularioCampanha
          aoConcluir={() => {
            setMontando(false);
            void carregar();
          }}
        />
      )}

      {carregando && <EsqueletoLista linhas={4} />}

      {!carregando && erro && (
        <EstadoErro
          titulo="Não consegui carregar suas campanhas"
          mensagem={erro}
          aoTentarDeNovo={() => void carregar()}
        />
      )}

      {!carregando && !erro && lista?.length === 0 && !montando && (
        <EmptyState
          icone={<IconeCampanha />}
          titulo="Nenhuma campanha ainda"
          descricao="Monte a primeira escolhendo um modelo aprovado e os números que vão receber."
          acao={
            <Button onClick={() => setMontando(true)}>
              <IconeMais />
              Nova campanha
            </Button>
          }
        />
      )}

      {!carregando && !erro && lista && lista.length > 0 && (
        <ul className="escalonado grid grid-cols-1 gap-4 lg:grid-cols-2">
          {lista.map((c) => (
            <li key={c.id}>
              <CartaoCampanha campanha={c} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CartaoCampanha({ campanha }: { campanha: ResumoCampanha }) {
  const lidas = campanha.porStatus.lida ?? 0;
  const entregues = (campanha.porStatus.entregue ?? 0) + lidas;
  const falhas = campanha.porStatus.falhou ?? 0;
  const base = Math.max(campanha.total, 1);

  return (
    <Link
      href={`/campanhas/${campanha.id}`}
      className="cartao-interativo group flex h-full flex-col gap-4 rounded-card border border-borda bg-superficie p-5 shadow-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-superficie-2 text-tinta-suave transition-colors group-hover:bg-acento group-hover:text-acento-contraste">
            <IconeCampanha className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-tinta">{campanha.nome}</p>
            <p className="flex items-center gap-1.5 truncate text-xs text-tinta-suave">
              <IconeModelo className="h-3.5 w-3.5 shrink-0" />
              <span className="numerico truncate">{campanha.modeloNome}</span>
              <span aria-hidden="true">·</span>
              {campanha.listaNome ? (
                <>
                  <span className="truncate">{campanha.listaNome}</span>
                  <span aria-hidden="true">·</span>
                </>
              ) : null}
              {formatarData(campanha.criadoEm)}
            </p>
          </div>
        </div>
        <BadgeCampanha status={campanha.status} />
      </div>

      <dl className="grid grid-cols-3 gap-2 rounded-xl bg-superficie-2/60 p-3 text-center">
        <div>
          <dt className="text-[0.7rem] text-tinta-suave">Destinatários</dt>
          <dd className="numerico text-lg font-semibold text-tinta">{formatarNumero(campanha.total)}</dd>
        </div>
        <div>
          <dt className="text-[0.7rem] text-tinta-suave">Entregues</dt>
          <dd className="numerico text-lg font-semibold text-tinta">
            {Math.round((entregues / base) * 100)}%
          </dd>
        </div>
        <div>
          <dt className="text-[0.7rem] text-tinta-suave">Falhas</dt>
          <dd className={`numerico text-lg font-semibold ${falhas > 0 ? 'text-erro' : 'text-tinta'}`}>
            {formatarNumero(falhas)}
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex items-end justify-between gap-3">
        <BarraStatus porStatus={campanha.porStatus} total={campanha.total} className="min-w-0 flex-1" />
        <IconeSetaDireita className="h-5 w-5 shrink-0 text-tinta-suave transition-transform group-hover:translate-x-1 group-hover:text-tinta" />
      </div>
    </Link>
  );
}
