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
import { ErroQueGuia } from '@/components/app/erro-que-guia';
import { FormularioCampanha } from '@/components/app/formulario-campanha';
import { CartaoDoCusto } from '@/components/app/custo-na-meta';
import { AvisoDaSaude } from '@/components/app/saude-da-conta';
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
import { nomeDoAplicativo } from '@/lib/aplicativo';
import { nomeDaCategoria } from '@/lib/categorias';
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
  descanso: 'Recebeu outra campanha de marketing há pouco e ficou de fora. Não contou no plano.',
  cancelado: 'A campanha foi cancelada antes de sair para esta pessoa.',
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
  const [pausando, setPausando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [editando, setEditando] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
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

  async function pausar() {
    setAviso('');
    setErro('');
    setPausando(true);
    try {
      await campanhas.pausar(id);
      await carregar();
      setAviso('Campanha pausada. Quem faltava continua na fila e só sai quando você retomar.');
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setPausando(false);
    }
  }

  async function excluir() {
    setAviso('');
    setErro('');
    setExcluindo(true);
    try {
      const r = await campanhas.excluir(id);
      if (r.resultado === 'cancelada') {
        setConfirmarExclusao(false);
        await carregar();
        setAviso('Campanha cancelada. Quem ainda não tinha recebido não recebe mais.');
        return;
      }
      // Apagada ou arquivada: não há mais o que ver nesta tela.
      window.location.href = '/campanhas';
    } catch (e) {
      setErro(mensagemDoErro(e));
      setConfirmarExclusao(false);
    } finally {
      setExcluindo(false);
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
  const podePausar = campanha.status === 'agendada' || campanha.status === 'enviando';
  const podeRetomar = campanha.status === 'pausada';
  const podeEditar = ['rascunho', 'agendada', 'pausada'].includes(campanha.status);

  // A palavra muda com a situação, porque o efeito muda: rascunho some, campanha
  // em curso é cancelada (e ninguém mais recebe), encerrada sai só da lista.
  const exclusao =
    campanha.status === 'rascunho'
      ? {
          rotulo: 'Excluir',
          confirmar: 'Excluir de vez',
          aviso: 'Este rascunho some junto com a lista de quem ia receber. Não dá para desfazer.',
        }
      : campanha.status === 'agendada' || campanha.status === 'pausada'
        ? {
            rotulo: 'Cancelar campanha',
            confirmar: 'Cancelar campanha',
            aviso:
              'Quem ainda não recebeu não recebe mais. O que já saiu continua no histórico — e continua cobrado pela Meta.',
          }
        : {
            rotulo: 'Arquivar',
            confirmar: 'Arquivar',
            aviso:
              'A campanha sai da sua lista. O histórico de envio continua no sistema, porque é ele que sustenta o consumo do ciclo.',
          };
  const p = campanha.porStatus;
  const lidas = p.lida ?? 0;
  const entregues = (p.entregue ?? 0) + lidas;
  const enviadas = (p.enviada ?? 0) + entregues;
  const falhas = p.falhou ?? 0;
  const emDescanso = p.descanso ?? 0;
  const respondidas = campanha.respondidas ?? 0;
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
            Modelo <span className="numerico text-tinta">{campanha.modeloNome}</span>
            {nomeDaCategoria(campanha.modeloCategoria) ? (
              <>
                {' '}
                (<span className="font-medium text-tinta">{nomeDaCategoria(campanha.modeloCategoria)}</span>)
              </>
            ) : null}{' '}
            · {campanha.modeloIdioma}
            {campanha.listaNome ? <> · lista {campanha.listaNome}</> : null}
            {!campanha.listaNome && campanha.publicoRotulo ? <> · público {campanha.publicoRotulo}</> : null} · criada
            em {formatarDataHora(campanha.criadoEm)}
            {nomeDoAplicativo(campanha.integracaoProduto) ? (
              <>
                {' '}
                · <span className="font-medium text-tinta">montada pelo {nomeDoAplicativo(campanha.integracaoProduto)}</span>
              </>
            ) : null}
          </>
        }
        acao={
          <>
            <Button variante="secundario" onClick={() => void carregar()} carregando={carregando}>
              {carregando ? null : <IconeAtualizar />}
              Atualizar
            </Button>
            {podeEditar && (
              <Button
                variante="secundario"
                aria-expanded={editando}
                onClick={() => setEditando((v) => !v)}
              >
                {editando ? 'Fechar edição' : 'Editar'}
              </Button>
            )}
            {podePausar && (
              <Button variante="secundario" onClick={() => void pausar()} carregando={pausando}>
                Pausar
              </Button>
            )}
            {podeRetomar && (
              <Button variante="secundario" onClick={() => void retomar()} carregando={retomando}>
                Retomar
              </Button>
            )}
            {campanha.status !== 'enviando' && (
              <Button variante="perigo" onClick={() => setConfirmarExclusao(true)}>
                {exclusao.rotulo}
              </Button>
            )}
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

      {campanha.status === 'agendada' && !campanha.espera && (
        <Alerta tom="informacao">
          Agendada. As mensagens começam a sair na próxima abertura da janela de envio.
        </Alerta>
      )}

      {campanha.espera?.motivo === 'limite_meta' && (
        <Alerta tom="informacao">
          <span className="block space-y-2">
            <span className="block">
              Aguardando o limite da Meta: sua conta já falou com{' '}
              {campanha.espera.limite ? (
                <strong className="numerico">{formatarNumero(campanha.espera.limite)}</strong>
              ) : (
                'o máximo de'
              )}{' '}
              pessoas diferentes nas últimas 24 horas, o teto do seu número hoje.{' '}
              {campanha.espera.ate
                ? `A campanha continua sozinha a partir de ${formatarDataHora(campanha.espera.ate)}`
                : 'A campanha continua sozinha assim que abrir vaga'}
              {' '}— ninguém fica de fora nem é marcado como falha.
            </span>
            <Link href="/whatsapp" className="text-sm font-medium text-tinta underline underline-offset-4">
              Ver o limite do número
            </Link>
          </span>
        </Alerta>
      )}

      {campanha.espera?.motivo === 'ritmo' && (
        <Alerta tom="informacao">
          A Meta pediu para desacelerar: muitas mensagens em pouco tempo.{' '}
          {campanha.espera.ate
            ? `A campanha continua sozinha a partir de ${formatarDataHora(campanha.espera.ate)}`
            : 'A campanha continua sozinha em instantes'}
          {' '}— quem ficou na fila sai depois, sem perder a mensagem.
        </Alerta>
      )}

      {campanha.status === 'pausada' && campanha.pausaMotivo === 'manual' && (
        <Alerta tom="informacao">
          <span className="block space-y-2">
            <span className="block">
              Pausada por você. Quem faltava continua na fila, intacto, e nada sai até você retomar.
            </span>
            <Button tamanho="sm" onClick={() => void retomar()} carregando={retomando}>
              Retomar envio
            </Button>
          </span>
        </Alerta>
      )}

      {campanha.status === 'cancelada' && (
        <Alerta tom="atencao">
          Campanha cancelada. Quem não tinha recebido não recebeu — o que saiu antes continua no
          histórico abaixo.
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

      {campanha.status === 'pausada' && campanha.pausaMotivo === 'orcamento' && (
        <Alerta tom="atencao">
          <span className="block space-y-2">
            <span className="block">
              Pausada pelo orçamento de disparos. {campanha.pausaTexto ?? 'O teto de gasto foi atingido.'} Ninguém foi
              marcado como falha — quem faltava continua na fila e a campanha volta a sair sozinha
              {campanha.pausaAte ? ` em ${formatarDataHora(campanha.pausaAte)}` : ' na virada do período'}, ou antes se
              o dono aumentar o orçamento.
            </span>
            <Link href="/conta">
              <Button tamanho="sm" variante="secundario">
                Ver o orçamento
              </Button>
            </Link>
          </span>
        </Alerta>
      )}

      {campanha.status === 'pausada' && campanha.pausaMotivo === 'inadimplencia' && (
        <Alerta tom="erro">
          <span className="block space-y-2">
            <span className="block">
              Pausada: os disparos da conta estão parados por falta de pagamento do plano. Quem faltava
              continua na fila e a campanha volta sozinha assim que o pagamento for confirmado.
            </span>
            <Link href="/plano">
              <Button tamanho="sm">Ver plano e pagamento</Button>
            </Link>
          </span>
        </Alerta>
      )}

      {campanha.status === 'pausada' && campanha.pausaMotivo === 'conexao' && (
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

      {campanha.status === 'pausada' && campanha.pausaMotivo === 'modelo' && campanha.pausaErro && (
        <div role="alert" className="space-y-3 rounded-lg border border-erro/30 bg-erro/10 px-3 py-3 text-sm">
          <p className="leading-relaxed text-erro">
            Pausada: a Meta recusou o modelo desta campanha. A campanha parou na primeira recusa —
            quem faltava continua na fila, sem ser marcado como falha.
          </p>
          <div className="rounded-lg border border-borda bg-superficie p-3">
            <ErroQueGuia
              erro={campanha.pausaErro}
              acoes={
                <Button tamanho="sm" onClick={() => void retomar()} carregando={retomando}>
                  Retomar envio
                </Button>
              }
            />
          </div>
        </div>
      )}

      {campanha.status === 'pausada' && campanha.pausaMotivo === 'modelo' && !campanha.pausaErro && (
        <Alerta tom="erro">
          <span className="block space-y-2">
            <span className="block">
              Pausada: a Meta recusou o modelo desta campanha, ou o arquivo dele não está mais
              disponível. A campanha parou na primeira recusa — quem faltava continua na fila, sem
              ser marcado como falha. Veja o motivo abaixo, confira o modelo e retome.
            </span>
            <span className="flex flex-wrap gap-2">
              <Link href="/modelos">
                <Button tamanho="sm" variante="secundario">
                  Ver modelos
                </Button>
              </Link>
              <Button tamanho="sm" onClick={() => void retomar()} carregando={retomando}>
                Retomar envio
              </Button>
            </span>
          </span>
        </Alerta>
      )}

      {/*
        A Meta recusou por um problema da CONTA do WhatsApp (pagamento, restrição,
        registro do número): a mensagem seguinte teria a mesma resposta, então a
        campanha parou. O motivo e o que fazer vêm do catálogo, pelo código.
      */}
      {campanha.status === 'pausada' && campanha.pausaMotivo === 'conta_meta' && (
        <div role="alert" className="space-y-3 rounded-lg border border-erro/30 bg-erro/10 px-3 py-3 text-sm">
          <p className="leading-relaxed text-erro">
            Pausada: a Meta recusou o envio por um problema da conta do WhatsApp, e a mensagem
            seguinte teria a mesma resposta. A campanha parou — quem faltava continua na fila e sai
            quando você retomar.
          </p>
          {campanha.pausaErro ? (
            <div className="rounded-lg border border-borda bg-superficie p-3">
              <ErroQueGuia
                erro={campanha.pausaErro}
                acoes={
                  <Button tamanho="sm" onClick={() => void retomar()} carregando={retomando}>
                    Retomar envio
                  </Button>
                }
              />
            </div>
          ) : (
            <Button tamanho="sm" onClick={() => void retomar()} carregando={retomando}>
              Retomar envio
            </Button>
          )}
        </div>
      )}

      {confirmarExclusao && (
        <Alerta tom="atencao">
          <span className="block space-y-2">
            <span className="block">{exclusao.aviso}</span>
            <span className="flex flex-wrap gap-2">
              <Button tamanho="sm" variante="perigo" onClick={() => void excluir()} carregando={excluindo}>
                {exclusao.confirmar}
              </Button>
              <Button tamanho="sm" variante="discreto" onClick={() => setConfirmarExclusao(false)}>
                Voltar
              </Button>
            </span>
          </span>
        </Alerta>
      )}

      {editando && (
        <FormularioCampanha
          campanha={campanha}
          aoCancelar={() => setEditando(false)}
          aoConcluir={() => {
            setEditando(false);
            setAviso('Campanha atualizada.');
            void carregar();
          }}
        />
      )}

      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {aviso && <Alerta tom="sucesso">{aviso}</Alerta>}

      {podeDisparar && (
        <Alerta tom="informacao">
          Esta campanha ainda não saiu. Confira os números abaixo antes de disparar — depois não dá
          para desfazer.
        </Alerta>
      )}

      {/* Antes de disparar ou de retomar: o que a Meta aponta na conta, se aponta. */}
      {(podeDisparar || podeRetomar) && <AvisoDaSaude />}

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
          apoio={respondidas > 0 ? `${pct(lidas)} · ${formatarNumero(respondidas)} ${respondidas === 1 ? 'respondeu' : 'responderam'}` : pct(lidas)}
        />
        <Estatistica
          rotulo="Falhas"
          valor={falhas}
          tom={falhas > 0 ? 'erro' : 'neutro'}
          icone={<IconeAlerta className="h-5 w-5" />}
          apoio={falhas > 0 ? 'O motivo e o que fazer estão abaixo' : 'Nenhuma até agora'}
        />
      </section>

      {/* Quanto custa na Meta: a estimativa antes de disparar, o gasto depois. */}
      <CartaoDoCusto custo={campanha.custo} />

      {/*
        Por que falhou, do motivo mais comum para o menos. Quem tem 300 falhas lê
        três motivos, cada um com o que fazer — e não trezentas linhas.
      */}
      {campanha.falhasPorMotivo?.length ? (
        <Card className="anima-entrada">
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-tinta">Por que falhou</h2>
              <p className="text-xs text-tinta-suave">
                {campanha.falhasPorMotivo.length === 1
                  ? 'Um motivo, com o que fazer.'
                  : `${campanha.falhasPorMotivo.length} motivos, do mais comum para o menos, cada um com o que fazer.`}
              </p>
            </div>
            <ul className="divide-y divide-borda">
              {campanha.falhasPorMotivo.map((f, i) => (
                <li key={`${f.erro.codigo ?? 's'}-${i}`} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="numerico mt-0.5 shrink-0 self-start rounded-md bg-erro/10 px-2 py-0.5 text-sm font-semibold text-erro">
                    {formatarNumero(f.total)}
                  </span>
                  <ErroQueGuia erro={f.erro} />
                </li>
              ))}
            </ul>
          </div>
        </Card>
      ) : null}

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
          {campanha.descansoDias ? (
            <p className="text-xs leading-relaxed text-tinta-suave">
              Descanso de <strong className="text-tinta">{campanha.descansoDias} {campanha.descansoDias === 1 ? 'dia' : 'dias'}</strong>
              : quem recebeu outra campanha de marketing nesse prazo fica de fora, sem contar no plano
              {emDescanso > 0 ? (
                <>
                  {' '}— <span className="numerico text-tinta">{formatarNumero(emDescanso)}</span>{' '}
                  {emDescanso === 1 ? 'pessoa ficou' : 'pessoas ficaram'} de fora até agora
                </>
              ) : null}
              .
            </p>
          ) : null}
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
        {campanha.total > destinatarios.length ? (
          <p className="border-b border-borda bg-superficie-2/40 px-5 py-2 text-xs text-tinta-suave">
            Mostrando {formatarNumero(destinatarios.length)} de {formatarNumero(campanha.total)}, com as falhas
            primeiro. Os totais acima contam todos.
          </p>
        ) : null}

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
                  <td className="px-5 py-3 text-tinta-suave [overflow-wrap:anywhere]">
                    {d.status === 'falhou' && d.erro ? (
                      <ErroQueGuia erro={d.erro} compacto />
                    ) : d.status === 'falhou' && d.erroDetalhe ? (
                      <>
                        <span className="font-medium text-erro">{d.erroTitulo}</span>
                        <br />
                        {d.erroDetalhe}
                      </>
                    ) : d.status === 'descanso' && d.erroDetalhe ? (
                      d.erroDetalhe
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
