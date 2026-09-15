'use client';

import { useCallback, useEffect, useState } from 'react';

import { ConectarWhatsapp } from '@/components/app/conectar-whatsapp';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EstadoErro } from '@/components/ui/estado-erro';
import { Spinner } from '@/components/ui/spinner';
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

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-tinta">WhatsApp</h1>
        <p className="text-sm text-tinta-suave">
          Conecte a conta de WhatsApp Business da sua empresa para poder enviar campanhas.
        </p>
      </header>

      {carregando && (
        <div className="flex items-center gap-3 text-sm text-tinta-suave">
          <Spinner /> Carregando…
        </div>
      )}

      {!carregando && erro && (
        <EstadoErro
          titulo="Não consegui carregar a conexão"
          mensagem={erro}
          aoTentarDeNovo={() => void carregar()}
        />
      )}

      {!carregando && !erro && situacao?.conectado === false && (
        <Card>
          <ConectarWhatsapp aoConectar={() => void carregar()} />
        </Card>
      )}

      {!carregando && !erro && situacao?.conectado === true && (
        <div className="space-y-4">
          <Card>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-tinta">
                  {situacao.conta.nome ?? 'Conta conectada'}
                </h2>
                <Badge tom="sucesso">Conectada</Badge>
                {situacao.conta.webhookAssinadoEm ? null : (
                  <Badge tom="atencao">Status de entrega pendente</Badge>
                )}
              </div>
              <p className="numerico text-xs text-tinta-suave">WABA {situacao.conta.wabaId}</p>
              {situacao.conta.moeda && (
                <p className="text-xs text-tinta-suave">
                  Cobrança da Meta em {situacao.conta.moeda}
                </p>
              )}
              <AvisoExpiracao expiraEm={situacao.conta.tokenExpiraEm} />
            </div>
          </Card>

          {situacao.numeros.map((n) => (
            <CartaoNumero key={n.phoneNumberId} numero={n} />
          ))}
        </div>
      )}
    </div>
  );
}

function CartaoNumero({ numero }: { numero: NumeroWhatsapp }) {
  const q = TOM_QUALIDADE[numero.qualidade];

  return (
    <Card>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="numerico text-base font-semibold text-tinta">
              {numero.telefone ?? 'Número sem identificação'}
            </p>
            {numero.nome && <p className="text-sm text-tinta-suave">{numero.nome}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tom={q.tom}>Qualidade: {q.texto}</Badge>
            {numero.coexistencia && <Badge tom="acento">Também no seu celular</Badge>}
            {numero.status === 'registrado' ? (
              <Badge tom="sucesso">Pronto para enviar</Badge>
            ) : (
              <Badge tom="atencao">Registro pendente</Badge>
            )}
          </div>
        </div>

        <div className="rounded-card border border-borda bg-superficie-2 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-tinta-suave">
            Limite da Meta
          </p>
          <p className="numerico mt-1 text-lg text-tinta">
            {numero.tierLimite === null
              ? 'Sem teto'
              : numero.tierLimite
                ? `${numero.tierLimite.toLocaleString('pt-BR')} pessoas / 24h`
                : 'Ainda não informado'}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-tinta-suave">
            Este limite é da Meta e conta <strong>pessoas diferentes</strong> em 24 horas — é
            separado do teto do seu plano. Conta nova começa em 250 e sobe conforme o histórico
            de envios.
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

        {/*
          Lembrete permanente, não aviso de uma vez só: a Meta derruba a conexão
          de quem passa 14 dias sem abrir o aplicativo. Quem conecta e some volta
          a precisar de todo o fluxo, sem entender por quê.
        */}
        {numero.coexistencia && (
          <p className="text-xs leading-relaxed text-tinta-suave">
            Abra o WhatsApp Business no celular ao menos <strong>uma vez a cada 14 dias</strong>.
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
