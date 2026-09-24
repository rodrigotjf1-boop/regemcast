'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { PerguntaIntegrar } from '@/components/app/pergunta-integrar';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { mensagemDoErro } from '@/lib/api';
import { cn } from '@/lib/cn';
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
 *
 * ## Os dois caminhos
 *
 * Manter o WhatsApp Business no celular (coexistência) ou usar um número novo
 * muda o `featureType` que abre a janela da Meta — e não dá para corrigir
 * depois: é outro fluxo, desde o primeiro clique. Por isso a pergunta vem
 * ANTES do botão, e não como configuração escondida.
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
type Modo = 'coexistencia' | 'dedicado';

/**
 * `featureType` que a Meta espera em cada caminho.
 *
 * O valor da coexistência é o que faz a janela aceitar um número que já está
 * em uso no aplicativo. Com string vazia, a Meta trata como número dedicado e
 * recusa o número do celular com a mensagem de "já registrado" — que foi
 * exatamente o que travou o primeiro teste.
 */
const FEATURE_TYPE: Record<Modo, string> = {
  coexistencia: 'whatsapp_business_app_onboarding',
  dedicado: '',
};

export function ConectarWhatsapp({ aoConectar }: { aoConectar?: () => void }) {
  const [etapa, setEtapa] = useState<Etapa>('carregando');
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState<ResultadoConexao | null>(null);
  const [config, setConfig] = useState<ConfigSignup | null>(null);
  const [modo, setModo] = useState<Modo>('coexistencia');
  // Coexistência: trazer contatos e conversas? Sem resposta, não conecta — a
  // resposta precisa estar gravada antes de a agenda começar a chegar.
  const [integrar, setIntegrar] = useState<boolean | null>(null);
  // A janela da Meta é um pop-up. Bloqueado pelo navegador, o FB.login nunca
  // responde e o botão ficaria em "Conectando…" para sempre — parece defeito.
  // Depois de alguns segundos, a tela diz o provável motivo e deixa voltar.
  const [demorou, setDemorou] = useState(false);
  useEffect(() => {
    if (etapa !== 'conectando') {
      setDemorou(false);
      return;
    }
    const t = window.setTimeout(() => setDemorou(true), 8000);
    return () => window.clearTimeout(t);
  }, [etapa]);

  /** Preenchido pelo postMessage, lido no callback do SDK. Ver comentário acima. */
  const infoRef = useRef<InfoDaSessao>({});
  /** O modo escolhido, lido dentro do callback do SDK pelo mesmo motivo da ref acima. */
  const modoRef = useRef<Modo>('coexistencia');
  /** A resposta sobre contatos e conversas, lida no callback pelo mesmo motivo. */
  const integrarRef = useRef<boolean | null>(null);

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
      if (
        evento.origin !== 'https://www.facebook.com' &&
        evento.origin !== 'https://web.facebook.com'
      ) {
        return;
      }
      try {
        const dados = JSON.parse(evento.data as string) as {
          type?: string;
          event?: string;
          data?: InfoDaSessao;
        };
        if (dados.type !== 'WA_EMBEDDED_SIGNUP') return;

        // Guarda cada identificador assim que aparece, em vez de exigir os dois
        // juntos: na coexistência a Meta pode mandar o `waba_id` sem o
        // `phone_number_id`, e exigir os dois faria a mensagem inteira ser
        // descartada — perdendo junto a WABA, que veio.
        if (dados.data?.waba_id) infoRef.current.waba_id = dados.data.waba_id;
        if (dados.data?.phone_number_id) {
          infoRef.current.phone_number_id = dados.data.phone_number_id;
        }
      } catch {
        // A janela manda outras mensagens que não são JSON. Ignorar é o
        // comportamento certo — não é erro.
      }
    }

    window.addEventListener('message', aoReceber);
    return () => window.removeEventListener('message', aoReceber);
  }, []);

  const escolher = useCallback((novo: Modo) => {
    setModo(novo);
    modoRef.current = novo;
  }, []);

  const escolherIntegrar = useCallback((valor: boolean) => {
    setIntegrar(valor);
    integrarRef.current = valor;
  }, []);

  const abrir = useCallback(() => {
    if (!config || !window.FB) return;
    const escolhido = modoRef.current;
    const integrarEscolhido = integrarRef.current;
    if (escolhido === 'coexistencia' && integrarEscolhido === null) {
      setErro('Responda se quer trazer os contatos e as conversas antes de conectar.');
      return;
    }

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
        if (!wabaId) {
          setEtapa('erro');
          setErro('A Meta não informou qual conta foi conectada. Feche a janela e tente de novo.');
          return;
        }

        // O `phone_number_id` pode faltar na coexistência — a Meta documenta
        // isso. Em vez de barrar o cliente, o servidor descobre o número
        // perguntando à WABA.
        whatsapp
          .conectar({
            code,
            wabaId,
            ...(phoneNumberId ? { phoneNumberId } : {}),
            coexistencia: escolhido === 'coexistencia',
            ...(escolhido === 'coexistencia' && integrarEscolhido !== null
              ? { integrar: integrarEscolhido }
              : {}),
          })
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
        extras: {
          setup: {},
          featureType: FEATURE_TYPE[escolhido],
          sessionInfoVersion: '3',
        },
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

        {resultado.coexistencia && (
          <Alerta tom="atencao">
            {resultado.integrarConversas === false
              ? 'Deixe o WhatsApp Business aberto no celular pelos próximos minutos: a Meta faz uma cópia para concluir a conexão. Como você respondeu não, nada da agenda nem das conversas fica guardado aqui.'
              : 'Deixe o WhatsApp Business aberto no celular pelos próximos minutos. Estamos trazendo seus contatos e conversas, e a cópia só acontece com o aplicativo aberto.'}
          </Alerta>
        )}

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
    <div className="space-y-5">
      {erro && <Alerta tom="erro">{erro}</Alerta>}

      <div className="space-y-2 text-sm leading-relaxed text-tinta-suave">
        <p>
          Você vai autorizar o Regemcast a enviar pela sua própria conta do WhatsApp Business. A
          conta continua sendo sua — nós não hospedamos número para ninguém.
        </p>
        <p>
          Não é preciso criar conta de desenvolvedor nem manusear chave nenhuma. A janela é da
          Meta; nós concluímos o resto.
        </p>
      </div>

      <fieldset className="space-y-3" disabled={etapa === 'conectando'}>
        <legend className="text-sm font-semibold text-tinta">Como você quer enviar?</legend>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <OpcaoModo
            valor="coexistencia"
            atual={modo}
            aoEscolher={escolher}
            titulo="Manter meu WhatsApp Business"
            resumo="Mesmo número, mesmo aplicativo no celular."
            marcadores={[
              'Você continua atendendo pelo celular, normalmente',
              'Você escolhe se traz seus contatos e conversas',
              'Envia até 20 mensagens por segundo',
            ]}
            recomendado
          />

          <OpcaoModo
            valor="dedicado"
            atual={modo}
            aoEscolher={escolher}
            titulo="Usar um número só para campanhas"
            resumo="Um número que ainda não está em nenhum WhatsApp."
            marcadores={[
              'O número não pode estar em uso no aplicativo',
              'Começa vazio: sem contatos e sem histórico',
              'Envia até 80 mensagens por segundo',
            ]}
          />
        </div>

        <p className="text-xs leading-relaxed text-tinta-suave">
          {modo === 'coexistencia'
            ? 'Depois de conectar, mantenha o WhatsApp Business aberto no celular por alguns minutos: é quando a cópia acontece. O prazo é de 24 horas — passou disso, a Meta desfaz a conexão e você refaz tudo.'
            : 'Se o número já estiver em uso no aplicativo do WhatsApp, a Meta recusa a conexão. Nesse caso, volte e escolha a primeira opção.'}
        </p>

        {modo === 'coexistencia' && <MudancasNoApp />}
      </fieldset>

      {modo === 'coexistencia' && config && (
        <PerguntaIntegrar
          nome="integrar-conexao"
          valor={integrar}
          aoEscolher={escolherIntegrar}
          declaracao={config.declaracaoIntegracao}
          desabilitada={etapa === 'conectando'}
        />
      )}

      <div className="space-y-2">
        <Button
          onClick={abrir}
          carregando={etapa === 'conectando'}
          disabled={modo === 'coexistencia' && integrar === null}
        >
          {etapa === 'conectando' ? 'Conectando…' : 'Conectar meu número'}
        </Button>
        {modo === 'coexistencia' && integrar === null && etapa !== 'conectando' && (
          <p className="text-xs text-tinta-suave">
            Responda sobre os contatos e as conversas para continuar.
          </p>
        )}
      </div>

      {etapa === 'conectando' && demorou && (
        <Alerta tom="atencao">
          <p>
            A janela da Meta não abriu? O navegador pode ter bloqueado o pop-up. Clique no ícone
            de pop-up bloqueado na barra de endereço, permita para cast.dmsregem.com e tente de
            novo.
          </p>
          <button
            type="button"
            onClick={() => setEtapa('pronto')}
            className="mt-2 text-sm font-medium text-acento-forte underline underline-offset-4"
          >
            Voltar e tentar de novo
          </button>
        </Alerta>
      )}
    </div>
  );
}

