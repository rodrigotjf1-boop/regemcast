'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import {
  IconeAlerta,
  IconeAtualizar,
  IconeCampanha,
  IconeCheck,
  IconeOlho,
  IconeRaio,
  IconeVoltar,
} from '@/components/app/icones';
import { BadgeCampanha, BadgeDestinatario, BarraStatus } from '@/components/app/status-campanha';
import { CabecalhoPagina } from '@/components/ui/cabecalho-pagina';
import { LoaderDisparo } from '@/components/marca/loader-disparo';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Esqueleto, EsqueletoLista } from '@/components/ui/esqueleto';
import { EstadoErro } from '@/components/ui/estado-erro';
import { Estatistica } from '@/components/ui/estatistica';
import { mensagemDoErro } from '@/lib/api';
import { formatarDataHora, formatarNumero } from '@/lib/formato';
import { campanhas } from '@/lib/servicos';
import type { DestinatarioCampanha, ResumoCampanha } from '@/lib/tipos';

/**
 * Uma campanha, pessoa por pessoa.
 *
 * Esta tela existe por um motivo específico: no Regem, uma campanha marca
 * "100% enviada" com 100% das mensagens em `failed`, porque lá "enviado"
 * significa apenas que a Meta aceitou o POST. Aqui os dois fatos aparecem
 * separados, e o motivo real da falha aparece junto de quem falhou.
 *
 * Os estados progridem sozinhos, por webhook, depois do disparo — por isso o
 * botão de atualizar: entregue e lida chegam segundos ou minutos depois.
 */

/** O que cada estado significa, em uma frase. */
const EXPLICACAO_STATUS: Record<string, string> = {
  pendente: 'Ainda não saiu.',
  enviando: 'Saindo agora.',
  enviada: 'A Meta aceitou. Ainda não chegou ao aparelho.',
  entregue: 'Chegou ao aparelho.',
  lida: 'A pessoa abriu.',
  falhou: 'Não foi entregue.',
};

