'use client';

import { useCallback, useEffect, useState } from 'react';

import { EditorModelo } from '@/components/app/editor-modelo';
import { CabecalhoPagina } from '@/components/ui/cabecalho-pagina';
import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { EstadoErro } from '@/components/ui/estado-erro';
import { Spinner } from '@/components/ui/spinner';
import { mensagemDoErro } from '@/lib/api';
import { modelos as modelosSalvos, whatsapp } from '@/lib/servicos';
import type { ModeloDeMensagem, ModeloSalvo } from '@/lib/tipos';

/**
 * Modelos de mensagem.
 *
 * A lista de aprovados é lida da Meta a cada visita, e não de cópia nossa: o
 * status muda do lado dela sem aviso (aprovação, recusa, pausa por qualidade),
 * e uma cópia desatualizada faria o cliente montar campanha com modelo que a
 * Meta já recusou.
 *
 * O que é nosso são os RASCUNHOS — que a Meta não tem. Um modelo leva minutos
 * para ser escrito e ela o recusa por detalhes; sem rascunho, cada recusa apaga
 * o trabalho.
 *
 * Por isso a tela mostra o status com destaque: no WhatsApp oficial, **modelo
 * aprovado é a licença para iniciar conversa**. Sem ele não existe disparo, e
 * quem não entende isso acha que o produto está travado.
 */

/** Tom do crachá por status. Desconhecido fica neutro, e o texto cru aparece. */
function tomDoStatus(status: string): 'sucesso' | 'atencao' | 'erro' | 'neutro' {
  if (status === 'aprovado') return 'sucesso';
  if (status === 'em análise' || status === 'em recurso' || status === 'pausado') return 'atencao';
  if (status === 'recusado' || status === 'desativado' || status === 'sendo excluído') return 'erro';
  return 'neutro';
}

