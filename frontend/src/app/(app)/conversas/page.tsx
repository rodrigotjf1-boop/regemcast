'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ListaConversas } from '@/components/app/conversas/lista-conversas';
import { PainelConversa } from '@/components/app/conversas/painel-conversa';
import { IconeBalao } from '@/components/app/icones';
import { useSessao } from '@/components/app/sessao';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { CabecalhoPagina } from '@/components/ui/cabecalho-pagina';
import { EsqueletoLista } from '@/components/ui/esqueleto';
import { EstadoErro } from '@/components/ui/estado-erro';
import { Select } from '@/components/ui/input';
import { ErroApi, mensagemDoErro } from '@/lib/api';
import { cn } from '@/lib/cn';
import { conversas } from '@/lib/servicos';
import type { ConversaResumo, MensagemDaConversa } from '@/lib/tipos';

/**
 * Conversas do WhatsApp, dentro do Regemcast — no jeito do WhatsApp Web.
 *
 * Só existe com a coexistência ligada e a resposta "sim" sobre contatos e
 * conversas; o servidor recusa as rotas sem isso, e esta tela explica.
 *
 * Atualiza sozinha: a conversa aberta a cada 5 segundos e a lista a cada 15,
 * pausando com a aba escondida — ninguém lendo, nenhuma consulta. Cada leitura
 * pede só a última página; as anteriores ficam como estão.
 */

const A_CADA_CONVERSA_MS = 5_000;
const A_CADA_LISTA_MS = 15_000;
const POR_PAGINA = 60;

/** Junta a página mais recente com o que já estava carregado (páginas anteriores). */
function mesclar(atuais: MensagemDaConversa[], recentes: MensagemDaConversa[]): MensagemDaConversa[] {
  if (!recentes.length) return atuais;
  const ids = new Set(recentes.map((m) => m.id));
  const inicio = recentes[0]!.criadaEm;
  return [...atuais.filter((m) => m.criadaEm < inicio && !ids.has(m.id)), ...recentes];
}

