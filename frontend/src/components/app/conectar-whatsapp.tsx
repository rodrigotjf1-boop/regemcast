'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { mensagemDoErro } from '@/lib/api';
import { whatsapp } from '@/lib/servicos';
import type { ConfigSignup, ResultadoConexao } from '@/lib/tipos';

/**
 * Embedded Signup — versão 4.
 *
 * A v2 é descontinuada em 15 de outubro de 2026, então nascemos na v4 e não há
 * migração pela frente.
 *
 * O detalhe que decide se isto funciona: **o `code` vive 30 segundos**. Ele
 * chega no callback do SDK e vai direto para o servidor, no mesmo gesto — sem
 * tela de confirmação no meio, sem guardar em estado para enviar depois. Se
 * esperar o usuário clicar em "confirmar", expira.
 *
 * O `waba_id` e o `phone_number_id` não vêm nesse callback: chegam por
 * `postMessage` da janela do Signup, antes dele. Por isso o listener é
 * registrado ANTES de abrir a janela, e o resultado fica guardado numa ref —
 * estado do React não serve aqui, porque o callback do SDK lê o valor no
 * momento em que dispara, e um `setState` ainda não teria propagado.
 */

interface SdkFacebook {
  init(config: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(
    callback: (resposta: { authResponse?: { code?: string }; status?: string }) => void,
    opcoes: Record<string, unknown>,
  ): void;
}

declare global {
  interface Window {
    FB?: SdkFacebook;
    fbAsyncInit?: () => void;
  }
}

/** Dados que a janela do Signup manda por postMessage. */
interface InfoDaSessao {
  phone_number_id?: string;
  waba_id?: string;
}

type Etapa = 'carregando' | 'pronto' | 'conectando' | 'concluido' | 'erro';

export function ConectarWhatsapp({ aoConectar }: { aoConectar?: () => void }) {
  const [etapa, setEtapa] = useState<Etapa>('carregando');
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState<ResultadoConexao | null>(null);
  const [config, setConfig] = useState<ConfigSignup | null>(null);

  /** Preenchido pelo postMessage, lido no callback do SDK. Ver comentário acima. */
  const infoRef = useRef<InfoDaSessao>({});

  // 1. Busca a configuração e carrega o SDK.
  useEffect(() => {
    let vivo = true;

    (async () => {
      try {
        const c = await whatsapp.config();
        if (!vivo) return;
        setConfig(c);
        await carregarSdk(c);
        if (!vivo) return;
        setEtapa('pronto');
      } catch (e) {
        if (!vivo) return;
        setErro(mensagemDoErro(e));
        setEtapa('erro');
      }
    })();

    return () => {
      vivo = false;
    };
  }, []);

  // 2. Escuta a janela do Signup. Registrado antes de qualquer clique, porque a
  //    mensagem chega ANTES do callback do login.
  useEffect(() => {
    function aoReceber(evento: MessageEvent) {
      // Só aceita mensagem vinda do domínio da Meta. Sem esta checagem,
      // qualquer página aberta em outra aba poderia mandar um payload forjado.
      if (evento.origin !== 'https://www.facebook.com' && evento.origin !== 'https://web.facebook.com') {
        return;
      }
      try {
        const dados = JSON.parse(evento.data as string) as {
          type?: string;
          event?: string;
          data?: InfoDaSessao;
        };
        if (dados.type !== 'WA_EMBEDDED_SIGNUP') return;
        if (dados.data?.phone_number_id) {
          infoRef.current = {
            phone_number_id: dados.data.phone_number_id,
            waba_id: dados.data.waba_id,
          };
        }
      } catch {
        // A janela manda outras mensagens que não são JSON. Ignorar é o
        // comportamento certo — não é erro.
      }
    }

    window.addEventListener('message', aoReceber);
    return () => window.removeEventListener('message', aoReceber);
  }, []);

  const abrir = useCallback(() => {
    if (!config || !window.FB) return;
    setErro('');
    setEtapa('conectando');
    infoRef.current = {};

    window.FB.login(
      (resposta) => {
        const code = resposta?.authResponse?.code;
        const { phone_number_id: phoneNumberId, waba_id: wabaId } = infoRef.current;

        if (!code) {
          // Fechar a janela no meio cai aqui. Não é erro do sistema.
          setEtapa('pronto');
          setErro('A conexão foi cancelada antes de terminar. Você pode tentar de novo.');
          return;
        }
        if (!phoneNumberId || !wabaId) {
          setEtapa('erro');
          setErro(
            'A Meta não informou qual número foi conectado. Feche a janela e tente de novo.',
          );
          return;
        }

        // Direto para o servidor. O código expira em 30 segundos.
        whatsapp
          .conectar({ code, wabaId, phoneNumberId })
          .then((r) => {
            setResultado(r);
            setEtapa('concluido');
            aoConectar?.();
          })
          .catch((e) => {
            setErro(mensagemDoErro(e));
            setEtapa('erro');
          });
      },
      {
        config_id: config.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
      },
    );
  }, [config, aoConectar]);

  if (etapa === 'carregando') {
    return (
      <div className="flex items-center gap-3 text-sm text-tinta-suave">
        <Spinner /> Preparando a conexão…
      </div>
    );
  }

  if (etapa === 'concluido' && resultado) {
    return (
      <div className="space-y-4">
        <Alerta tom="sucesso">
          <strong>{resultado.nome ?? 'Conta conectada'}</strong>
          {resultado.telefone ? ` · ${resultado.telefone}` : ''}
        </Alerta>

        {resultado.pendencias.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-tinta">Falta você fazer</h3>
            <ul className="space-y-2">
              {resultado.pendencias.map((p) => (
                <li
                  key={p}
                  className="rounded-card border border-borda bg-superficie p-3 text-sm leading-relaxed text-tinta-suave"
                >
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {erro && <Alerta tom="erro">{erro}</Alerta>}

      <div className="space-y-2 text-sm leading-relaxed text-tinta-suave">
        <p>
          Você vai autorizar o Regemcast a enviar pela sua própria conta do WhatsApp Business.
          A conta continua sendo sua — nós não hospedamos número para ninguém.
        </p>
        <p>
          Não é preciso criar conta de desenvolvedor nem manusear chave nenhuma. A janela é da
          Meta; nós concluímos o resto.
        </p>
      </div>

      <Button onClick={abrir} carregando={etapa === 'conectando'}>
        {etapa === 'conectando' ? 'Conectando…' : 'Conectar meu número'}
      </Button>
    </div>
  );
}

/**
 * Carrega o SDK da Meta uma vez.
 *
 * Não usamos `next/script` aqui porque o SDK precisa do `fbAsyncInit` definido
 * ANTES de o arquivo executar — e a ordem entre um componente e o `<Script>` do
 * Next não é garantida.
 */
function carregarSdk(config: ConfigSignup): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.FB) return Promise.resolve();

  return new Promise((resolver, rejeitar) => {
    window.fbAsyncInit = () => {
      window.FB?.init({
        appId: config.appId,
        autoLogAppEvents: true,
        xfbml: true,
        version: config.graphVersao,
      });
      resolver();
    };

    const existente = document.getElementById('facebook-jssdk');
    if (existente) {
      resolver();
      return;
    }

    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () =>
      rejeitar(
        new Error(
          'Não conseguimos carregar a janela de conexão da Meta. Verifique sua conexão e recarregue a página.',
        ),
      );
    document.body.appendChild(script);
  });
}
