'use client';

import { useCallback, useEffect, useState } from 'react';

import { useSessao } from '@/components/app/sessao';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { mensagemDoErro } from '@/lib/api';
import { formatarData, formatarNumero } from '@/lib/formato';
import { cardapioWeb } from '@/lib/servicos';
import type { SituacaoCardapioWeb } from '@/lib/tipos';

/**
 * Importar a base de clientes direto da loja do Cardápio Web.
 *
 * Três momentos: conectar a loja (a chave que o próprio Cardápio Web gera),
 * declarar o consentimento e acompanhar a importação, que roda no servidor —
 * pode fechar a tela no meio.
 *
 * Só entra quem está com o WhatsApp liberado na loja. Quem desligou entra já
 * descadastrado: assim o número também não volta por uma planilha depois.
 */
export function ImportarCardapioWeb({ aoConcluir }: { aoConcluir: () => void }) {
  const { sessao } = useSessao();
  const ehDono = sessao.usuario.papel === 'dono';

  const [s, setS] = useState<SituacaoCardapioWeb | null>(null);
  const [erro, setErro] = useState('');
  const [chave, setChave] = useState('');
  const [consentimento, setConsentimento] = useState(false);
  const [evidencia, setEvidencia] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setS(await cardapioWeb.situacao());
    } catch (e) {
      setErro(mensagemDoErro(e));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Enquanto importa, relê a cada 2 s. Terminou: avisa a página para recarregar a lista.
  const rodando = s?.sincronizacao.status === 'rodando';
  useEffect(() => {
    if (!rodando) return;
    const t = window.setInterval(async () => {
      try {
        const novo = await cardapioWeb.situacao();
        setS(novo);
        if (novo.sincronizacao.status !== 'rodando') aoConcluir();
      } catch {
        // Uma falha de rede não interrompe a importação: ela roda no servidor.
      }
    }, 2000);
    return () => window.clearInterval(t);
  }, [rodando, aoConcluir]);

  async function agir(acao: () => Promise<unknown>) {
    setErro('');
    setOcupado(true);
    try {
      await acao();
      await carregar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  }

  if (!s) {
    return erro ? (
      <Alerta tom="erro">{erro}</Alerta>
    ) : (
      <div className="flex items-center gap-3 text-sm text-tinta-suave">
        <Spinner /> Conferindo a conexão com o Cardápio Web…
      </div>
    );
  }

  const sinc = s.sincronizacao;

  // ------------------------------------------------------------ conectar
  if (!s.conectado) {
    return (
      <div className="space-y-4">
        {erro && <Alerta tom="erro">{erro}</Alerta>}
        <p className="text-sm leading-relaxed text-tinta-suave">
          Traga a base de clientes da sua loja do Cardápio Web, com quem já comprou de você. Só
          entra quem está com o WhatsApp liberado lá.
        </p>
        {!ehDono ? (
          <Alerta tom="informacao">Só o dono da conta pode conectar a loja do Cardápio Web.</Alerta>
        ) : (
          <>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-tinta">
              <li>
                No Portal do Cardápio Web, abra <strong>Configurações → Integrações → API</strong>.
              </li>
              <li>Copie o token da loja e cole abaixo.</li>
            </ol>
            <Alerta tom="atencao">
              Se já existe um token, copie o que está lá. <strong>Gerar um novo</strong> desliga os
              outros sistemas que usam o antigo, como um PDV ou outra integração.
            </Alerta>
            <div className="max-w-md space-y-1.5">
              <Label htmlFor="chave-cw">Token da loja</Label>
              <Input
                id="chave-cw"
                value={chave}
                onChange={(e) => setChave(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-xs text-tinta-suave">
                Conferimos na hora com o Cardápio Web e guardamos cifrado. Ninguém vê de novo, nem você.
              </p>
            </div>
            <Button
              onClick={() => void agir(() => cardapioWeb.conectarChave(chave))}
              carregando={ocupado}
              disabled={chave.trim().length < 10}
            >
              Conectar loja
            </Button>
          </>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------ importando
  if (rodando) {
    const total = sinc.totalPaginas ?? 0;
    const pct = total ? Math.min(100, Math.round((sinc.pagina / total) * 100)) : 0;
    return (
      <div className="space-y-3">
        <p className="text-sm text-tinta">
          Importando os clientes de <strong>{s.lojaNome}</strong>… pode fechar esta tela, a importação
          continua no servidor.
        </p>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-superficie-2"
          role="progressbar"
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

  // ------------------------------------------------------------ conectado
  return (
    <div className="space-y-4">
      {erro && <Alerta tom="erro">{erro}</Alerta>}

      <p className="text-sm text-tinta">
        Loja conectada: <strong>{s.lojaNome}</strong>
      </p>

      {sinc.status === 'falhou' && sinc.erro && <Alerta tom="erro">{sinc.erro}</Alerta>}

      {sinc.status === 'concluida' && (
        <Alerta tom="sucesso">
          Importação de {formatarData(sinc.concluidaEm)}: {formatarNumero(sinc.lidos)} clientes lidos,{' '}
          {formatarNumero(sinc.novos)} novos na base
          {sinc.bloqueados ? `, ${formatarNumero(sinc.bloqueados)} com WhatsApp desligado (entraram descadastrados)` : ''}
          {sinc.invalidos ? `, ${formatarNumero(sinc.invalidos)} sem telefone válido` : ''}. Os liberados estão
          na lista <strong>Clientes Cardápio Web</strong>.
        </Alerta>
      )}

      {ehDono ? (
        <>
          <div className="space-y-3 rounded-card border border-borda bg-superficie-2 p-3">
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

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void agir(() => cardapioWeb.importar(consentimento, evidencia))}
              carregando={ocupado}
              disabled={!consentimento}
            >
              {sinc.status === 'concluida' ? 'Importar de novo' : 'Importar clientes'}
            </Button>
            <Button
              variante="secundario"
              onClick={() => void agir(() => cardapioWeb.desconectar())}
              disabled={ocupado}
            >
              Desconectar loja
            </Button>
          </div>
        </>
      ) : (
        <Alerta tom="informacao">Só o dono da conta pode importar os clientes da loja.</Alerta>
      )}
    </div>
  );
}
