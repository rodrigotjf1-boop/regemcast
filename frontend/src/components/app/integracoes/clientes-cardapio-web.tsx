'use client';

import { useState } from 'react';

import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatarData, formatarNumero } from '@/lib/formato';
import type { SituacaoCardapioWeb } from '@/lib/tipos';

type Status = SituacaoCardapioWeb['sincronizacao']['status'];

const SELO: Record<Status, { texto: string; tom: 'neutro' | 'acento' | 'sucesso' | 'erro' }> = {
  parada: { texto: 'Não importados', tom: 'neutro' },
  rodando: { texto: 'Importando', tom: 'acento' },
  concluida: { texto: 'Importados', tom: 'sucesso' },
  falhou: { texto: 'Parou', tom: 'erro' },
};

/**
 * Os clientes da loja. Só entra quem está com o WhatsApp liberado no Cardápio
 * Web; quem desligou entra já descadastrado, para o número não voltar por uma
 * planilha depois. A declaração de consentimento é a condição da Meta para a
 * empresa iniciar a conversa.
 */
export function ClientesCardapioWeb({
  situacao: s,
  ehDono,
  ocupado,
  aoImportar,
}: {
  situacao: SituacaoCardapioWeb;
  ehDono: boolean;
  ocupado: boolean;
  aoImportar: (consentimento: boolean, evidencia: string) => void;
}) {
  const [consentimento, setConsentimento] = useState(false);
  const [evidencia, setEvidencia] = useState('');
  const sinc = s.sincronizacao;
  const selo = SELO[sinc.status];

  return (
    <section aria-labelledby="clientes-cw" className="space-y-3 rounded-card border border-borda p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="clientes-cw" className="text-sm font-semibold text-tinta">
          Clientes
        </h3>
        <Badge tom={selo.tom} ponto={sinc.status !== 'rodando'} vivo={sinc.status === 'rodando'}>
          {selo.texto}
        </Badge>
      </div>

      {sinc.status === 'rodando' ? (
        <Progresso sinc={sinc} lojaNome={s.lojaNome} />
      ) : (
        <>
          {sinc.status === 'falhou' && sinc.erro && <Alerta tom="erro">{sinc.erro}</Alerta>}
          {sinc.status === 'concluida' && (
            <p className="text-sm leading-relaxed text-tinta">
              Importação de {formatarData(sinc.concluidaEm)}: {formatarNumero(sinc.lidos)} clientes lidos,{' '}
              {formatarNumero(sinc.novos)} novos na base
              {sinc.bloqueados
                ? `, ${formatarNumero(sinc.bloqueados)} com WhatsApp desligado (entraram descadastrados)`
                : ''}
              {sinc.invalidos ? `, ${formatarNumero(sinc.invalidos)} sem telefone válido` : ''}. Os liberados estão
              na lista <strong>Clientes Cardápio Web</strong>.
            </p>
          )}
          {sinc.status === 'parada' && (
            <p className="text-sm leading-relaxed text-tinta-suave">
              Traga a base de clientes da loja. O histórico de compras vem junto.
            </p>
          )}

          {ehDono ? (
            <div className="space-y-3">
              <div className="space-y-3 rounded-lg bg-superficie-2 p-3">
                <label className="flex items-start gap-3 text-sm text-tinta">
                  <input
                    type="checkbox"
                    checked={consentimento}
                    onChange={(e) => setConsentimento(e.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0"
                  />
                  <span>
                    Declaro que os clientes da minha loja <strong>autorizaram</strong> receber mensagens desta
                    empresa no WhatsApp.
                  </span>
                </label>
                <div className="space-y-1">
                  <Label htmlFor="evidencia-cw">Como eles autorizaram? (opcional)</Label>
                  <Input
                    id="evidencia-cw"
                    value={evidencia}
                    onChange={(e) => setEvidencia(e.target.value)}
                    placeholder="Aceite no cadastro do cardápio, pedido pelo WhatsApp…"
                  />
                </div>
                <p className="text-xs leading-relaxed text-tinta-suave">
                  Quem desligou o WhatsApp no Cardápio Web entra descadastrado. Quem já está na sua base mantém o
                  cadastro que tinha — nada é sobrescrito.
                </p>
              </div>
              <Button
                onClick={() => aoImportar(consentimento, evidencia)}
                carregando={ocupado}
                disabled={!consentimento}
              >
                {sinc.status === 'concluida' ? 'Importar de novo' : 'Importar clientes'}
              </Button>
            </div>
          ) : (
            <Alerta tom="informacao">Só o dono da conta pode importar os clientes da loja.</Alerta>
          )}
        </>
      )}
    </section>
  );
}

function Progresso({ sinc, lojaNome }: { sinc: SituacaoCardapioWeb['sincronizacao']; lojaNome: string | null }) {
  const total = sinc.totalPaginas ?? 0;
  const pct = total ? Math.min(100, Math.round((sinc.pagina / total) * 100)) : 0;
  return (
    <div className="space-y-3">
      <p className="text-sm text-tinta">
        Importando os clientes de <strong>{lojaNome}</strong>… pode fechar esta tela, a importação continua no
        servidor.
      </p>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-superficie-2"
        role="progressbar"
        aria-label="Importação dos clientes"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-acento transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="numerico text-xs text-tinta-suave">
        {formatarNumero(sinc.lidos)} lidos · {formatarNumero(sinc.novos)} novos
        {total ? ` · página ${sinc.pagina} de ${total}` : ''}
      </p>
    </div>
  );
}
