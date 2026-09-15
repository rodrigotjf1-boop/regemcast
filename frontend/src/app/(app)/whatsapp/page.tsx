'use client';

import { useCallback, useEffect, useState } from 'react';

import { ConectarWhatsapp } from '@/components/app/conectar-whatsapp';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EstadoErro } from '@/components/ui/estado-erro';
import { Spinner } from '@/components/ui/spinner';
import { mensagemDoErro } from '@/lib/api';
import { whatsapp } from '@/lib/servicos';
import type { NumeroWhatsapp, QualidadeNumero, SituacaoWhatsapp } from '@/lib/tipos';

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
        </div>

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