export default function PaginaModelos() {
  const [modelos, setModelos] = useState<ModeloDeMensagem[] | null>(null);
  const [meus, setMeus] = useState<ModeloSalvo[]>([]);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [criando, setCriando] = useState(false);
  // Rascunho aberto para edicao. Rascunho que nao da para reabrir nao e rascunho.
  const [editando, setEditando] = useState<ModeloSalvo | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      setModelos(await whatsapp.modelos());
    } catch (e) {
      // Lista vazia por engano é pior que erro visível: o cliente concluiria
      // que não tem modelo nenhum e iria criar um que já existe.
      setErro(mensagemDoErro(e));
      setModelos(null);
    } finally {
      setCarregando(false);
    }

    // Os nossos são independentes: mesmo que a Meta esteja fora do ar, o
    // rascunho que a pessoa escreveu precisa continuar aparecendo.
    try {
      setMeus(await modelosSalvos.listar());
    } catch {
      setMeus([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function enviar(id: string) {
    try {
      await modelosSalvos.enviar(id);
      await carregar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    }
  }

  async function excluir(id: string) {
    try {
      await modelosSalvos.excluir(id);
      await carregar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    }
  }

  const rascunhos = meus.filter((m) => m.status === 'rascunho' || m.status === 'rejeitado');
  const aguardando = meus.filter((m) => m.status === 'enviado');

  return (
    <div className="space-y-6">
      <CabecalhoPagina
        titulo="Modelos de mensagem"
        descricao={
          <>
            No WhatsApp oficial, toda conversa que <strong>você</strong> começa precisa usar um
            modelo aprovado pela Meta. Crie o seu aqui — conferimos as regras dela antes de enviar.
          </>
        }
        acao={
          <Button
            variante={criando ? 'secundario' : 'primario'}
            onClick={() => setCriando((v) => !v)}
            aria-expanded={criando}
          >
            {criando ? 'Cancelar' : 'Novo modelo'}
          </Button>
        }
      />

      {(criando || editando) && (
        <EditorModelo
          key={editando?.id ?? "novo"}
          inicial={editando ?? undefined}
          aoCancelar={() => {
            setCriando(false);
            setEditando(null);
          }}
          aoSalvar={() => {
            setCriando(false);
            setEditando(null);
            void carregar();
          }}
        />
      )}

      {rascunhos.length > 0 && (
        <Card>
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-tinta">Rascunhos e recusados</h2>
            <ul className="space-y-3">
              {rascunhos.map((m) => (
                <li key={m.id} className="space-y-2 border-b border-borda/60 pb-3 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="numerico break-words text-sm font-semibold text-tinta">{m.nome}</p>
                      <p className="text-xs text-tinta-suave">{m.categoria} · {m.idioma}</p>
                    </div>
                    <Badge tom={m.status === 'rejeitado' ? 'erro' : 'neutro'}>{m.status}</Badge>
                  </div>

                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-tinta-suave">
                    {m.corpo}
                  </p>

                  {/*
                    O motivo da recusa fica aqui porque a Meta o diz UMA vez, na
                    resposta do envio. Sem isto, o cliente tentaria de novo às cegas.
                  */}
                  {m.motivo && (
                    <p className="rounded-card border border-erro/30 bg-erro/10 p-2 text-xs leading-relaxed text-erro">
                      A Meta recusou: {m.motivo}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setCriando(false);
                        setEditando(m);
                      }}
                      className="text-acento-forte underline-offset-4 hover:underline"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => void enviar(m.id)}
                      className="text-acento-forte underline-offset-4 hover:underline"
                    >
                      Enviar para aprovação
                    </button>
                    <button
                      type="button"
                      onClick={() => void excluir(m.id)}
                      className="text-tinta-suave underline-offset-4 hover:text-erro hover:underline"
                    >
                      Excluir
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {aguardando.length > 0 && (
        <Alerta tom="informacao">
          {aguardando.length === 1
            ? '1 modelo está em análise na Meta'
            : `${aguardando.length} modelos estão em análise na Meta`}
          . A resposta costuma levar de minutos a algumas horas, e aparece na lista abaixo.
        </Alerta>
      )}

      {carregando && (
        <div className="flex items-center gap-3 text-sm text-tinta-suave">
          <Spinner /> Carregando…
        </div>
      )}

      {!carregando && erro && (
        <EstadoErro
          titulo="Não consegui carregar seus modelos"
          mensagem={erro}
          aoTentarDeNovo={() => void carregar()}
        />
      )}

      {!carregando && !erro && modelos?.length === 0 && (
        <EmptyState
          titulo="Nenhum modelo aprovado ainda"
          descricao={
            <>
              Crie o primeiro no botão acima. A Meta analisa cada modelo antes de liberar, o que costuma levar de alguns minutos a algumas horas.
            </>
          }
        />
      )}

      {!carregando && !erro && modelos && modelos.length > 0 && (
        <div className="space-y-4">
          {modelos.map((m) => (
            <CartaoModelo key={m.id} modelo={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function CartaoModelo({ modelo }: { modelo: ModeloDeMensagem }) {
  return (
    <Card>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="numerico break-words text-base font-semibold text-tinta">{modelo.nome}</p>
            <p className="text-xs text-tinta-suave">
              {modelo.categoria} · {modelo.idioma}
            </p>
          </div>
          <Badge tom={tomDoStatus(modelo.status)}>{modelo.status}</Badge>
        </div>

        {/*
          A prévia mostra a mensagem como ela vai chegar, com as partes na ordem
          em que o WhatsApp as exibe. Ler `{{1}}` numa lista de campos não diz
          nada; ler a frase inteira diz na hora se o modelo serve.
        */}
        <div className="space-y-2 rounded-card border border-borda bg-superficie-2 p-3">
          {modelo.cabecalho && (
            <p className="text-sm font-semibold text-tinta">{modelo.cabecalho}</p>
          )}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-tinta">{modelo.corpo}</p>
          {modelo.rodape && <p className="text-xs text-tinta-suave">{modelo.rodape}</p>}

          {modelo.botoes.length > 0 && (
            <ul className="flex flex-wrap gap-2 pt-1">
              {modelo.botoes.map((b) => (
                <li
                  key={b}
                  className="rounded-lg border border-acento/25 bg-superficie px-2 py-1 text-xs font-medium text-acento-forte"
                >
                  {b}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tinta-suave">
          <span>
            {modelo.variaveis === 0
              ? 'Sem variáveis'
              : modelo.variaveis === 1
                ? '1 variável a preencher'
                : `${modelo.variaveis} variáveis a preencher`}
          </span>
        </div>

        {modelo.motivo && (
          <p className="rounded-card border border-erro/30 bg-erro/10 p-3 text-sm leading-relaxed text-erro">
            A Meta recusou este modelo. Motivo informado por ela: {modelo.motivo}. Crie outro aqui com um nome novo.
          </p>
        )}
      </div>
    </Card>
  );
}
