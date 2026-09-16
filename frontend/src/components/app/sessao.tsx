'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { Button } from '@/components/ui/button';
import { EstadoErro } from '@/components/ui/estado-erro';
import { CarregandoMarca } from '@/components/marca/carregando-marca';
import { ErroApi, mensagemDoErro } from '@/lib/api';
import { auth } from '@/lib/servicos';
import type { Sessao } from '@/lib/tipos';

interface ContextoSessao {
  sessao: Sessao;
  /** Recarrega o usuário depois de algo que muda a própria sessão. */
  recarregar: () => Promise<void>;
  sair: () => Promise<void>;
}

const Contexto = createContext<ContextoSessao | null>(null);

/**
 * Guarda de tela autenticada.
 *
 * A sessão vive num cookie httpOnly, então quem decide se o usuário está
 * logado é a API — não há token no navegador para inspecionar. Enquanto a
 * resposta não chega, nada do conteúdo autenticado é montado: é isso que
 * impede a tela de piscar dados antes de descobrir que a sessão caiu.
 *
 * Só o 401 manda para o login. Servidor fora do ar, 500 ou queda de rede NÃO
 * são "sua sessão expirou": mandar o usuário para a tela de login nesses casos
 * o faz digitar a senha à toa e ainda esconde o motivo real da falha.
 */
export function SessaoProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (sinal?: AbortSignal) => {
    const dados = await auth.eu(sinal);
    setSessao(dados);
  }, []);

  useEffect(() => {
    const controle = new AbortController();
    let vivo = true;

    setCarregando(true);
    setErro(null);

    carregar(controle.signal)
      .catch((falha: unknown) => {
        if (falha instanceof DOMException && falha.name === 'AbortError') return;
        if (!vivo) return;
        if (falha instanceof ErroApi && falha.naoAutenticado) {
          const atual = window.location.pathname + window.location.search;
          router.replace('/entrar?de=' + encodeURIComponent(atual));
          return;
        }
        setErro(mensagemDoErro(falha));
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });

    return () => {
      vivo = false;
      controle.abort();
    };
  }, [carregar, router]);

  const sair = useCallback(async () => {
    try {
      await auth.sair();
    } finally {
      // Sai da sessão mesmo se a chamada falhar: o cookie pode já ter vencido,
      // e deixar o usuário preso numa tela "logada" sem dados é pior.
      window.location.replace('/entrar');
    }
  }, []);

  const tentarDeNovo = useCallback(() => {
    setErro(null);
    setCarregando(true);
    carregar()
      .catch((falha: unknown) => {
        if (falha instanceof ErroApi && falha.naoAutenticado) {
          window.location.replace('/entrar');
          return;
        }
        setErro(mensagemDoErro(falha));
      })
      .finally(() => setCarregando(false));
  }, [carregar]);

  if (erro && !sessao) {
    return (
      <main id="conteudo" className="grid min-h-screen place-items-center p-6">
        <div className="w-full max-w-md space-y-4">
          <EstadoErro
            titulo="Não consegui abrir a sua sessão"
            mensagem={erro}
            aoTentarDeNovo={tentarDeNovo}
          />
          <p className="text-center text-sm text-tinta-suave">
            Se continuar assim, entre de novo.{' '}
            <Button
              variante="discreto"
              tamanho="sm"
              onClick={() => window.location.replace('/entrar')}
            >
              Ir para a entrada
            </Button>
          </p>
        </div>
      </main>
    );
  }

  if (carregando || !sessao) {
    return <CarregandoMarca texto="Carregando…" />;
  }

  return (
    <Contexto.Provider value={{ sessao, recarregar: () => carregar(), sair }}>
      {children}
    </Contexto.Provider>
  );
}

export function useSessao(): ContextoSessao {
  const valor = useContext(Contexto);
  if (!valor) throw new Error('useSessao() só funciona dentro de <SessaoProvider>.');
  return valor;
}
