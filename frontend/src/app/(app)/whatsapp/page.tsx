'use client';

import { useCallback, useEffect, useState } from 'react';

import { ConectarWhatsapp } from '@/components/app/conectar-whatsapp';
import { IconeCelular, IconeConversa, IconeEscudo, IconeRaio } from '@/components/app/icones';
import { IntegracaoDoNumero } from '@/components/app/integracao-do-numero';
import { useSessao } from '@/components/app/sessao';
import { CabecalhoPagina } from '@/components/ui/cabecalho-pagina';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EsqueletoLista } from '@/components/ui/esqueleto';
import { EstadoErro } from '@/components/ui/estado-erro';
import { mensagemDoErro } from '@/lib/api';
import { whatsapp } from '@/lib/servicos';
import type {
  NumeroWhatsapp,
  QualidadeNumero,
  SincronizacaoNumero,
  SituacaoWhatsapp,
} from '@/lib/tipos';

/**
 * Tela de conexão do WhatsApp.
 *
 * Mostra dois limites lado a lado, e isso é deliberado: o teto do plano do
 * Regemcast e o **tier da Meta** são números diferentes, e quem não vê os dois
 * acha que o produto travou quando na verdade foi a Meta. Conta nova começa em
 * 250 usuários únicos por 24 horas, independentemente do plano contratado.
 */

const TOM_QUALIDADE: Record<QualidadeNumero, { tom: 'sucesso' | 'atencao' | 'erro' | 'neutro'; texto: string }> = {
  verde: { tom: 'sucesso', texto: 'Boa' },
  amarela: { tom: 'atencao', texto: 'Em atenção' },
  vermelha: { tom: 'erro', texto: 'Ruim' },
  desconhecida: { tom: 'neutro', texto: 'Sem informação' },
};

