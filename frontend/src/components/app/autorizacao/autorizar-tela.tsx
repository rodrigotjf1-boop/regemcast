'use client';

import { useCallback, useEffect, useState } from 'react';

import { IconeAlerta, IconeCadeado, IconeCheck, IconeFechar, IconePausa } from '@/components/app/icones';
import { useSessao } from '@/components/app/sessao';
import { Button } from '@/components/ui/button';
import { EstadoErro } from '@/components/ui/estado-erro';
import { Spinner } from '@/components/ui/spinner';
import { ErroApi, mensagemDoErro } from '@/lib/api';
import { auth, autorizacao } from '@/lib/servicos';
import type { RespostaDaAutorizacao } from '@/lib/tipos';
import { CartaoSituacao } from './cartao-situacao';
import { FormularioAutorizacao, type DecisaoDaTela, type ErroDoEnvio } from './formulario-autorizacao';
import { MolduraAutorizacao } from './moldura-autorizacao';

type Estado =
  | { tipo: 'carregando' }
  | { tipo: 'erro'; mensagem: string }
  | { tipo: 'resposta'; resposta: RespostaDaAutorizacao }
  | { tipo: 'voltando'; destino: string; titulo: string; texto: string; pronto: boolean; aplicativo: string };

const PAPEL: Record<string, string> = { dono: 'dono', operador: 'operador' };

/**
 * A página da autorização por clique (Hub DMS B1): o aplicativo mandou a pessoa
 * para cá com o `client_id` e o número do pedido. Tudo o que a página decide
 * vem do servidor: a situação, o texto, a volta. A página nunca monta um
 * endereço de volta: ele chega pronto da API (o endereço cadastrado do aplicativo).
 */
