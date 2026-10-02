'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { EditorModelo } from '@/components/app/editor-modelo';
import {
  IconeConversa,
  IconeEditar,
  IconeFechar,
  IconeLixeira,
  IconeMais,
  IconeModelo,
  IconeRaio,
  IconeRelogio,
} from '@/components/app/icones';
import { CabecalhoPagina } from '@/components/ui/cabecalho-pagina';
import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { EsqueletoLista } from '@/components/ui/esqueleto';
import { EstadoErro } from '@/components/ui/estado-erro';
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

/** A qualidade do modelo como a tela fala dela. Sem informação não vira crachá. */
const QUALIDADE: Record<string, { rotulo: string; tom: 'sucesso' | 'atencao' | 'erro' }> = {
  verde: { rotulo: 'Qualidade: Boa', tom: 'sucesso' },
  amarela: { rotulo: 'Qualidade: Em atenção', tom: 'atencao' },
  vermelha: { rotulo: 'Qualidade: Ruim', tom: 'erro' },
};

export default function PaginaModelos() {
  const [modelos, setModelos] = useState<ModeloDeMensagem[] | null>(null);
  const [meus, setMeus] = useState<ModeloSalvo[]>([]);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [criando, setCriando] = useState(false);
  // Rascunho aberto para edicao. Rascunho que nao da para reabrir nao e rascunho.
  const [editando, setEditando] = useState<ModeloSalvo | null>(null);
  const [desconectado, setDesconectado] = useState(false);
  const [aviso, setAviso] = useState('');
  /** Excluir modelo que está na Meta tem consequência de 30 dias: pergunta antes. */
  const [confirmandoExclusao, setConfirmandoExclusao] = useState<ModeloSalvo | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      // Sem número conectado não há o que perguntar à Meta. Isso é um passo que
      // falta, não uma falha — e a tela mostra o caminho, não um erro vermelho.
      const situacao = await whatsapp.situacao();
      setDesconectado(!situacao.conectado);
      setModelos(situacao.conectado ? await whatsapp.modelos() : null);
    } catch (e) {
      // Lista vazia por engano é pior que erro visível: o cliente concluiria
      // que não tem modelo nenhum e iria criar um que já existe.
      setErro(mensagemDoErro(e));
      setModelos(null);
      setDesconectado(false);
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
      const r = await modelosSalvos.excluir(id);
      setConfirmandoExclusao(null);
      setAviso(
        r.naMeta
          ? 'Modelo excluído aqui e na Meta. O nome só volta a ficar livre em 30 dias, e as mensagens que já saíram continuam sendo entregues.'
          : 'Rascunho excluído.',
      );
      await carregar();
    } catch (e) {
      setErro(mensagemDoErro(e));
      setConfirmandoExclusao(null);
    }
  }

  /** O nosso registro do modelo que a Meta está mostrando — se existir. */
  function localDoAprovado(m: ModeloDeMensagem): ModeloSalvo | undefined {
    return meus.find(
      (n) =>
        (n.metaTemplateId && n.metaTemplateId === m.id) ||
        (n.nome === m.nome && n.idioma === m.idioma),
    );
  }

  const rascunhos = meus.filter((m) => m.status === 'rascunho' || m.status === 'rejeitado');
  const aguardando = meus.filter((m) => m.status === 'enviado');
  const aprovados = modelos?.filter((m) => m.status === 'aprovado').length ?? 0;
  const editorAberto = criando || editando;

  return (
    <div className="space-y-6 lg:space-y-8">
      <CabecalhoPagina
        icone={<IconeModelo />}
        sobretitulo={
          modelos ? `${aprovados} ${aprovados === 1 ? 'aprovado' : 'aprovados'} pela Meta` : 'Operação'
        }
        titulo="Modelos de mensagem"
        descricao={
          <>
            No WhatsApp oficial, toda conversa que <strong className="text-tinta">você</strong> começa
            precisa usar um modelo aprovado pela Meta. Crie o seu aqui — conferimos as regras dela
            antes de enviar.
          </>
        }
        acao={
          <Button
            variante={editorAberto ? 'secundario' : 'primario'}
            onClick={() => {
              if (editorAberto) {
                setCriando(false);
                setEditando(null);
              } else {
                setCriando(true);
              }
            }}
            aria-expanded={Boolean(editorAberto)}
          >
            {editorAberto ? <IconeFechar /> : <IconeMais />}
            {editorAberto ? 'Cancelar' : 'Novo modelo'}
          </Button>
        }
      />

      {aviso && <Alerta tom="sucesso">{aviso}</Alerta>}

      {confirmandoExclusao && (
        <Alerta tom="atencao">
          <span className="block space-y-2">
            <span className="block">
              Excluir <strong className="numerico">{confirmandoExclusao.nome}</strong> apaga o modelo aqui e na Meta.
              Duas coisas que não dá para desfazer: o <strong>nome fica bloqueado por 30 dias</strong>, e as mensagens
              que já saíram continuam sendo entregues — excluir não cancela envio.
            </span>
            <span className="flex flex-wrap gap-2">
              <Button tamanho="sm" variante="perigo" onClick={() => void excluir(confirmandoExclusao.id)}>
                Excluir na Meta
              </Button>
              <Button tamanho="sm" variante="discreto" onClick={() => setConfirmandoExclusao(null)}>
                Voltar
              </Button>
            </span>
          </span>
        </Alerta>
      )}

      {editorAberto && (
        <div className="anima-entrada">
          <EditorModelo
            key={editando?.id ?? 'novo'}
            inicial={editando ?? undefined}
            aoCancelar={() => {
              setCriando(false);
              setEditando(null);
              // O editor pode ter gravado o rascunho antes de um envio que
              // falhou: a lista relê para ele aparecer.
              void carregar();
            }}
            aoSalvar={() => {
              setCriando(false);
              setEditando(null);
              void carregar();
            }}
          />
        </div>
      )}

      {aguardando.length > 0 && (
        <Alerta tom="informacao">
          <span className="inline-flex items-start gap-2">
            <IconeRelogio className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {aguardando.length === 1
                ? '1 modelo está em análise na Meta'
                : `${aguardando.length} modelos estão em análise na Meta`}
              . A resposta costuma levar de minutos a algumas horas, e aparece na lista abaixo.
            </span>
          </span>
        </Alerta>
      )}

      {rascunhos.length > 0 && (
        <section aria-label="Rascunhos e recusados" className="anima-entrada space-y-3">
          <h2 className="text-base font-semibold text-tinta">Rascunhos e recusados</h2>
          <ul className="escalonado grid grid-cols-1 gap-4 lg:grid-cols-2">
            {rascunhos.map((m) => (
              <li
                key={m.id}
                className="flex flex-col gap-3 rounded-card border border-dashed border-borda bg-superficie p-5 shadow-card"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="numerico break-words text-sm font-semibold text-tinta">{m.nome}</p>
                    <p className="text-xs text-tinta-suave">
                      {m.categoria} · {m.idioma}
                    </p>
                  </div>
                  <Badge tom={m.status === 'rejeitado' ? 'erro' : 'neutro'} ponto>
                    {m.status}
                  </Badge>
                </div>

                <p className="line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-tinta-suave">
                  {m.corpo}
                </p>

                {/*
                  O motivo da recusa fica aqui porque a Meta o diz UMA vez, na
                  resposta do envio. Sem isto, o cliente tentaria de novo às cegas.
                */}
                {m.motivo && (
                  <p className="rounded-xl border border-erro/30 bg-erro/10 p-2.5 text-xs leading-relaxed text-erro">
                    A Meta recusou: {m.motivo}
                  </p>
                )}

                <div className="mt-auto flex flex-wrap gap-2 border-t border-borda pt-3">
                  <Button
                    tamanho="sm"
                    variante="secundario"
                    onClick={() => {
                      setCriando(false);
                      setEditando(m);
                    }}
                  >
                    <IconeEditar />
                    Editar
                  </Button>
                  <Button tamanho="sm" onClick={() => void enviar(m.id)}>
                    <IconeRaio />
                    Enviar para aprovação
                  </Button>
                  <Button tamanho="sm" variante="discreto" onClick={() => void excluir(m.id)} className="hover:text-erro">
                    <IconeLixeira />
                    Excluir
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {carregando && <EsqueletoLista linhas={3} />}

      {!carregando && !erro && desconectado && (
        <EmptyState
          icone={<IconeConversa />}
          titulo="Conecte o número para ver os aprovados"
          descricao="Os modelos aprovados ficam na sua conta da Meta. Você já pode escrever e salvar rascunhos aqui; para enviar à aprovação, conecte o número primeiro."
          acao={
            <Link href="/whatsapp">
              <Button>
                <IconeConversa />
                Conectar o número
              </Button>
            </Link>
          }
        />
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
          icone={<IconeModelo />}
          titulo="Nenhum modelo aprovado ainda"
          descricao="Crie o primeiro no botão acima. A Meta analisa cada modelo antes de liberar, o que costuma levar de alguns minutos a algumas horas."
          acao={
            editorAberto ? undefined : (
              <Button onClick={() => setCriando(true)}>
                <IconeMais />
                Novo modelo
              </Button>
            )
          }
        />
      )}

      {!carregando && !erro && modelos && modelos.length > 0 && (
        <section aria-label="Modelos na Meta" className="space-y-3">
          <h2 className="text-base font-semibold text-tinta">Na Meta</h2>
          <ul className="escalonado grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {modelos.map((m) => {
              const local = localDoAprovado(m);
              return (
                <li key={m.id}>
                  <CartaoModelo
                    modelo={m}
                    local={local}
                    aoEditar={() => {
                      setCriando(false);
                      setEditando(local ?? null);
                    }}
                    aoExcluir={() => local && setConfirmandoExclusao(local)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function CartaoModelo({
  modelo,
  local,
  aoEditar,
  aoExcluir,
}: {
  modelo: ModeloDeMensagem;
  /** O nosso registro dele. Sem ele o modelo nasceu fora do RegemCast: só leitura. */
  local?: ModeloSalvo;
  aoEditar: () => void;
  aoExcluir: () => void;
}) {
  const qualidade = modelo.qualidade ? QUALIDADE[modelo.qualidade] : undefined;
  const alertas = modelo.alertas ?? [];
  return (
    <article className="cartao-interativo flex h-full flex-col overflow-hidden rounded-card border border-borda bg-superficie shadow-card">
      <div className="flex items-start justify-between gap-2 p-4">
        <div className="min-w-0">
          <p className="numerico break-words text-sm font-semibold text-tinta">{modelo.nome}</p>
          <p className="text-xs text-tinta-suave">
            <span className="capitalize">{modelo.categoria}</span> · {modelo.idioma}
            {/* A Meta reclassificou: o preço por mensagem segue a categoria de agora. */}
            {modelo.categoriaAnterior ? ` · era ${modelo.categoriaAnterior}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge tom={tomDoStatus(modelo.status)} ponto>
            {modelo.status}
          </Badge>
          {qualidade && (
            <Badge tom={qualidade.tom} ponto>
              {qualidade.rotulo}
            </Badge>
          )}
        </div>
      </div>

      {/*
        O que a Meta sinaliza neste modelo — qualidade caindo, categoria que vai
        mudar. As frases vêm prontas do servidor; a tela não traduz nada.
      */}
      {alertas.length > 0 && (
        <ul className="space-y-px border-t border-borda">
          {alertas.map((a) => (
            <li
              key={a.texto}
              className={
                a.tom === 'erro'
                  ? 'bg-erro/10 px-4 py-2.5 text-xs leading-relaxed text-erro'
                  : 'bg-atencao/10 px-4 py-2.5 text-xs leading-relaxed text-atencao'
              }
            >
              {a.texto}
            </li>
          ))}
        </ul>
      )}

      {/*
        A prévia mostra a mensagem como ela vai chegar, com as partes na ordem
        em que o WhatsApp as exibe. Ler `{{1}}` numa lista de campos não diz
        nada; ler a frase inteira diz na hora se o modelo serve.
      */}
      <div className="fundo-pontos flex-1 bg-superficie-2/70 px-4 py-5">
        <div className="max-w-[92%] rounded-2xl rounded-tl-md bg-superficie p-3 shadow-sm">
          {modelo.cabecalho && <p className="mb-1 text-sm font-semibold text-tinta">{modelo.cabecalho}</p>}
          <p className="line-clamp-6 whitespace-pre-wrap text-sm leading-relaxed text-tinta">{modelo.corpo}</p>
          {modelo.rodape && <p className="mt-1.5 text-xs text-tinta-suave">{modelo.rodape}</p>}
          {modelo.botoes.length > 0 && (
            <ul className="mt-2 divide-y divide-borda border-t border-borda">
              {modelo.botoes.map((b) => (
                <li key={b} className="py-1.5 text-center text-xs font-medium text-acento-forte">
                  {b}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-borda px-4 py-2.5 text-xs text-tinta-suave">
        <span>
          {modelo.variaveis === 0
            ? 'Sem variáveis'
            : modelo.variaveis === 1
              ? '1 variável a preencher'
              : `${modelo.variaveis} variáveis a preencher`}
        </span>

        {/*
          Só o que nasceu aqui pode ser editado ou excluído por aqui: de um
          modelo criado direto no painel da Meta não temos o texto original, e
          "editar" mandaria para lá uma versão montada pela metade.
        */}
        {local ? (
          <span className="flex gap-1.5">
            <Button tamanho="sm" variante="discreto" onClick={aoEditar}>
              <IconeEditar />
              Editar
            </Button>
            <Button tamanho="sm" variante="discreto" onClick={aoExcluir} className="hover:text-erro">
              <IconeLixeira />
              Excluir
            </Button>
          </span>
        ) : (
          <span className="text-[0.7rem]">Criado fora do RegemCast</span>
        )}
      </div>

      {/*
        Recusado se corrige e reenvia com o MESMO nome (a Meta aceita edição de
        modelo recusado). Mandar criar outro com nome novo levava a pessoa a
        repetir o mesmo erro com outro nome.
      */}
      {modelo.motivo && (
        <p className="border-t border-erro/30 bg-erro/10 p-3 text-xs leading-relaxed text-erro">
          A Meta recusou este modelo. {modelo.motivo}{' '}
          {local
            ? 'Toque em Editar, corrija e salve: a correção volta para a Meta com o mesmo nome.'
            : 'Corrija no painel da Meta, ou crie um novo aqui.'}
        </p>
      )}
    </article>
  );
}