function abaVisivel(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

const PRAZOS: Array<[number, string]> = [
  [0, 'Guardar tudo'],
  [7, '7 dias'],
  [30, '30 dias'],
  [90, '90 dias'],
  [180, '6 meses'],
  [365, '1 ano'],
];

export default function PaginaConversas() {
  const { sessao } = useSessao();
  const dono = sessao.usuario.papel === 'dono';

  const [lista, setLista] = useState<ConversaResumo[]>([]);
  const [carregouLista, setCarregouLista] = useState(false);
  const [erroLista, setErroLista] = useState<{ texto: string; desligada: boolean } | null>(null);
  const [busca, setBusca] = useState('');

  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<MensagemDaConversa[]>([]);
  const [temAnteriores, setTemAnteriores] = useState(false);
  const [carregandoAnteriores, setCarregandoAnteriores] = useState(false);
  const [aviso, setAviso] = useState<{ tom: 'erro' | 'sucesso'; texto: string } | null>(null);

  const [guarda, setGuarda] = useState<number | null>(null);
  const [ajustandoGuarda, setAjustandoGuarda] = useState(false);
  const [salvandoGuarda, setSalvandoGuarda] = useState(false);

  const buscaAtual = useRef('');
  buscaAtual.current = busca;
  const abertaRef = useRef<string | null>(null);
  abertaRef.current = selecionada;

  // ---------------------------------------------------------------- lista

  const carregarLista = useCallback(async () => {
    try {
      const itens = await conversas.listar(buscaAtual.current);
      setLista(itens);
      setErroLista(null);
    } catch (e) {
      setErroLista({ texto: mensagemDoErro(e), desligada: e instanceof ErroApi && e.status === 404 });
    } finally {
      setCarregouLista(true);
    }
  }, []);

  // Busca: espera a pessoa parar de digitar.
  useEffect(() => {
    const t = window.setTimeout(() => void carregarLista(), 300);
    return () => window.clearTimeout(t);
  }, [busca, carregarLista]);

  useEffect(() => {
    const t = window.setInterval(() => {
      if (abaVisivel()) void carregarLista();
    }, A_CADA_LISTA_MS);
    return () => window.clearInterval(t);
  }, [carregarLista]);

  // Veio de um link com ?c=<conversa>: abre direto.
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('c');
    if (c) setSelecionada(c);
  }, []);

  // ---------------------------------------------------------------- conversa aberta

  const carregarRecentes = useCallback(async (id: string) => {
    try {
      const recentes = await conversas.mensagens(id);
      if (abertaRef.current !== id) return; // trocou de conversa no meio
      setMensagens((atuais) => mesclar(atuais, recentes));
      return recentes;
    } catch (e) {
      if (abertaRef.current === id) setAviso({ tom: 'erro', texto: mensagemDoErro(e) });
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (!selecionada) return;
    setMensagens([]);
    setAviso(null);
    setTemAnteriores(false);
    const url = new URL(window.location.href);
    url.searchParams.set('c', selecionada);
    window.history.replaceState(null, '', url);

    void carregarRecentes(selecionada).then((r) => {
      if (r && abertaRef.current === selecionada) setTemAnteriores(r.length >= POR_PAGINA);
    });
    const t = window.setInterval(() => {
      if (abaVisivel()) void carregarRecentes(selecionada);
    }, A_CADA_CONVERSA_MS);
    return () => window.clearInterval(t);
  }, [selecionada, carregarRecentes]);

  // Aberta com não lidas (inclusive as que chegam enquanto está aberta): marca como lida.
  const conversaAberta = lista.find((c) => c.id === selecionada) ?? null;
  useEffect(() => {
    if (!conversaAberta || conversaAberta.naoLidas === 0 || !abaVisivel()) return;
    const id = conversaAberta.id;
    setLista((l) => l.map((c) => (c.id === id ? { ...c, naoLidas: 0 } : c)));
    void conversas.marcarLida(id).catch(() => undefined);
  }, [conversaAberta]);

  // Aberta por link e fora da lista (busca, ou além das 100 mais recentes): busca o cabeçalho.
  const [avulsa, setAvulsa] = useState<ConversaResumo | null>(null);
  useEffect(() => {
    if (!selecionada || conversaAberta || !carregouLista) {
      setAvulsa(null);
      return;
    }
    let vivo = true;
    conversas
      .detalhe(selecionada)
      .then((c) => vivo && setAvulsa(c))
      .catch((e) => vivo && setAviso({ tom: 'erro', texto: mensagemDoErro(e) }));
    return () => {
      vivo = false;
    };
  }, [selecionada, conversaAberta, carregouLista]);
  const cabecalho = conversaAberta ?? avulsa;

  async function carregarAnteriores() {
    if (!selecionada || !mensagens.length) return;
    setCarregandoAnteriores(true);
    try {
      const anteriores = await conversas.mensagens(selecionada, mensagens[0]!.criadaEm);
      if (abertaRef.current !== selecionada) return;
      setMensagens((atuais) => [...anteriores.filter((a) => !atuais.some((m) => m.id === a.id)), ...atuais]);
      setTemAnteriores(anteriores.length >= POR_PAGINA);
    } catch (e) {
      setAviso({ tom: 'erro', texto: mensagemDoErro(e) });
    } finally {
      setCarregandoAnteriores(false);
    }
  }

  async function enviar(texto: string): Promise<boolean> {
    if (!selecionada) return false;
    setAviso(null);
    try {
      const nova = await conversas.responder(selecionada, texto);
      setMensagens((atuais) => [...atuais, nova]);
      void carregarLista();
      return true;
    } catch (e) {
      setAviso({ tom: 'erro', texto: mensagemDoErro(e) });
      return false;
    }
  }

  // ---------------------------------------------------------------- guarda das mensagens

  async function abrirGuarda() {
    setAjustandoGuarda((v) => !v);
    if (guarda === null) {
      try {
        setGuarda((await conversas.configuracao()).retencaoDias);
      } catch (e) {
        setAviso({ tom: 'erro', texto: mensagemDoErro(e) });
      }
    }
  }

  async function salvarGuarda() {
    if (guarda === null) return;
    setSalvandoGuarda(true);
    try {
      await conversas.salvarConfiguracao(guarda);
      setAviso({
        tom: 'sucesso',
        texto: guarda === 0 ? 'Todas as mensagens ficam guardadas.' : `Mensagens com mais de ${guarda} dias passam a ser apagadas, de hora em hora.`,
      });
      setAjustandoGuarda(false);
    } catch (e) {
      setAviso({ tom: 'erro', texto: mensagemDoErro(e) });
    } finally {
      setSalvandoGuarda(false);
    }
  }

  // ---------------------------------------------------------------- tela

  if (erroLista?.desligada) {
    return (
      <div className="space-y-6">
        <CabecalhoPagina icone={<IconeBalao />} sobretitulo="Operação" titulo="Conversas" descricao="O WhatsApp da empresa, dentro do Regemcast." />
        <EstadoErro titulo="As conversas não estão ligadas" mensagem={erroLista.texto} aoTentarDeNovo={() => void carregarLista()} />
        <p className="text-sm text-tinta-suave">
          Elas aparecem para números que continuam no WhatsApp Business do celular, com a resposta{' '}
          <strong>“Sim, trazer”</strong> sobre contatos e conversas.{' '}
          <Link href="/whatsapp" className="font-medium text-acento-forte underline underline-offset-4">
            Ir para WhatsApp
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* No celular, com uma conversa aberta, o cabeçalho sai: a tela é do chat. */}
      <div className={cn(selecionada && 'hidden md:block')}>
        <CabecalhoPagina
          icone={<IconeBalao />}
          sobretitulo="Operação"
          titulo="Conversas"
          descricao="As conversas do WhatsApp Business da empresa. O que você responde aqui aparece também no celular."
          acao={
            dono ? (
              <Button variante="secundario" onClick={() => void abrirGuarda()} aria-expanded={ajustandoGuarda}>
                Guarda das mensagens
              </Button>
            ) : undefined
          }
        />
      </div>

      {ajustandoGuarda && dono && (
        <div className="flex flex-wrap items-end gap-3 rounded-card border border-borda bg-superficie p-4">
          <div className="w-full max-w-xs">
            <label htmlFor="guarda" className="mb-1 block text-sm font-medium text-tinta">
              Por quanto tempo guardar as mensagens
            </label>
            <Select
              id="guarda"
              value={guarda ?? ''}
              disabled={guarda === null}
              onChange={(e) => setGuarda(Number(e.target.value))}
            >
              {guarda !== null && !PRAZOS.some(([d]) => d === guarda) && <option value={guarda}>{guarda} dias</option>}
              {PRAZOS.map(([d, rotulo]) => (
                <option key={d} value={d}>
                  {rotulo}
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={() => void salvarGuarda()} carregando={salvandoGuarda} disabled={guarda === null}>
            Salvar
          </Button>
          <p className="w-full text-xs text-tinta-suave">
            O que passar do prazo é apagado daqui, pela data da mensagem. No celular, nada muda.
          </p>
        </div>
      )}

      {aviso && <Alerta tom={aviso.tom}>{aviso.texto}</Alerta>}

      {!carregouLista ? (
        <EsqueletoLista linhas={4} />
      ) : erroLista ? (
        <EstadoErro titulo="Não consegui carregar as conversas" mensagem={erroLista.texto} aoTentarDeNovo={() => void carregarLista()} />
      ) : (
        <div
          className={cn(
            'flex w-full overflow-hidden rounded-card border border-borda bg-superficie shadow-card',
            // Computador: as duas colunas na altura da tela. Celular: conversa
            // aberta ocupa a tela inteira (menos a barra do topo); a lista tem
            // a altura que precisa, e a página rola.
            'md:h-[calc(100dvh-15rem)] md:min-h-[480px]',
            selecionada ? 'h-[calc(100dvh-7rem)]' : 'min-h-[50vh]',
          )}
        >
          <div className={cn('w-full min-w-0 shrink-0 border-r border-borda md:w-[340px]', selecionada ? 'hidden md:block' : 'block')}>
            <ListaConversas
              itens={lista}
              selecionada={selecionada}
              busca={busca}
              aoBuscar={setBusca}
              aoSelecionar={setSelecionada}
              carregou={carregouLista}
            />
          </div>
          <div className={cn('min-w-0 flex-1', selecionada ? 'block' : 'hidden md:block')}>
            {selecionada && cabecalho ? (
              <PainelConversa
                conversa={cabecalho}
                mensagens={mensagens}
                temAnteriores={temAnteriores}
                carregandoAnteriores={carregandoAnteriores}
                aoCarregarAnteriores={() => void carregarAnteriores()}
                aoVoltar={() => {
                  setSelecionada(null);
                  const url = new URL(window.location.href);
                  url.searchParams.delete('c');
                  window.history.replaceState(null, '', url);
                }}
                aoEnviar={enviar}
              />
            ) : (
              <div className="grid h-full place-items-center p-6 text-center text-sm text-tinta-suave">
                <div className="space-y-1">
                  <p className="font-medium text-tinta">Escolha uma conversa à esquerda.</p>
                  <p>Mensagens novas aparecem sozinhas, sem precisar recarregar.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
