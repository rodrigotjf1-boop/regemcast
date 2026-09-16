'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { CabecalhoPagina } from '@/components/ui/cabecalho-pagina';
import { LoaderDisparo } from '@/components/marca/loader-disparo';
import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EstadoErro } from '@/components/ui/estado-erro';
import { Spinner } from '@/components/ui/spinner';
import { mensagemDoErro } from '@/lib/api';
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

const TOM_STATUS: Record<string, 'sucesso' | 'atencao' | 'erro' | 'acento' | 'neutro'> = {
  pendente: 'neutro',
  enviando: 'neutro',
  enviada: 'atencao',
  entregue: 'acento',
  lida: 'sucesso',
  falhou: 'erro',
};

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
   * Silenciosa (sem o spinner de carregamento) para não piscar a tabela a cada
   * poucos segundos.
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
      <div className="flex items-center gap-3 text-sm text-tinta-suave">
        <Spinner /> Carregando…
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

  return (
    <div className="space-y-6">
      <div>
        <Link href="/campanhas" className="text-sm text-tinta-suave underline-offset-4 hover:underline">
          ← Campanhas
        </Link>
      </div>

      <CabecalhoPagina
        titulo={campanha.nome}
        descricao={
          <>
            Modelo <span className="numerico">{campanha.modeloNome}</span> ·{' '}
            {campanha.modeloIdioma} ·{' '}
            {campanha.total === 1 ? '1 destinatário' : `${campanha.total} destinatários`}
          </>
        }
        acao={
          <div className="flex flex-wrap items-center gap-2">
            <Button variante="secundario" onClick={() => void carregar()} carregando={carregando}>
              Atualizar
            </Button>
            {podeDisparar && (
              <Button onClick={() => void disparar()} carregando={disparando}>
                Disparar agora
              </Button>
            )}
          </div>
        }
      />

      {campanha.status === 'enviando' && (
        <Card>
          <LoaderDisparo rotulo="Enviando. As mensagens saem pelo servidor — você pode fechar esta página." />
        </Card>
      )}

      {campanha.status === 'agendada' && (
        <Alerta tom="informacao">
          Agendada. As mensagens começam a sair na próxima abertura da janela de envio.
        </Alerta>
      )}

      {campanha.status === 'pausada' && (
        <Alerta tom="atencao">
          <div className="space-y-2">
            <p>
              Pausada: a conexão com o WhatsApp caiu antes de terminar. Ninguém foi marcado como
              falha — quem faltava continua na fila. Reconecte o WhatsApp e retome.
            </p>
            <Button tamanho="sm" onClick={() => void retomar()} carregando={retomando}>
              Retomar envio
            </Button>
          </div>
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

      <Card>
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-tinta">Resumo</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(campanha.porStatus).map(([status, quantos]) => (
              <Badge key={status} tom={TOM_STATUS[status] ?? 'neutro'}>
                {quantos} {status}
              </Badge>
            ))}
          </div>
          {/*
            A distinção que o produto inteiro depende de acertar: "enviada"
            significa que a Meta aceitou, não que a pessoa recebeu.
          */}
          <p className="text-xs leading-relaxed text-tinta-suave">
            <strong>Enviada</strong> quer dizer que a Meta aceitou a mensagem — ainda não que ela
            chegou. <strong>Entregue</strong> é a confirmação de que chegou ao aparelho, e vem
            depois, pela própria Meta.
          </p>
        </div>
      </Card>

      <Card>
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-tinta">Destinatários</h2>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <caption className="sr-only">
                Destinatários da campanha, com o estado de entrega de cada um
              </caption>
              <thead>
                <tr className="border-b border-borda text-xs uppercase tracking-wide text-tinta-suave">
                  <th scope="col" className="py-2 pr-3 font-medium">Telefone</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Estado</th>
                  <th scope="col" className="py-2 font-medium">O que aconteceu</th>
                </tr>
              </thead>
              <tbody>
                {destinatarios.map((d) => (
                  <tr key={d.id} className="border-b border-borda/60 align-top">
                    <td className="numerico py-2 pr-3 text-tinta">{d.telefone}</td>
                    <td className="py-2 pr-3">
                      <Badge tom={TOM_STATUS[d.status] ?? 'neutro'}>{d.status}</Badge>
                    </td>
                    <td className="py-2 text-tinta-suave">
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
        </div>
      </Card>
    </div>
  );
}