/**
 * O que a coexistência tira do WhatsApp Business do cliente.
 *
 * Isto não é letra miúda: quem hoje dispara na mão usa **lista de transmissão**,
 * e a coexistência a deixa somente leitura. Descobrir isso depois de conectar
 * é descobrir que a ferramenta do dia a dia mudou sem aviso — e a culpa, para
 * o cliente, é nossa, não da Meta.
 *
 * Fica recolhido para não assustar antes da hora, mas fica **na mesma tela da
 * escolha**, aberto a um clique, porque a decisão é aqui e não dá para voltar
 * atrás sem refazer o fluxo inteiro.
 */
function MudancasNoApp() {
  return (
    <details className="rounded-card border border-borda bg-superficie-2 p-3">
      <summary className="cursor-pointer text-xs font-medium text-tinta marker:text-tinta-suave">
        O que muda no seu WhatsApp Business
      </summary>

      <div className="mt-3 space-y-3 text-xs leading-relaxed text-tinta-suave">
        <div>
          <p className="font-medium text-tinta">Recursos que deixam de funcionar no celular</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            <li>
              <strong>Listas de transmissão</strong> ficam somente leitura — você passa a disparar
              por aqui, que é justamente o ponto
            </li>
            <li>Editar e apagar mensagem deixam de funcionar nas conversas individuais</li>
            <li>Mensagens temporárias são desativadas nas conversas individuais</li>
            <li>Visualização única e localização em tempo real também são desativadas</li>
          </ul>
        </div>

        <div>
          <p className="font-medium text-tinta">O que você precisa manter</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            <li>
              Abrir o WhatsApp Business no celular ao menos <strong>uma vez a cada 14 dias</strong>,
              ou a conexão cai
            </li>
            <li>O aplicativo na versão 2.24.17 ou mais nova</li>
          </ul>
        </div>

        <p>
          A Meta decide quem pode usar a coexistência olhando o tempo de uso e a qualidade da sua
          conta. Conta muito nova ou com muitas denúncias pode ser recusada — e nesse caso o
          caminho é um número dedicado.
        </p>
      </div>
    </details>
  );
}