export default function PaginaCampanha() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const [campanha, setCampanha] = useState<ResumoCampanha | null>(null);
  const [destinatarios, setDestinatarios] = useState<DestinatarioCampanha[]>([]);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [disparando, setDisparando] = useState(false);
  const [retomando, setRetomando] = useState(false);
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(async () => {
    if (!id) return;
    setCarregando(true);
    setErro('');
    try {
      const [c, d] = await Promise.all([campanhas.detalhe(id), campanhas.destinatarios(id)]);
      setCampanha(c);
      setDestinatarios(d);
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setCarregando(false);
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /*
   * O envio acontece no servidor, rodada a rodada. Enquanto a campanha está
   * agendada ou saindo, a tela se atualiza sozinha — pedir para a pessoa ficar
   * clicando em "Atualizar" para ver o próprio disparo andar é transferir para
   * ela um trabalho que a tela faz melhor.
   *
   * Silenciosa (sem o esqueleto de carregamento) para não piscar a tabela a
   * cada poucos segundos.
   */
  const emAndamento = campanha?.status === 'agendada' || campanha?.status === 'enviando';
  useEffect(() => {
    if (!emAndamento || !id) return;
    const t = setInterval(async () => {
      try {
        const [c, d] = await Promise.all([campanhas.detalhe(id), campanhas.destinatarios(id)]);
        setCampanha(c);
        setDestinatarios(d);
      } catch {
        /* A próxima volta tenta de novo; um soluço de rede não vira erro na tela. */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [emAndamento, id]);

  async function retomar() {
    setAviso('');
    setErro('');
    setRetomando(true);
    try {
      await campanhas.retomar(id);
      await carregar();
      setAviso('Envio retomado. Quem faltava volta a sair pelo servidor.');
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setRetomando(false);
    }
  }

  async function disparar() {
    setAviso('');
    setErro('');
    setDisparando(true);
    try {
      await campanhas.disparar(id);
      await carregar();
      setAviso(
        'Campanha agendada. As mensagens saem pelo servidor, respeitando a janela e o ritmo que você definiu — esta tela se atualiza sozinha.',
      );
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setDisparando(false);
    }
  }

  if (carregando && !campanha) {
    return (
      <div className="space-y-6" role="status" aria-label="Carregando a campanha">
        <div className="flex items-center gap-4">
          <Esqueleto className="h-12 w-12 rounded-2xl" />
          <div className="space-y-2">
            <Esqueleto className="h-3 w-24" />
            <Esqueleto className="h-7 w-64" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Esqueleto key={i} className="h-32 rounded-card" />
          ))}
        </div>
        <EsqueletoLista linhas={4} />
      </div>
    );
  }

  if (erro && !campanha) {
    return (
      <EstadoErro
        titulo="Não consegui carregar esta campanha"
        mensagem={erro}
        aoTentarDeNovo={() => void carregar()}
      />
    );
  }

  if (!campanha) return null;

  const podeDisparar = campanha.status === 'rascunho';
  const p = campanha.porStatus;
  const lidas = p.lida ?? 0;
  const entregues = (p.entregue ?? 0) + lidas;
  const enviadas = (p.enviada ?? 0) + entregues;
  const falhas = p.falhou ?? 0;
  const base = Math.max(campanha.total, 1);
  const pct = (n: number) => `${Math.round((n / base) * 100)}% de ${formatarNumero(campanha.total)}`;

  return (
    <div className="space-y-6 lg:space-y-8">
      <Link
        href="/campanhas"
        className="group inline-flex items-center gap-1.5 text-sm text-tinta-suave hover:text-tinta"
      >
        <IconeVoltar className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
        Campanhas
      </Link>

      <CabecalhoPagina
        icone={<IconeCampanha />}
        sobretitulo={<BadgeCampanha status={campanha.status} />}
        titulo={campanha.nome}
        descricao={
          <>
            Modelo <span className="numerico text-tinta">{campanha.modeloNome}</span> ·{' '}
            {campanha.modeloIdioma} · criada em {formatarDataHora(campanha.criadoEm)}
          </>
        }
        acao={
          <>
            <Button variante="secundario" onClick={() => void carregar()} carregando={carregando}>
              {carregando ? null : <IconeAtualizar />}
              Atualizar
            </Button>
            {podeDisparar && (
              <Button onClick={() => void disparar()} carregando={disparando}>
                {disparando ? null : <IconeRaio />}
                Disparar agora
              </Button>
            )}
          </>
        }
      />

      {campanha.status === 'enviando' && (
        <div className="anima-entrada relative overflow-hidden rounded-card border border-acento/50 bg-acento-suave p-4 shadow-card">
          <LoaderDisparo rotulo="Enviando. As mensagens saem pelo servidor — você pode fechar esta página." />
        </div>
      )}

      {campanha.status === 'agendada' && (
        <Alerta tom="informacao">
          Agendada. As mensagens começam a sair na próxima abertura da janela de envio.
        </Alerta>
      )}

      {campanha.status === 'pausada' && campanha.pausaMotivo === 'teto_plano' && (
        <Alerta tom="atencao">
          <span className="block">
            Pausada: os disparos do seu plano acabaram neste ciclo. Ninguém foi marcado como falha —
            quem faltava continua na fila e a campanha volta a sair sozinha quando o ciclo virar ou
            quando o plano tiver mais disparos.
          </span>
        </Alerta>
      )}

      {campanha.status === 'pausada' && campanha.pausaMotivo !== 'teto_plano' && (
        <Alerta tom="atencao">
          <span className="block space-y-2">
            <span className="block">
              Pausada: a conexão com o WhatsApp caiu antes de terminar. Ninguém foi marcado como
              falha — quem faltava continua na fila. Reconecte o WhatsApp e retome.
            </span>
            <Button tamanho="sm" onClick={() => void retomar()} carregando={retomando}>
              Retomar envio
            </Button>
          </span>
        </Alerta>
      )}

      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {aviso && <Alerta tom="sucesso">{aviso}</Alerta>}

      {podeDisparar && (
        <Alerta tom="informacao">
          Esta campanha ainda não saiu. Confira os números abaixo antes de disparar — depois não dá
          para desfazer.
        </Alerta>
      )}

      <section aria-label="Resultado" className="escalonado grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Estatistica
          rotulo="Enviadas"
          valor={enviadas}
          tom="neutro"
          icone={<IconeRaio className="h-5 w-5" />}
          apoio={pct(enviadas)}
        />
        <Estatistica
          rotulo="Entregues"
          valor={entregues}
          tom="realce"
          icone={<IconeCheck className="h-5 w-5" />}
          apoio={pct(entregues)}
        />
        <Estatistica
          rotulo="Lidas"
          valor={lidas}
          tom="acento"
          icone={<IconeOlho className="h-5 w-5" />}
          apoio={pct(lidas)}
        />
        <Estatistica
          rotulo="Falhas"
          valor={falhas}
          tom={falhas > 0 ? 'erro' : 'neutro'}
          icone={<IconeAlerta className="h-5 w-5" />}
          apoio={falhas > 0 ? 'Motivo de cada uma na lista abaixo' : 'Nenhuma até agora'}
        />
      </section>

      <Card className="anima-entrada">
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-tinta">Andamento</h2>
            <p className="text-xs text-tinta-suave">
              <span className="numerico text-tinta">{formatarNumero(campanha.total)}</span>{' '}
              {campanha.total === 1 ? 'destinatário' : 'destinatários'}
            </p>
          </div>
          <BarraStatus porStatus={campanha.porStatus} total={campanha.total} />
          {/*
            A distinção que o produto inteiro depende de acertar: "enviada"
            significa que a Meta aceitou, não que a pessoa recebeu.
          */}
          <p className="text-xs leading-relaxed text-tinta-suave">
            <strong className="text-tinta">Enviada</strong> quer dizer que a Meta aceitou a mensagem
            — ainda não que ela chegou. <strong className="text-tinta">Entregue</strong> é a
            confirmação de que chegou ao aparelho, e vem depois, pela própria Meta.{' '}
            <strong className="text-tinta">Lida</strong> só é informada quando a pessoa mantém a
            confirmação de leitura ligada no WhatsApp — o número real de leituras pode ser maior.
          </p>
        </div>
      </Card>

      <section className="anima-entrada overflow-hidden rounded-card border border-borda bg-superficie shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-borda px-5 py-4">
          <h2 className="text-base font-semibold text-tinta">Destinatários</h2>
          {emAndamento ? (
            <span className="inline-flex items-center gap-2 text-xs text-tinta-suave">
              <span className="ponto-vivo h-2 w-2 rounded-full bg-acento text-acento" aria-hidden="true" />
              Atualizando sozinha
            </span>
          ) : null}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">
              Destinatários da campanha, com o estado de entrega de cada um
            </caption>
            <thead>
              <tr className="bg-superficie-2/60 text-xs uppercase tracking-wide text-tinta-suave">
                <th scope="col" className="px-5 py-2.5 font-medium">Telefone</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Estado</th>
                <th scope="col" className="px-5 py-2.5 font-medium">O que aconteceu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {destinatarios.map((d) => (
                <tr key={d.id} className="align-top transition-colors hover:bg-superficie-2/50">
                  <td className="numerico whitespace-nowrap px-5 py-3 text-tinta">{d.telefone}</td>
                  <td className="px-3 py-3">
                    <BadgeDestinatario status={d.status} />
                  </td>
                  <td className="px-5 py-3 text-tinta-suave">
                    {d.status === 'falhou' && d.erroDetalhe ? (
                      <>
                        <span className="font-medium text-erro">{d.erroTitulo}</span>
                        <br />
                        {d.erroDetalhe}
                      </>
                    ) : (
                      (EXPLICACAO_STATUS[d.status] ?? '—')
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
