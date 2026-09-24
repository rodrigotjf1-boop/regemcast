'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { EVENTO_CONVERSAS_ALTERADAS } from '@/components/app/casca';
import { PerguntaIntegrar } from '@/components/app/pergunta-integrar';
import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { mensagemDoErro } from '@/lib/api';
import { whatsapp } from '@/lib/servicos';
import type { NumeroWhatsapp } from '@/lib/tipos';

/**
 * Contatos e conversas do WhatsApp Business, no cartão do número.
 *
 * Só existe para número em coexistência. Três estados:
 *
 * - **sem resposta** — o dono responde aqui (quem conectou antes desta
 *   pergunta existir, ou fechou a tela no meio). O que a Meta já mandou está
 *   guardado esperando, e entra assim que ele disser sim;
 * - **sim** — os contatos estão entrando; o dono pode parar;
 * - **não** — nada fica guardado; o dono pode passar a trazer daqui para frente.
 *
 * Quem não é dono vê o estado, mas não responde: a resposta carrega a
 * declaração sobre a agenda da empresa, e ela é do dono. O servidor recusa do
 * mesmo jeito — esconder aqui só evita o clique à toa.
 */
export function IntegracaoDoNumero({
  numero,
  podeResponder,
  aoMudar,
}: {
  numero: NumeroWhatsapp;
  podeResponder: boolean;
  aoMudar: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [escolha, setEscolha] = useState<boolean | null>(null);
  const [declaracao, setDeclaracao] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const perguntando = podeResponder && (numero.integrarConversas === null || editando);

  // A declaração vem do servidor, e só é buscada quando a pergunta aparece.
  useEffect(() => {
    if (!perguntando || declaracao) return;
    let vivo = true;
    whatsapp
      .config()
      .then((c) => vivo && setDeclaracao(c.declaracaoIntegracao))
      .catch((e) => vivo && setErro(mensagemDoErro(e)));
    return () => {
      vivo = false;
    };
  }, [perguntando, declaracao]);

  async function salvar(integrar: boolean) {
    setErro('');
    setAviso('');
    setSalvando(true);
    try {
      await whatsapp.integrar(numero.phoneNumberId, integrar);
      setAviso(
        integrar
          ? 'Resposta salva. Os contatos que já chegaram entram na sua base em até um minuto.'
          : 'Resposta salva. Nada da agenda nem das conversas deste número fica guardado.',
      );
      setEditando(false);
      setEscolha(null);
      aoMudar();
      // O menu "Conversas" aparece (ou some) sem precisar trocar de tela.
      window.dispatchEvent(new Event(EVENTO_CONVERSAS_ALTERADAS));
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  function parar() {
    if (
      !confirm(
        'Parar de trazer os contatos e as conversas deste número?\n\nO que já entrou continua na sua base. O que chegar daqui para frente não fica guardado.',
      )
    ) {
      return;
    }
    void salvar(false);
  }

  return (
    <div className="space-y-3 rounded-xl border border-borda bg-superficie-2/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-tinta-suave">
        Contatos e conversas do celular
      </p>

      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {aviso && <Alerta tom="sucesso">{aviso}</Alerta>}

      {perguntando ? (
        declaracao ? (
          <div className="space-y-3">
            <PerguntaIntegrar
              nome={`integrar-${numero.phoneNumberId}`}
              valor={escolha}
              aoEscolher={setEscolha}
              declaracao={declaracao}
              desabilitada={salvando}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                tamanho="sm"
                carregando={salvando}
                disabled={escolha === null}
                onClick={() => escolha !== null && void salvar(escolha)}
              >
                Salvar resposta
              </Button>
              {editando && (
                <Button
                  tamanho="sm"
                  variante="secundario"
                  disabled={salvando}
                  onClick={() => {
                    setEditando(false);
                    setEscolha(null);
                  }}
                >
                  Cancelar
                </Button>
              )}
            </div>
          </div>
        ) : (
          !erro && <p className="text-sm text-tinta-suave">Carregando a pergunta…</p>
        )
      ) : numero.integrarConversas === null ? (
        <p className="text-sm leading-relaxed text-tinta-suave">
          O dono da conta ainda não respondeu se quer trazer os contatos e as conversas deste
          número. Até lá, o que chegar do celular fica guardado esperando a resposta.
        </p>
      ) : numero.integrarConversas ? (
        <div className="space-y-2">
          <Badge tom="sucesso" ponto>
            Trazendo para o Regemcast
          </Badge>
          <p className="text-sm leading-relaxed text-tinta-suave">
            Os contatos da agenda entram na lista <strong>WhatsApp Business</strong> deste número.
            Contato novo salvo no celular entra sozinho; contato apagado lá sai da lista, mas não
            da sua base.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/contatos">
              <Button tamanho="sm" variante="secundario">
                Ver contatos
              </Button>
            </Link>
            {podeResponder && (
              <Button tamanho="sm" variante="discreto" disabled={salvando} onClick={parar}>
                Parar de trazer
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Badge tom="neutro">Não trazemos</Badge>
          <p className="text-sm leading-relaxed text-tinta-suave">
            Nada da agenda nem das conversas deste número fica guardado aqui. O número serve só
            para as campanhas.
          </p>
          {podeResponder && (
            <Button tamanho="sm" variante="discreto" onClick={() => setEditando(true)}>
              Passar a trazer
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