/**
 * Uma das duas formas de conectar.
 *
 * É `<input type="radio">` de verdade, só escondido: assim o grupo anda com as
 * setas do teclado e o leitor de tela anuncia "opção 1 de 2" sem termos que
 * reimplementar nada disso com `div` e `aria-*`.
 */
function OpcaoModo({
  valor,
  atual,
  aoEscolher,
  titulo,
  resumo,
  marcadores,
  recomendado,
}: {
  valor: Modo;
  atual: Modo;
  aoEscolher: (m: Modo) => void;
  titulo: string;
  resumo: string;
  marcadores: string[];
  recomendado?: boolean;
}) {
  const escolhida = atual === valor;

  return (
    <label
      className={cn(
        'flex cursor-pointer flex-col gap-2 rounded-card border p-3 transition',
        'focus-within:ring-2 focus-within:ring-acento/40',
        escolhida
          ? 'border-acento bg-acento-suave'
          : 'border-borda bg-superficie hover:border-acento/40',
      )}
    >
      <span className="flex items-start gap-2">
        <input
          type="radio"
          name="modo-conexao"
          value={valor}
          checked={escolhida}
          onChange={() => aoEscolher(valor)}
          className="sr-only"
        />
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border',
            escolhida ? 'border-acento' : 'border-borda',
          )}
        >
          {escolhida && <span className="h-2 w-2 rounded-full bg-acento" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-tinta">{titulo}</span>
          <span className="block text-xs text-tinta-suave">{resumo}</span>
        </span>
        {recomendado && (
          <span className="shrink-0 rounded-full border border-acento/25 bg-superficie px-2 py-0.5 text-[11px] font-medium text-acento-forte">
            Recomendado
          </span>
        )}
      </span>

      <ul className="list-disc space-y-1 pl-9 text-xs leading-relaxed text-tinta-suave">
        {marcadores.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </label>
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