export default function PaginaWhatsapp() {
  const { sessao } = useSessao();
  const dono = sessao.usuario.papel === 'dono';
  const [situacao, setSituacao] = useState<SituacaoWhatsapp | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      setSituacao(await whatsapp.situacao());
    } catch (e) {
      // Nunca preenche o buraco com zero: se a leitura falhou, não sabemos o
      // estado da conexão, e afirmar "não conectado" seria inventar um fato.
      setErro(mensagemDoErro(e));
      setSituacao(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Depois de uma resposta no cartão: relê sem o esqueleto, para a tela não
  // piscar nem apagar o aviso de "resposta salva". Se falhar, fica o que está.
  const atualizar = useCallback(async () => {
    try {
      setSituacao(await whatsapp.situacao());
    } catch {
      /* mantém o que está na tela */
    }
  }, []);

  return (
    <div className="space-y-6 lg:space-y-8">
      <CabecalhoPagina
        icone={<IconeConversa />}
        sobretitulo="Configuração"
        titulo="WhatsApp"
        descricao="Conecte a conta de WhatsApp Business da sua empresa para poder enviar campanhas."
      />

      {carregando && <EsqueletoLista linhas={2} />}

      {!carregando && erro && (
        <EstadoErro
          titulo="Não consegui carregar a conexão"
          mensagem={erro}
          aoTentarDeNovo={() => void carregar()}
        />
      )}

      {!carregando && !erro && situacao?.conectado === false && (
        <Card className="anima-entrada">
          <ConectarWhatsapp aoConectar={() => void carregar()} />
        </Card>
      )}

      {!carregando && !erro && situacao?.conectado === true && (
        <div className="escalonado space-y-4">
          <section className="relative isolate overflow-hidden rounded-3xl bg-lateral p-6 text-lateral-tinta shadow-flutuante sm:p-8">
            <div aria-hidden="true" className="fundo-pontos-claro absolute inset-0 -z-10" />
            <div
              aria-hidden="true"
              className="anima-aurora absolute -right-16 -top-24 -z-10 h-72 w-72 rounded-full bg-acento/25 blur-3xl"
            />
            <div className="flex flex-wrap items-center gap-5">
              <span className="relative grid h-16 w-16 shrink-0 place-items-center">
                <span aria-hidden="true" className="ponto-vivo absolute inset-3 rounded-2xl text-acento/40" />
                <span className="relative grid h-16 w-16 place-items-center rounded-2xl bg-acento text-acento-contraste shadow-brilho">
                  <IconeEscudo className="h-8 w-8" />
                </span>
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold text-lateral-tinta">
                    {situacao.conta.nome ?? 'Conta conectada'}
                  </h2>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-acento/40 bg-acento/10 px-2.5 py-0.5 text-xs font-medium text-acento">
                    <span className="ponto-vivo h-1.5 w-1.5 rounded-full bg-acento" aria-hidden="true" />
                    Conectada
                  </span>
                  {situacao.conta.webhookAssinadoEm ? null : (
                    <span className="rounded-full border border-realce/50 bg-realce/10 px-2.5 py-0.5 text-xs font-medium text-realce">
                      Status de entrega pendente
                    </span>
                  )}
                </div>
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-lateral-suave">
                  <span className="numerico">WABA {situacao.conta.wabaId}</span>
                  {situacao.conta.moeda && <span>Cobrança da Meta em {situacao.conta.moeda}</span>}
                  <span>
                    {situacao.numeros.length} {situacao.numeros.length === 1 ? 'número' : 'números'}
                  </span>
                </p>
              </div>
            </div>

            {/*
              A Meta cobra as mensagens direto desta conta do WhatsApp: o cartão,
              a moeda e o fuso ficam lá. Sem isso em ordem ela aceita a mensagem e
              recusa em seguida (131042) — o atalho fica aqui, antes do disparo.
            */}
            {situacao.conta.pagamentoUrl ? (
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 pt-4">
                <a
                  href={situacao.conta.pagamentoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-acento/40 bg-acento/10 px-3 text-sm font-medium text-acento transition-colors hover:bg-acento/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
                >
                  Pagamento na Meta <span aria-hidden="true">↗</span>
                  <span className="sr-only"> (abre em outra aba)</span>
                </a>
                <p className="min-w-0 flex-1 text-xs leading-relaxed text-lateral-suave">
                  A Meta cobra as mensagens direto desta conta do WhatsApp. O cartão, a moeda e o fuso
                  horário ficam lá — sem eles em ordem, ela recusa o envio.
                </p>
              </div>
            ) : null}
          </section>

          <AvisoExpiracao expiraEm={situacao.conta.tokenExpiraEm} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {situacao.numeros.map((n) => (
              <CartaoNumero
                key={n.phoneNumberId}
                numero={n}
                podeResponder={dono}
                aoMudar={() => void atualizar()}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CartaoNumero({
  numero,
  podeResponder,
  aoMudar,
}: {
  numero: NumeroWhatsapp;
  podeResponder: boolean;
  aoMudar: () => void;
}) {
  const q = TOM_QUALIDADE[numero.qualidade];

  return (
    <Card className="cartao-interativo">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-realce text-tinta">
              <IconeCelular className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="numerico truncate text-base font-semibold text-tinta">
                {numero.telefone ?? 'Número sem identificação'}
              </p>
              {numero.nome && <p className="truncate text-sm text-tinta-suave">{numero.nome}</p>}
            </div>
          </div>
          {numero.status === 'registrado' ? (
            <Badge tom="sucesso" ponto>
              Pronto para enviar
            </Badge>
          ) : (
            <Badge tom="atencao" ponto vivo>
              Registro pendente
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge tom={q.tom} ponto>
            Qualidade: {q.texto}
          </Badge>
          {numero.coexistencia && <Badge tom="acento">Também no seu celular</Badge>}
          <Badge tom="neutro">
            <IconeRaio className="h-3 w-3" />
            até {numero.vazaoMaxima} msg/s
          </Badge>
        </div>

        <div className="rounded-xl border border-borda bg-superficie-2/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-tinta-suave">
            Limite da Meta
          </p>
          <p className="numerico mt-1 text-2xl font-semibold text-tinta">
            {numero.tierNome === 'TIER_UNLIMITED'
              ? 'Sem teto'
              : numero.tierLimite
                ? `${numero.tierLimite.toLocaleString('pt-BR')} pessoas / 24h`
                : 'Ainda não informado'}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-tinta-suave">
            Este limite é da Meta e conta <strong>pessoas diferentes</strong> em 24 horas — é
            separado do teto do seu plano, e vale para todos os números do seu portfólio na Meta.
            Começa em 250 e sobe para 2.000 (empresa verificada, ou 2.000 entregas de boa
            qualidade em 30 dias); depois 10.000, 100.000 e sem teto, sozinho.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-tinta-suave">
            As campanhas obedecem a esse limite: quando ele enche, a campanha espera e continua
            sozinha quando a janela de 24 horas abrir vaga.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-tinta-suave">
            Velocidade de envio: até{' '}
            <strong className="numerico">{numero.vazaoMaxima}</strong> mensagens por segundo.
            {numero.coexistencia
              ? ' É o teto de quem mantém o aplicativo no celular — um número dedicado chega a 80.'
              : ''}
          </p>
        </div>

        <EstadoSincronizacao numero={numero} />

        {numero.coexistencia && (
          <IntegracaoDoNumero numero={numero} podeResponder={podeResponder} aoMudar={aoMudar} />
        )}

        {/*
          Lembrete permanente, não aviso de uma vez só: a Meta derruba a conexão
          de quem passa 14 dias sem abrir o aplicativo. Quem conecta e some volta
          a precisar de todo o fluxo, sem entender por quê.
        */}
        {numero.coexistencia && (
          <p className="text-xs leading-relaxed text-tinta-suave">
            Abra o WhatsApp Business no celular ao menos <strong>uma vez a cada 13 dias</strong>.
            Sem isso a Meta encerra a conexão e você precisa conectar o número de novo.
          </p>
        )}

        {numero.qualidade === 'amarela' || numero.qualidade === 'vermelha' ? (
          <p className="rounded-card border border-atencao/30 bg-atencao/10 p-3 text-sm leading-relaxed text-atencao">
            Muita gente marcou suas mensagens como indesejadas. Sete dias assim e a Meta reduz
            seu limite de envio. Vale reduzir o volume e revisar para quem está mandando.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * Estado da cópia dos dados do celular (coexistência).
 *
 * Existe porque este é o único passo do onboarding com **prazo**: 24 horas, e
 * quem conta é a Meta. Estourado, ela desfaz a conexão e o cliente refaz tudo.
 * Um "sincronizando" mudo na tela seria a pior versão disso — o cliente fecha
 * o aplicativo no celular achando que já acabou.
 *
 * Número dedicado não tem o que copiar e não mostra nada.
 */
function EstadoSincronizacao({ numero }: { numero: NumeroWhatsapp }) {
  if (!numero.coexistencia || numero.sincronizacao === 'nao_se_aplica') return null;

  const texto = TEXTO_SINCRONIZACAO[numero.sincronizacao];
  if (!texto) return null;

  const horas = numero.horasParaSincronizar;
  const prazo =
    horas === null
      ? null
      : horas <= 0
        ? 'O prazo terminou.'
        : horas < 1
          ? 'Falta menos de 1 hora para o prazo acabar.'
          : 'Faltam ' + Math.floor(horas) + (Math.floor(horas) === 1 ? ' hora' : ' horas') + ' para o prazo acabar.';

  return (
    <div className={'rounded-card border p-3 ' + TOM_SINCRONIZACAO[texto.tom]}>
      <p className="text-sm font-medium">{texto.titulo}</p>
      <p className="mt-1 text-sm leading-relaxed">{texto.explicacao}</p>
      {prazo && <p className="mt-1 text-sm leading-relaxed">{prazo}</p>}
    </div>
  );
}

const TOM_SINCRONIZACAO: Record<'atencao' | 'sucesso' | 'erro', string> = {
  atencao: 'border-atencao/30 bg-atencao/10 text-atencao',
  sucesso: 'border-sucesso/30 bg-sucesso/10 text-sucesso',
  erro: 'border-erro/30 bg-erro/10 text-erro',
};

const TEXTO_SINCRONIZACAO: Partial<
  Record<SincronizacaoNumero, { tom: 'atencao' | 'sucesso' | 'erro'; titulo: string; explicacao: string }>
> = {
  pendente: {
    tom: 'atencao',
    titulo: 'Preparando a cópia dos seus dados',
    explicacao:
      'Mantenha o WhatsApp Business aberto no celular. A cópia dos contatos e das conversas começa em instantes.',
  },
  sincronizando: {
    tom: 'atencao',
    titulo: 'Copiando seus contatos e conversas',
    explicacao:
      'Mantenha o WhatsApp Business aberto no celular até terminar. Se fechar antes, a cópia para onde estiver.',
  },
  concluida: {
    tom: 'sucesso',
    titulo: 'Contatos e conversas copiados',
    explicacao:
      'Você continua atendendo pelo celular normalmente — o que chegar por lá também aparece aqui.',
  },
  expirada: {
    tom: 'erro',
    titulo: 'O prazo para copiar os dados terminou',
    explicacao:
      'A Meta desfez a conexão. Conecte o número de novo e mantenha o WhatsApp Business aberto no celular durante a cópia.',
  },
  falhou: {
    tom: 'erro',
    titulo: 'Não conseguimos copiar os dados do seu celular',
    explicacao:
      'Conecte o número de novo. Na janela da Meta, autorize o compartilhamento dos dados do aplicativo quando ela pedir.',
  },
};

/**
 * Aviso de vencimento da autorização.
 *
 * O template de Embedded Signup que a Meta manda usar emite token com prazo
 * (60 dias). Sem este aviso, o cliente descobre que está desconectado quando a
 * campanha para com erro 190 — ou seja, no pior momento possível. Com ele, a
 * reconexão acontece em hora escolhida.
 *
 * Aparece só na última semana: avisar 50 dias antes é ruído que ensina a
 * ignorar o aviso.
 */
function AvisoExpiracao({ expiraEm }: { expiraEm: string | null }) {
  if (!expiraEm) return null;

  const dias = Math.ceil((new Date(expiraEm).getTime() - Date.now()) / 86_400_000);
  if (dias > 7) return null;

  const venceu = dias <= 0;
  return (
    <p
      className={
        venceu
          ? 'mt-2 rounded-card border border-erro/30 bg-erro/10 p-3 text-sm leading-relaxed text-erro'
          : 'mt-2 rounded-card border border-atencao/30 bg-atencao/10 p-3 text-sm leading-relaxed text-atencao'
      }
    >
      {venceu
        ? 'A autorização do WhatsApp venceu e nenhuma campanha sai até você reconectar.'
        : `A autorização do WhatsApp vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}. Reconecte antes disso para as campanhas não pararem.`}
    </p>
  );
}
