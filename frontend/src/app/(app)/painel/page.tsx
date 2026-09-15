'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { MedidorUso } from '@/components/app/medidor-uso';
import { useSessao } from '@/components/app/sessao';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardCabecalho, CardCorpo } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { EstadoErro } from '@/components/ui/estado-erro';
import { Spinner } from '@/components/ui/spinner';
import { mensagemDoErro } from '@/lib/api';
import { formatarData, formatarNumero } from '@/lib/formato';
import { conta as servicoConta } from '@/lib/servicos';
import type { ResumoConta } from '@/lib/tipos';

/**
 * O caminho até o primeiro disparo.
 *
 * Passo com `href` já existe e é clicável; os demais mostram "em breve" e são
 * inertes. O cartão não mente sobre o que está pronto.
 */
const PROXIMOS_PASSOS: ReadonlyArray<{ titulo: string; descricao: string; href?: string }> = [
  {
    titulo: 'Conectar o número',
    href: '/whatsapp',
    descricao:
      'Você informa o número e nós concluímos a conexão com a Meta. Nenhuma conta de desenvolvedor do seu lado.',
  },
  {
    titulo: 'Importar contatos',
    descricao: 'Planilha ou CSV, com checagem de número e de quem pediu para não receber.',
  },
  {
    titulo: 'Criar um modelo',
    descricao: 'Modelos passam por aprovação da Meta antes do primeiro envio — cuidamos do envio.',
  },
  {
    titulo: 'Disparar campanha',
    descricao: 'Escolhe o público, o modelo e a janela de envio; o painel acompanha entrega e resposta.',
  },
];

/**
 * Painel da conta.
 *
 * REGRA desta tela: número só aparece quando veio do servidor. Se a carga
 * falhar, cada cartão mostra o motivo e o "Tentar de novo" — nunca um zero de
 * consolo. "Nenhum disparo ainda" e "não consegui ler o consumo" são fatos
 * diferentes, e trocar um pelo outro faz o cliente decidir errado.
 */