export function AutorizarTela() {
  const { sessao } = useSessao();
  const [pedido, setPedido] = useState<{ clientId: string; requestUri: string } | null>(null);
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' });
  const [enviando, setEnviando] = useState(false);
  const [erroDoEnvio, setErroDoEnvio] = useState<ErroDoEnvio>(null);

  const carregar = useCallback(async (p: { clientId: string; requestUri: string }) => {
    setEstado({ tipo: 'carregando' });
    try {
      setEstado({ tipo: 'resposta', resposta: await autorizacao.ler(p.clientId, p.requestUri) });
    } catch (falha) {
      setEstado({ tipo: 'erro', mensagem: mensagemDoErro(falha) });
    }
  }, []);

  useEffect(() => {
    // Lido do `window` de propósito: `useSearchParams` pediria um limite de Suspense só para ler dois parâmetros.
    const busca = new URLSearchParams(window.location.search);
    const p = { clientId: busca.get('client_id') ?? '', requestUri: busca.get('request_uri') ?? '' };
    setPedido(p);
    void carregar(p);
  }, [carregar]);

  function voltar(destino: string, d: { pronto: boolean; aplicativo: string; titulo: string; texto: string }) {
    setEstado({ tipo: 'voltando', destino, ...d });
    window.location.assign(destino);
  }

  async function autorizar(d: DecisaoDaTela, aplicativo: string, pedeMais: boolean) {
    if (!pedido) return;
    setEnviando(true);
    setErroDoEnvio(null);
    try {
      const { redirect } = await autorizacao.autorizar({ ...pedido, ...d });
      voltar(redirect, {
        pronto: true,
        aplicativo,
        titulo: pedeMais ? `Pronto: o ${aplicativo} passa a ver o que você liberou` : `Pronto: o ${aplicativo} está ligado à sua conta`,
        texto: 'Você recebe um e-mail com o que foi liberado. Para desligar, use Integrações › Aplicativos conectados.',
      });
    } catch (falha) {
      setEnviando(false);
      if (falha instanceof ErroApi && falha.status === 422) {
        setErroDoEnvio({ campo: 'senha', mensagem: falha.message });
      } else if (falha instanceof ErroApi && [403, 410, 423, 503].includes(falha.status)) {
        // A situação mudou (trava, pedido gasto, papel, parada): a página pergunta de novo ao servidor.
        void carregar(pedido);
      } else {
        setErroDoEnvio({ campo: 'geral', mensagem: mensagemDoErro(falha) });
      }
    }
  }

  async function recusar(aplicativo: string, pedeMais: boolean) {
    if (!pedido) return;
    setEnviando(true);
    try {
      const { redirect } = await autorizacao.recusar(pedido);
      voltar(redirect, {
        pronto: false,
        aplicativo,
        titulo: pedeMais ? 'Nada mudou' : 'Nada foi compartilhado',
        texto: pedeMais ? `O ${aplicativo} continua só com o que já tinha.` : `Você cancelou. O ${aplicativo} não recebeu nenhum dado.`,
      });
    } catch (falha) {
      setEnviando(false);
      if (falha instanceof ErroApi && falha.status === 410) void carregar(pedido);
      else setErroDoEnvio({ campo: 'geral', mensagem: mensagemDoErro(falha) });
    }
  }

  async function entrarComOutraConta() {
    const atual = window.location.pathname + window.location.search;
    await auth.sair().catch(() => undefined);
    window.location.replace(`/entrar?de=${encodeURIComponent(atual)}`);
  }

  const pessoa = estado.tipo === 'resposta' && 'pessoa' in estado.resposta ? estado.resposta.pessoa : { nome: sessao.usuario.nome, papel: sessao.usuario.papel };
  const moldura = (filhos: React.ReactNode) => (
    <MolduraAutorizacao contaNome={sessao.conta.nome} pessoa={{ nome: pessoa.nome, papel: PAPEL[pessoa.papel] ?? pessoa.papel }}>
      {filhos}
    </MolduraAutorizacao>
  );

  if (estado.tipo === 'carregando') {
    return moldura(
      <div className="grid place-items-center py-16">
        <Spinner rotulo="Abrindo o pedido de autorização…" />
      </div>,
    );
  }

  if (estado.tipo === 'erro') {
    return moldura(
      <div className="w-full max-w-md">
        <EstadoErro titulo="Não consegui abrir o pedido de autorização" mensagem={estado.mensagem} aoTentarDeNovo={() => pedido && void carregar(pedido)} />
      </div>,
    );
  }

  if (estado.tipo === 'voltando') {
    return moldura(
      <CartaoSituacao tom={estado.pronto ? 'sucesso' : 'atencao'} icone={estado.pronto ? <IconeCheck className="h-6 w-6" /> : <IconeFechar className="h-6 w-6" />} titulo={estado.titulo}>
        <p>{estado.texto}</p>
        <p className="inline-flex items-center justify-center gap-2 font-semibold" role="status">
          <Spinner rotulo={null} className="h-4 w-4" /> Voltando ao {estado.aplicativo}…
        </p>
        <p className="text-xs">
          Se não voltar sozinho,{' '}
          <a className="font-semibold text-acento-forte underline underline-offset-2" href={estado.destino}>
            continue por aqui
          </a>
          .
        </p>
      </CartaoSituacao>,
    );
  }

  const r = estado.resposta;
  const irParaOProduto = (
    <a href="/integracoes" className="inline-flex h-10 items-center justify-center rounded-xl border border-borda bg-superficie px-4 text-sm font-semibold text-tinta">
      Ir para o Regemcast
    </a>
  );

  switch (r.situacao) {
    case 'indisponivel':
      return moldura(
        <CartaoSituacao tom="atencao" icone={<IconePausa className="h-6 w-6" />} titulo="A autorização por clique ainda não está ligada" acoes={irParaOProduto}>
          <p>Por enquanto, este caminho não aceita pedidos. Nada foi compartilhado.</p>
        </CartaoSituacao>,
      );
    case 'invalido':
      return moldura(
        <CartaoSituacao
          tom="erro"
          icone={<IconeAlerta className="h-6 w-6" />}
          titulo="Este pedido de autorização não vale"
          acoes={
            <>
              {irParaOProduto}
              {r.aplicativo ? (
                <a href={r.aplicativo.inicio} className="inline-flex h-10 items-center justify-center rounded-xl bg-acento px-4 text-sm font-semibold text-acento-contraste">
                  Voltar ao {r.aplicativo.nome}
                </a>
              ) : null}
            </>
          }
        >
          <p>
            Ele já foi usado, venceu (vale 10 minutos) ou chegou incompleto. Por segurança, o Regemcast não manda você para um endereço que veio no link. Nada
            foi compartilhado.
          </p>
          <p className="rounded-xl border border-borda bg-superficie-2 px-4 py-3 text-left text-[13px]">
            Para tentar de novo, volte ao {r.aplicativo?.nome ?? 'aplicativo'} e comece pela conexão com o Regemcast.
          </p>
        </CartaoSituacao>,
      );
    case 'pausado':
      return moldura(
        <CartaoSituacao tom="atencao" icone={<IconePausa className="h-6 w-6" />} titulo={`O ${r.aplicativo.nome} está parado pela DMS`} acoes={irParaOProduto}>
          <p>
            A DMS parou o {r.aplicativo.nome} em todos os produtos, por segurança. Enquanto durar, nenhuma autorização nova é aceita, e as que já existem não leem
            nada. Nada foi compartilhado.
          </p>
        </CartaoSituacao>,
      );
    case 'nao_dono':
      return moldura(
        <CartaoSituacao
          tom="atencao"
          icone={<IconeCadeado className="h-6 w-6" />}
          titulo={`Só o dono da conta autoriza o ${r.aplicativo.nome}`}
          acoes={
            <>
              <Button type="button" variante="secundario" disabled={enviando} onClick={() => void recusar(r.aplicativo.nome, false)}>
                Voltar ao {r.aplicativo.nome}
              </Button>
              <Button type="button" onClick={() => void entrarComOutraConta()}>
                Entrar com outra conta
              </Button>
            </>
          }
        >
          <p>
            Você entrou como {r.pessoa.nome}, {PAPEL[r.pessoa.papel] ?? r.pessoa.papel}. Ligar outro produto à conta é decisão do dono da conta
            {r.dono ? ` (${r.dono})` : ''}. Nada foi compartilhado.
          </p>
        </CartaoSituacao>,
      );
    case 'travada':
      return moldura(
        <CartaoSituacao
          tom="erro"
          icone={<IconeCadeado className="h-6 w-6" />}
          titulo={`Autorização travada por ${r.minutos} ${r.minutos === 1 ? 'minuto' : 'minutos'}`}
          acoes={
            <Button type="button" variante="secundario" disabled={enviando} onClick={() => void recusar(r.aplicativo.nome, false)}>
              Voltar ao {r.aplicativo.nome}
            </Button>
          }
        >
          <p>
            Foram cinco senhas erradas seguidas, e nada foi liberado. Depois do prazo, comece de novo pelo {r.aplicativo.nome}. Se esqueceu a senha, use
            &ldquo;Esqueci a senha&rdquo; na entrada do Regemcast.
          </p>
        </CartaoSituacao>,
      );
    case 'escolha': {
      const pedeMais = Boolean(r.tela.jaLigada?.novas.length);
      return moldura(
        <FormularioAutorizacao
          tela={r.tela}
          enviando={enviando}
          erro={erroDoEnvio}
          onAutorizar={(d) => void autorizar(d, r.aplicativo.nome, pedeMais)}
          onCancelar={() => void recusar(r.aplicativo.nome, pedeMais)}
        />,
      );
    }
  }
}
