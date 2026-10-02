'use client';

import { useCallback, useEffect, useState } from 'react';

import { ErroQueGuia } from '@/components/app/erro-que-guia';
import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Esqueleto } from '@/components/ui/esqueleto';
import { mensagemDoErro } from '@/lib/api';
import { formatarDataHora } from '@/lib/formato';
import { whatsapp } from '@/lib/servicos';
import type { SaudeDaConta as Saude, SinalDeEnvio } from '@/lib/tipos';

/**
 * A saúde da conta na Meta: "posso enviar agora e, se não, o que eu resolvo?".
 *
 * O servidor pergunta à Meta (o `health_status` da conta e do número, a
 * cobrança e a validade da conexão) e devolve tudo pronto: um sinal geral e um
 * item por coisa conferida, cada problema com o que fazer. A tela não traduz
 * nem decide nada — só mostra, do que mais pede atenção para o que está certo.
 */

const SINAL: Record<SinalDeEnvio, { tom: 'sucesso' | 'atencao' | 'erro' | 'neutro'; ponto: string }> = {
  pode_enviar: { tom: 'sucesso', ponto: 'bg-sucesso' },
  com_restricao: { tom: 'atencao', ponto: 'bg-atencao' },
  bloqueado: { tom: 'erro', ponto: 'bg-erro' },
  desconhecido: { tom: 'neutro', ponto: 'bg-tinta-suave' },
};

export function SaudeDaConta() {
  const [saude, setSaude] = useState<Saude | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [conferindo, setConferindo] = useState(false);

  const ler = useCallback(async (atualizar: boolean) => {
    setErro('');
    try {
      const r = await whatsapp.saude(atualizar);
      setSaude('sinal' in r ? r : null);
    } catch (e) {
      // Sem resposta do servidor não se afirma nada: nem "pode", nem "não pode".
      setErro(mensagemDoErro(e));
    }
  }, []);

  useEffect(() => {
    void ler(false).finally(() => setCarregando(false));
  }, [ler]);

  async function conferir() {
    setConferindo(true);
    await ler(true);
    setConferindo(false);
  }

  if (carregando) {
    return (
      <Card>
        <div className="space-y-3" aria-busy="true" aria-label="Conferindo a saúde da conta na Meta">
          <Esqueleto className="h-5 w-48" />
          <Esqueleto className="h-4 w-full max-w-md" />
          <Esqueleto className="h-4 w-full max-w-sm" />
        </div>
      </Card>
    );
  }

  if (erro && !saude) {
    return (
      <Card>
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-tinta">Saúde da conta na Meta</h2>
          <Alerta tom="atencao">Não consegui conferir a saúde da conta agora. {erro}</Alerta>
          <Button tamanho="sm" variante="secundario" onClick={() => void conferir()} carregando={conferindo}>
            Tentar de novo
          </Button>
        </div>
      </Card>
    );
  }

  if (!saude) return null;
  const geral = SINAL[saude.sinal];

  return (
    <Card className="anima-entrada">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-tinta-suave">Saúde da conta na Meta</p>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-tinta">{saude.titulo}</h2>
              <Badge tom={geral.tom} ponto>
                {saude.sinal === 'pode_enviar'
                  ? 'Tudo certo'
                  : saude.sinal === 'com_restricao'
                    ? 'Atenção'
                    : saude.sinal === 'bloqueado'
                      ? 'Bloqueado'
                      : 'Sem resposta'}
              </Badge>
            </div>
            <p className="text-sm leading-relaxed text-tinta-suave">{saude.resumo}</p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
            <Button tamanho="sm" variante="secundario" onClick={() => void conferir()} carregando={conferindo}>
              Conferir agora
            </Button>
            {saude.lidaEm ? (
              <p className="text-xs text-tinta-suave">Conferida em {formatarDataHora(saude.lidaEm)}</p>
            ) : null}
          </div>
        </div>

        {erro ? <Alerta tom="atencao">Não consegui conferir de novo agora. {erro}</Alerta> : null}

        <ul className="divide-y divide-borda border-t border-borda">
          {saude.itens.map((item) => (
            <li key={item.chave} className="space-y-3 py-3 last:pb-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-tinta">
                  <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${SINAL[item.sinal].ponto}`} />
                  <span className="[overflow-wrap:anywhere]">{item.rotulo}</span>
                </span>
                <span className="text-sm text-tinta-suave [overflow-wrap:anywhere]">{item.resumo}</span>
              </div>
              {/* A conexão que vence já tem o aviso com o botão de reconectar logo abaixo
                  do cartão: aqui fica só a linha. E nenhum problema leva a "Abrir
                  WhatsApp" — a tela já é esta. */}
              {(item.chave === 'conexao' ? [] : item.problemas).map((p, i) => (
                <div key={i} className="rounded-lg border border-borda bg-superficie-2/50 p-3">
                  <ErroQueGuia erro={{ ...p, tela: p.tela === 'whatsapp' ? null : p.tela }} />
                </div>
              ))}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/**
 * O aviso curto para a tela da campanha, antes de disparar ou de retomar: se a
 * Meta aponta um problema, diz qual e leva à tela do WhatsApp, onde está o que
 * fazer. Quieto quando está tudo certo ou quando não deu para conferir.
 */
export function AvisoDaSaude() {
  const [saude, setSaude] = useState<Saude | null>(null);

  useEffect(() => {
    let vivo = true;
    whatsapp
      .saude(false)
      .then((r) => {
        if (vivo && 'sinal' in r) setSaude(r);
      })
      .catch(() => {
        /* Sem resposta, sem aviso: o servidor confere de novo na hora do disparo. */
      });
    return () => {
      vivo = false;
    };
  }, []);

  if (!saude || (saude.sinal !== 'bloqueado' && saude.sinal !== 'com_restricao')) return null;
  const problema = saude.itens.flatMap((i) => i.problemas)[0];
  if (!problema) return null;
  const bloqueado = saude.sinal === 'bloqueado';

  return (
    <div
      role={bloqueado ? 'alert' : 'status'}
      className={`space-y-3 rounded-lg border px-3 py-3 text-sm ${bloqueado ? 'border-erro/30 bg-erro/10' : 'border-atencao/30 bg-atencao/10'}`}
    >
      <p className={`leading-relaxed ${bloqueado ? 'text-erro' : 'text-atencao'}`}>
        {bloqueado
          ? 'A Meta não deixa esta conta enviar agora. Resolva o ponto abaixo antes de disparar.'
          : 'A Meta aponta um ponto de atenção nesta conta. O envio sai, mas vale resolver antes.'}
      </p>
      <div className="rounded-lg border border-borda bg-superficie p-3">
        <ErroQueGuia erro={{ ...problema, tela: problema.tela ?? 'whatsapp' }} />
      </div>
    </div>
  );
}