export default function Painel() {
  const { sessao } = useSessao();
  const [resumo, setResumo] = useState<ResumoConta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (sinal?: AbortSignal) => {
    setCarregando(true);
    setErro(null);
    try {
      setResumo(await servicoConta.resumo(sinal));
    } catch (falha) {
      if (falha instanceof DOMException && falha.name === 'AbortError') return;
      // Zera o resumo antigo: dado que não pôde ser relido não vale como verdade.
      setResumo(null);
      setErro(mensagemDoErro(falha));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    const controle = new AbortController();
    void carregar(controle.signal);
    return () => controle.abort();
  }, [carregar]);

  // O nome da conta vem da sessão, que já está carregada — por isso o cabeçalho
  // continua correto mesmo quando o resumo falha.
  const nomeConta = resumo?.conta.nome ?? sessao.conta.nome;
  const plano = resumo?.plano ?? null;
  const uso = resumo?.uso ?? null;
  const cicloFim = resumo?.assinatura?.cicloFim ?? null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-tinta-suave">
          Olá, {sessao.usuario.nome.split(' ')[0] || sessao.usuario.nome}.
        </p>
        <h1 className="text-2xl">{nomeConta}</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardCabecalho titulo="Plano" />
          <CardCorpo className="space-y-2">
            {carregando ? (
              <p className="flex items-center gap-2 py-2 text-sm text-tinta-suave">
                <Spinner rotulo={null} />
                Carregando o plano…
              </p>
            ) : erro ? (
              <EstadoErro
                titulo="Não consegui ler o seu plano"
                mensagem={erro}
                aoTentarDeNovo={() => void carregar()}
              />
            ) : (
              <>
                <p className="text-lg font-semibold">{plano?.nome ?? 'Sem plano definido'}</p>
                <p className="text-sm text-tinta-suave">
                  {plano
                    ? 'Teto de ' + formatarNumero(plano.disparosMes) + ' disparos por ciclo.'
                    : 'Assim que seu plano for definido, ele aparece aqui.'}
                </p>
              </>
            )}
          </CardCorpo>
        </Card>

        <Card className="lg:col-span-2">
          <CardCabecalho
            titulo="Uso do ciclo"
            descricao={
              cicloFim
                ? 'O ciclo atual vai até ' + formatarData(cicloFim) + '.'
                : 'Contagem de disparos aceitos pela Meta no ciclo corrente.'
            }
          />
          <CardCorpo>
            {carregando ? (
              <p className="flex items-center gap-2 py-2 text-sm text-tinta-suave">
                <Spinner rotulo={null} />
                Carregando o consumo…
              </p>
            ) : erro || !uso ? (
              <EstadoErro
                titulo="Não consegui ler o seu consumo"
                mensagem={erro ?? 'A resposta do servidor veio sem o consumo do ciclo.'}
                aoTentarDeNovo={() => void carregar()}
              />
            ) : uso.disparos === 0 ? (
              <EmptyState
                titulo="Nenhum disparo ainda"
                descricao={
                  uso.teto === null
                    ? 'A contagem começa no primeiro envio aceito pela Meta.'
                    : 'Você tem ' +
                      formatarNumero(uso.teto) +
                      ' disparos disponíveis neste ciclo. A contagem começa no primeiro envio aceito pela Meta.'
                }
              />
            ) : uso.teto === null ? (
              <p className="text-sm text-tinta-suave">
                <span className="numerico text-2xl font-semibold text-tinta">
                  {formatarNumero(uso.disparos)}
                </span>{' '}
                disparos neste ciclo. Seu plano ainda não tem teto definido.
              </p>
            ) : (
              <MedidorUso usado={uso.disparos} teto={uso.teto} />
            )}
          </CardCorpo>
        </Card>
      </div>

      <Card>
        <CardCabecalho
          titulo="Próximos passos"
          descricao="O caminho até o primeiro disparo. Estamos construindo esta parte agora."
        />
        <CardCorpo>
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {PROXIMOS_PASSOS.map((passo, indice) => (
              <li key={passo.titulo}>
                <PassoBase
                  href={passo.href}
                  className={
                    passo.href
                      ? 'flex h-full gap-3 rounded-lg border border-borda bg-superficie p-4 transition-colors hover:border-acento hover:bg-superficie-2'
                      : 'flex h-full gap-3 rounded-lg border border-dashed border-borda bg-superficie-2/40 p-4 opacity-80'
                  }
                >
                  <span
                    aria-hidden="true"
                    className="numerico mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-borda text-xs text-tinta-suave"
                  >
                    {indice + 1}
                  </span>
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-tinta">
                      {passo.titulo}
                      {passo.href ? null : <Badge tom="acento">em breve</Badge>}
                    </p>
                    <p className="text-sm text-tinta-suave">{passo.descricao}</p>
                  </div>
                </PassoBase>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-tinta-suave">
            Enquanto isso, confira os{' '}
            <Link
              href="/conta"
              className="font-medium text-acento-forte underline underline-offset-4 decoration-acento decoration-2 hover:decoration-4"
            >
              dados da sua conta
            </Link>{' '}
            e convide quem vai operar com você.
          </p>
        </CardCorpo>
      </Card>

      <Card>
        <CardCabecalho titulo="Campanhas" descricao="Histórico de disparos desta conta." />
        <CardCorpo>
          <EmptyState
            titulo="Nada disparado por aqui ainda"
            descricao="Quando as campanhas chegarem, cada envio aparece nesta lista com status de entrega, leitura e resposta — um por contato."
            acao={
              <Button variante="secundario" disabled>
                Criar campanha · em breve
              </Button>
            }
          />
        </CardCorpo>
      </Card>
    </div>
  );
}

/**
 * Casca de um passo: vira link quando o passo já existe, e uma caixa inerte
 * (com `aria-disabled`) quando ainda não. Assim o leitor de tela também sabe a
 * diferença, não só quem enxerga o tracejado.
 */
function PassoBase({
  href,
  className,
  children,
}: {
  href?: string;
  className: string;
  children: React.ReactNode;
}) {
  if (href) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <div aria-disabled="true" className={className}>
      {children}
    </div>
  );
}
