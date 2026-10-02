'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { EsqueletoLista } from '@/components/ui/esqueleto';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { formatarDataHora } from '@/lib/formato';
import { distribuicao, type ContaNoConsole, type EscopoDeIntegracao, type TokenNoConsole } from '@/lib/servicos';

/**
 * Tokens de integração (a porta MCP) no console de distribuição.
 *
 * É por aqui que um produto da DMS ganha acesso a UMA conta: o operador escolhe
 * a conta, o produto e as permissões, e o token aparece uma única vez, para ser
 * gravado direto no cofre do produto. O servidor confere tudo e devolve a frase
 * do que consertar; cliente de fora do grupo nunca recebe a permissão de disparo.
 */

interface Rascunho {
  contaId: string;
  produto: string;
  classe: 'dms' | 'externo';
  nome: string;
  escopos: string[];
}

const vazio = (): Rascunho => ({ contaId: '', produto: 'liame', classe: 'dms', nome: '', escopos: [] });

export function PainelIntegracoes({ contas }: { contas: ContaNoConsole[] }) {
  const [tokens, setTokens] = useState<TokenNoConsole[] | null>(null);
  const [escopos, setEscopos] = useState<EscopoDeIntegracao[]>([]);
  const [erro, setErro] = useState('');
  const [emitindo, setEmitindo] = useState(false);
  const [rascunho, setRascunho] = useState<Rascunho>(vazio);
  const [salvando, setSalvando] = useState(false);
  /** O token recém-emitido, em claro: fica na tela até o operador fechar. */
  const [novo, setNovo] = useState<{ token: string; nome: string; conta: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await distribuicao.integracoes();
      setTokens(r.tokens);
      setEscopos(r.escopos);
    } catch (e) {
      setErro(mensagemDoErro(e));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function emitir(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro('');
    setSalvando(true);
    try {
      const r = await distribuicao.emitirToken(rascunho);
      setNovo({ token: r.token, nome: r.emitido.nome, conta: r.emitido.contaNome });
      setCopiado(false);
      setEmitindo(false);
      setRascunho(vazio());
      await carregar();
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    } finally {
      setSalvando(false);
    }
  }

  async function revogar(id: string) {
    setErro('');
    try {
      await distribuicao.revogarToken(id);
      setConfirmando(null);
      await carregar();
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    }
  }

  async function copiar() {
    if (!novo) return;
    try {
      await navigator.clipboard.writeText(novo.token);
      setCopiado(true);
    } catch {
      // Sem acesso à área de transferência: o campo é de leitura e dá para selecionar à mão.
      (document.getElementById('token-emitido') as HTMLInputElement | null)?.select();
    }
  }

  function trocarEscopo(id: string, marcado: boolean) {
    setRascunho((r) => ({ ...r, escopos: marcado ? [...r.escopos, id] : r.escopos.filter((e) => e !== id) }));
  }

  function trocarClasse(classe: 'dms' | 'externo') {
    // Cliente de fora não dispara: a permissão sai junto com a troca.
    const soDms = new Set(escopos.filter((e) => e.soDms).map((e) => e.id));
    setRascunho((r) => ({ ...r, classe, escopos: classe === 'dms' ? r.escopos : r.escopos.filter((e) => !soDms.has(e)) }));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl space-y-1 text-sm text-tinta-suave">
          <p>
            Cada token dá a <strong className="text-tinta">um produto</strong> acesso a{' '}
            <strong className="text-tinta">uma conta</strong>, pelo endereço MCP do RegemCast, só com as permissões
            marcadas. O dono da conta vê o token em Integrações e pode desligar.
          </p>
          <p>O token aparece uma vez, na emissão. O RegemCast guarda só o hash e não consegue mostrar de novo.</p>
        </div>
        {!emitindo && (
          <Button
            tamanho="sm"
            onClick={() => {
              setEmitindo(true);
              setErro('');
              setNovo(null);
            }}
          >
            Novo token
          </Button>
        )}
      </div>

      {erro && <Alerta tom="erro">{erro}</Alerta>}

      {novo && (
        <div role="status" className="space-y-3 rounded-card border border-acento bg-superficie p-4 shadow-card">
          <p className="text-sm font-semibold text-tinta">
            Token {novo.nome}, da conta {novo.conta}. Copie agora: ele não aparece de novo.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input id="token-emitido" readOnly value={novo.token} className="numerico min-w-0 flex-1" onFocus={(e) => e.target.select()} />
            <Button tamanho="sm" variante="secundario" onClick={() => void copiar()}>
              {copiado ? 'Copiado' : 'Copiar'}
            </Button>
            <Button tamanho="sm" variante="discreto" onClick={() => setNovo(null)}>
              Já guardei
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-tinta-suave">
            Grave direto no cofre do produto que vai usar. Não mande por mensagem nem deixe em arquivo. Se perder, revogue
            este e emita outro.
          </p>
        </div>
      )}

      {emitindo && (
        <form onSubmit={emitir} noValidate className="space-y-4 rounded-card border border-acento/40 bg-superficie p-4 shadow-card sm:p-5">
          <h2 className="text-base font-semibold text-tinta">Novo token de integração</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="i-conta">Conta</Label>
              <Select id="i-conta" value={rascunho.contaId} onChange={(e) => setRascunho({ ...rascunho, contaId: e.target.value })} required>
                <option value="">Escolha a conta</option>
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-produto">Produto que vai usar</Label>
              <Input
                id="i-produto"
                value={rascunho.produto}
                onChange={(e) => setRascunho({ ...rascunho, produto: e.target.value })}
                maxLength={40}
                placeholder="liame"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-classe">De quem é</Label>
              <Select id="i-classe" value={rascunho.classe} onChange={(e) => trocarClasse(e.target.value as 'dms' | 'externo')}>
                <option value="dms">Produto da DMS</option>
                <option value="externo">Cliente de fora do grupo</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-nome">Nome do token</Label>
              <Input
                id="i-nome"
                value={rascunho.nome}
                onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })}
                maxLength={80}
                placeholder="Liame — piloto"
                required
              />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-tinta">Permissões</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {escopos.map((e) => {
                const bloqueado = e.soDms && rascunho.classe !== 'dms';
                return (
                  <label
                    key={e.id}
                    className={`flex items-start gap-2 rounded-lg border border-borda p-3 text-sm ${bloqueado ? 'opacity-60' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0"
                      checked={rascunho.escopos.includes(e.id)}
                      disabled={bloqueado}
                      onChange={(ev) => trocarEscopo(e.id, ev.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="font-medium text-tinta">{e.rotulo}</span>
                      <span className="block text-xs leading-relaxed text-tinta-suave">
                        {e.descricao}
                        {bloqueado ? ' Cliente de fora não dispara.' : ''}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="flex gap-2">
            <Button type="submit" carregando={salvando}>
              Emitir token
            </Button>
            <Button type="button" variante="discreto" onClick={() => setEmitindo(false)} disabled={salvando}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {tokens === null && !erro && <EsqueletoLista />}

      {tokens !== null && tokens.length === 0 && (
        <p className="rounded-card border border-borda bg-superficie p-5 text-sm text-tinta-suave">
          Nenhum token emitido. Sem token, ninguém entra pela porta MCP.
        </p>
      )}

      {tokens !== null && tokens.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-borda bg-superficie">
          <table className="w-full min-w-[56rem] text-sm">
            <caption className="sr-only">Tokens de integração emitidos</caption>
            <thead className="border-b border-borda bg-superficie-2 text-left text-xs uppercase tracking-wide text-tinta-suave">
              <tr>
                <th className="px-3 py-2.5 font-medium">Conta</th>
                <th className="px-3 py-2.5 font-medium">Token</th>
                <th className="px-3 py-2.5 font-medium">Produto</th>
                <th className="px-3 py-2.5 font-medium">Permissões</th>
                <th className="px-3 py-2.5 font-medium">Último uso</th>
                <th className="px-3 py-2.5 font-medium">Situação</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {tokens.map((t) => (
                <tr key={t.id} className={t.revogadoEm ? 'text-tinta-suave' : ''}>
                  <td className="px-3 py-2.5 text-tinta">{t.contaNome}</td>
                  <td className="px-3 py-2.5">
                    <span className="block text-tinta">{t.nome}</span>
                    <span className="numerico text-xs text-tinta-suave">{t.prefixo}…</span>
                  </td>
                  <td className="px-3 py-2.5">
                    {t.produto}
                    <span className="block text-xs text-tinta-suave">{t.classe === 'dms' ? 'produto da DMS' : 'cliente de fora'}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs leading-relaxed">{t.escopos.map((e) => e.rotulo).join(' · ')}</td>
                  <td className="px-3 py-2.5 text-xs">{t.ultimoUsoEm ? formatarDataHora(t.ultimoUsoEm) : 'nunca usado'}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {t.revogadoEm ? (
                      <>
                        Revogado em {formatarDataHora(t.revogadoEm)}
                        <span className="block">por {t.revogadoPor ?? '—'}</span>
                      </>
                    ) : (
                      <span className="rounded-full bg-sucesso/15 px-2 py-0.5 font-medium text-sucesso">Ativo</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {!t.revogadoEm &&
                      (confirmando === t.id ? (
                        <span className="inline-flex flex-wrap justify-end gap-2">
                          <Button tamanho="sm" variante="perigo" onClick={() => void revogar(t.id)}>
                            Confirmar
                          </Button>
                          <Button tamanho="sm" variante="discreto" onClick={() => setConfirmando(null)}>
                            Cancelar
                          </Button>
                        </span>
                      ) : (
                        <Button tamanho="sm" variante="secundario" onClick={() => setConfirmando(t.id)}>
                          Revogar
                        </Button>
                      ))}
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
