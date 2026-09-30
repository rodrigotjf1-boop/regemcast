'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { EsqueletoLista } from '@/components/ui/esqueleto';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { cn } from '@/lib/cn';
import { distribuicao, type ContaNoConsole, type LigacaoRegemNoConsole } from '@/lib/servicos';

const LEITURA: Record<LigacaoRegemNoConsole['clientesStatus'], string> = {
  parado: 'parada',
  carga: 'lendo tudo',
  em_dia: 'em dia',
  falhou: 'parou',
};

function quando(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
}

/**
 * O Regem no console: ligar uma conta à empresa dela no Regem, com o token de
 * integração que emitimos no console do Regem (`rgm_it_…`) — a loja não copia
 * nada. A lista começa pelo que espera por nós: a 99 que o dono autorizou e o
 * token ainda não libera (emitir outro com `vendas.99food.ler`), ou o
 * contrário (tirar).
 */
export function PainelRegem({ contas }: { contas: ContaNoConsole[] }) {
  const [ligacoes, setLigacoes] = useState<LigacaoRegemNoConsole[] | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [contaId, setContaId] = useState('');
  const [token, setToken] = useState('');
  const [ligando, setLigando] = useState(false);
  const [desligar, setDesligar] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setLigacoes(await distribuicao.regem());
    } catch (e) {
      setErro(mensagemDoErro(e));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function ligar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setAviso('');
    setLigando(true);
    try {
      const r = await distribuicao.ligarRegem(contaId, token.trim());
      const nome = contas.find((c) => c.id === contaId)?.nome ?? 'A conta';
      setAviso(
        `${nome} ligada a ${r.empresaNome} (${r.lojas.length === 1 ? '1 loja' : `${r.lojas.length} lojas`}). ` +
          `Escopos: ${r.escopos.join(', ')}.`,
      );
      setToken('');
      setContaId('');
      await carregar();
    } catch (err) {
      setErro(mensagemDoErro(err));
    } finally {
      setLigando(false);
    }
  }

  async function confirmarDesligar(id: string) {
    setErro('');
    setAviso('');
    setOcupado(id);
    try {
      await distribuicao.desligarRegem(id);
      setDesligar(null);
      await carregar();
    } catch (err) {
      setErro(mensagemDoErro(err));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="space-y-5">
      {erro ? <Alerta tom="erro">{erro}</Alerta> : null}
      {aviso ? <Alerta tom="sucesso">{aviso}</Alerta> : null}

      <form
        onSubmit={(e) => void ligar(e)}
        className="space-y-3 rounded-card border border-borda bg-superficie p-4 shadow-card"
        aria-labelledby="ligar-regem"
      >
        <h2 id="ligar-regem" className="text-sm font-semibold text-tinta">
          Ligar uma conta ao Regem
        </h2>
        <p className="max-w-prose text-xs leading-relaxed text-tinta-suave">
          Emita o token de integração no console do Regem para o cliente <strong>regemcast</strong>, da empresa inteira,
          com <code>clientes.ler</code>, <code>pedidos.ler</code> e <code>clientes.telefone.ler</code> — e{' '}
          <code>vendas.99food.ler</code> só quando o dono autorizou a 99. O token é conferido no Regem na hora e guardado
          cifrado; ele não aparece de novo. Ligar de novo a mesma empresa troca o token e continua de onde parou.
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto] md:items-end">
          <div className="space-y-1">
            <Label htmlFor="regem-conta">Conta</Label>
            <select
              id="regem-conta"
              value={contaId}
              onChange={(e) => setContaId(e.target.value)}
              required
              className="h-10 w-full rounded-lg border border-borda bg-superficie px-3 text-sm text-tinta"
            >
              <option value="">Escolha a conta…</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="regem-token">Token de integração do Regem</Label>
            <Input
              id="regem-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="rgm_it_…"
              required
            />
          </div>
          <Button type="submit" carregando={ligando} disabled={!contaId || token.trim().length < 20}>
            Ligar
          </Button>
        </div>
      </form>

      {!ligacoes ? (
        <EsqueletoLista linhas={3} />
      ) : (
        <div className="relative overflow-x-auto rounded-card border border-borda bg-superficie shadow-card">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <caption className="sr-only">Contas ligadas ao Regem, com a 99 e a leitura</caption>
            <thead>
              <tr className="border-b border-borda bg-superficie-2 text-xs uppercase tracking-wide text-tinta-suave">
                <th scope="col" className="px-3 py-2.5 font-medium">Conta</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Empresa no Regem</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Ligada</th>
                <th scope="col" className="px-3 py-2.5 font-medium">99Food</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Leitura</th>
                <th scope="col" className="px-3 py-2.5 font-medium"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {ligacoes.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-tinta-suave">
                    Nenhuma conta ligada ao Regem ainda.
                  </td>
                </tr>
              )}
              {ligacoes.map((l) => (
                <tr key={l.contaId} className="border-b border-borda/60 align-top last:border-0">
                  <td className="px-3 py-2.5 font-medium text-tinta">{l.contaNome}</td>
                  <td className="px-3 py-2.5 text-tinta">{l.empresaNome ?? '—'}</td>
                  <td className="px-3 py-2.5 text-tinta-suave">
                    {quando(l.ligadaEm)}
                    {l.ligadaPor ? <span className="block text-xs">por {l.ligadaPor}</span> : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <Pilula99 ligacao={l} />
                  </td>
                  <td className="px-3 py-2.5 text-xs text-tinta-suave">
                    clientes {LEITURA[l.clientesStatus]} · vendas {LEITURA[l.pedidosStatus]}
                    {l.erro ? <span className="mt-1 block max-w-[18rem] text-erro">{l.erro}</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {desligar === l.contaId ? (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button tamanho="sm" variante="discreto" onClick={() => setDesligar(null)}>
                          Cancelar
                        </Button>
                        <Button
                          tamanho="sm"
                          variante="perigo"
                          carregando={ocupado === l.contaId}
                          onClick={() => void confirmarDesligar(l.contaId)}
                        >
                          Desligar
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button tamanho="sm" variante="discreto" onClick={() => setContaId(l.contaId)}>
                          Trocar token
                        </Button>
                        <Button tamanho="sm" variante="discreto" onClick={() => setDesligar(l.contaId)}>
                          Desligar
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** O que a 99 pede de nós, em forma: emitir e tirar chamam a atenção antes de qualquer nome. */
function Pilula99({ ligacao: l }: { ligacao: LigacaoRegemNoConsole }) {
  const [texto, classe] =
    l.acao99 === 'emitir'
      ? ['Emitir token com a 99', 'bg-realce text-tinta']
      : l.acao99 === 'retirar'
        ? ['Tirar a 99 do token', 'bg-erro/10 text-erro']
        : l.incluir99
          ? ['Autorizada e liberada', 'bg-sucesso/15 text-sucesso']
          : ['Não autorizada', 'bg-superficie-2 text-tinta-suave'];
  return (
    <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', classe)}>
      {texto}
      {l.acao99 === 'emitir' && l.autorizacao99Em ? ` · autorizada em ${quando(l.autorizacao99Em)}` : ''}
    </span>
  );
}
