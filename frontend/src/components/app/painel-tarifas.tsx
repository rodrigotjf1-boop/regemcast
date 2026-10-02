'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { EsqueletoLista } from '@/components/ui/esqueleto';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatarData } from '@/lib/formato';
import { distribuicao, type TarifaNoConsole } from '@/lib/servicos';

/**
 * Tarifas da Meta no console: o preço de UMA mensagem entregue, por moeda, país
 * de quem recebe e categoria.
 *
 * O valor é da Meta e só muda no primeiro dia de um trimestre. Ele entra aqui
 * pela mão do operador, a partir do arquivo oficial de tarifas — nenhum preço
 * vem embutido no produto. Tarifa não se apaga: valor novo é linha nova, com a
 * data em que passa a valer, e a anterior fica para calcular o gasto de antes.
 *
 * O valor trafega como TEXTO (até seis casas). A tela não faz conta com ele.
 */

const CATEGORIAS = [
  { valor: 'marketing', rotulo: 'Marketing' },
  { valor: 'utility', rotulo: 'Utilidade' },
  { valor: 'authentication', rotulo: 'Autenticação' },
];
const rotuloDaCategoria = (c: string) => CATEGORIAS.find((x) => x.valor === c)?.rotulo ?? c;

/** "0.321700" → "0,3217" (sem os zeros do fim; no mínimo duas casas). */
function valorParaTela(valor: string): string {
  const [inteiro, casas = ''] = valor.split('.');
  const aparado = casas.replace(/0+$/, '').padEnd(2, '0');
  return `${inteiro},${aparado}`;
}

interface Rascunho {
  moeda: string;
  ddi: string;
  categoria: string;
  valor: string;
  vigenteDe: string;
  fonte: string;
}

const hoje = () => new Date().toISOString().slice(0, 10);
const vazio = (): Rascunho => ({ moeda: 'BRL', ddi: '55', categoria: 'marketing', valor: '', vigenteDe: hoje(), fonte: '' });

export function PainelTarifas() {
  const [tarifas, setTarifas] = useState<TarifaNoConsole[] | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  /** `nova`, ou o id da tarifa cujo valor está sendo corrigido. */
  const [editando, setEditando] = useState<string | 'nova' | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho>(vazio);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setTarifas(await distribuicao.tarifas());
    } catch (e) {
      setErro(mensagemDoErro(e));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function abrir(t?: TarifaNoConsole) {
    setErro('');
    setAviso('');
    if (!t) {
      setRascunho(vazio());
      setEditando('nova');
      return;
    }
    setRascunho({ moeda: t.moeda, ddi: t.ddi, categoria: t.categoria, valor: valorParaTela(t.valor), vigenteDe: t.vigenteDe, fonte: t.fonte ?? '' });
    setEditando(t.id);
  }

  async function salvar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro('');
    setSalvando(true);
    try {
      if (editando === 'nova') {
        await distribuicao.criarTarifa(rascunho);
        setAviso('Tarifa cadastrada.');
      } else if (editando) {
        await distribuicao.corrigirTarifa(editando, { valor: rascunho.valor, fonte: rascunho.fonte });
        setAviso('Tarifa corrigida.');
      }
      setEditando(null);
      await carregar();
    } catch (falha) {
      // A frase do servidor diz o que consertar (moeda, país, valor, data).
      setErro(mensagemDoErro(falha));
    } finally {
      setSalvando(false);
    }
  }

  const nova = editando === 'nova';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-prose space-y-1.5 text-sm text-tinta-suave">
          <p>
            O preço de <strong className="text-tinta">uma mensagem entregue</strong>, como está no arquivo
            oficial de tarifas da Meta: por moeda da conta, país de quem recebe e categoria do modelo.
          </p>
          <p>
            É com ele que o cliente vê o custo estimado antes de disparar. Sem tarifa cadastrada, a tela
            do cliente diz que não sabe estimar — nenhum preço vem embutido no produto.
          </p>
        </div>
        <Button tamanho="sm" onClick={() => abrir()}>
          Nova tarifa
        </Button>
      </div>

      {erro ? <Alerta tom="erro">{erro}</Alerta> : null}
      {aviso ? <Alerta tom="sucesso">{aviso}</Alerta> : null}

      {editando ? (
        <form
          onSubmit={salvar}
          className="anima-entrada space-y-4 rounded-card border border-acento/50 bg-superficie p-5 shadow-flutuante"
        >
          <h2 className="text-base font-semibold text-tinta">{nova ? 'Nova tarifa' : 'Corrigir o valor'}</h2>
          {!nova && (
            <p className="text-sm text-tinta-suave">
              Só o valor e a fonte mudam. A Meta mudou o preço? Cadastre uma tarifa nova, com a data em que
              passa a valer — a anterior fica para o gasto de antes.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5">
              <Label htmlFor="t-moeda">Moeda da conta</Label>
              <Input
                id="t-moeda"
                value={rascunho.moeda}
                onChange={(e) => setRascunho({ ...rascunho, moeda: e.target.value.toUpperCase() })}
                readOnly={!nova}
                maxLength={3}
                placeholder="BRL"
                className="font-mono"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-ddi">País de quem recebe (código)</Label>
              <Input
                id="t-ddi"
                inputMode="numeric"
                value={rascunho.ddi}
                onChange={(e) => setRascunho({ ...rascunho, ddi: e.target.value })}
                readOnly={!nova}
                maxLength={5}
                placeholder="55"
                className="font-mono"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-categoria">Categoria</Label>
              <select
                id="t-categoria"
                value={rascunho.categoria}
                onChange={(e) => setRascunho({ ...rascunho, categoria: e.target.value })}
                disabled={!nova}
                className="h-10 w-full rounded-lg border border-borda bg-superficie px-3 text-sm text-tinta focus-visible:outline focus-visible:outline-2 focus-visible:outline-acento disabled:opacity-70"
              >
                {CATEGORIAS.map((c) => (
                  <option key={c.valor} value={c.valor}>
                    {c.rotulo}
                  </option>
                ))}
                {!CATEGORIAS.some((c) => c.valor === rascunho.categoria) && (
                  <option value={rascunho.categoria}>{rascunho.categoria}</option>
                )}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-valor">Valor por mensagem</Label>
              <Input
                id="t-valor"
                inputMode="decimal"
                value={rascunho.valor}
                onChange={(e) => setRascunho({ ...rascunho, valor: e.target.value })}
                placeholder="0,0350"
                className="font-mono"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-vigente">Vale a partir de</Label>
              <Input
                id="t-vigente"
                type="date"
                value={rascunho.vigenteDe}
                onChange={(e) => setRascunho({ ...rascunho, vigenteDe: e.target.value })}
                readOnly={!nova}
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-fonte">De onde saiu o valor</Label>
            <Input
              id="t-fonte"
              value={rascunho.fonte}
              onChange={(e) => setRascunho({ ...rascunho, fonte: e.target.value })}
              maxLength={200}
              placeholder="Arquivo de tarifas BRL da Meta, de 01/07/2026"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" carregando={salvando}>
              Salvar
            </Button>
            <Button variante="discreto" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : null}

      {!tarifas && !erro ? (
        <EsqueletoLista linhas={3} />
      ) : tarifas && tarifas.length === 0 ? (
        <div className="rounded-card border border-dashed border-borda bg-superficie p-6 text-sm leading-relaxed text-tinta-suave">
          <p className="font-medium text-tinta">Nenhuma tarifa cadastrada ainda.</p>
          <p className="mt-1 max-w-prose">
            Cadastre as três do Brasil em reais (marketing, utilidade e autenticação) para o custo estimado
            aparecer para os clientes. Os valores estão no arquivo de tarifas em BRL, na página de preços
            do WhatsApp Business Platform da Meta.
          </p>
        </div>
      ) : tarifas ? (
        <div className="relative overflow-x-auto rounded-card border border-borda bg-superficie shadow-card">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <caption className="sr-only">Tarifas da Meta por mensagem entregue</caption>
            <thead>
              <tr className="border-b border-borda bg-superficie-2 text-xs uppercase tracking-wide text-tinta-suave">
                <th scope="col" className="px-3 py-2.5 font-medium">Moeda</th>
                <th scope="col" className="px-3 py-2.5 font-medium">País</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Categoria</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Valor por mensagem</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Vale a partir de</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Fonte</th>
                <th scope="col" className="px-3 py-2.5"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {tarifas.map((t) => (
                <tr key={t.id} className="border-b border-borda/60 last:border-0 hover:bg-superficie-2/60">
                  <td className="px-3 py-2.5 font-mono text-tinta">{t.moeda}</td>
                  <td className="px-3 py-2.5 font-mono text-tinta">+{t.ddi}</td>
                  <td className="px-3 py-2.5 text-tinta">{rotuloDaCategoria(t.categoria)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-tinta">{valorParaTela(t.valor)}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-tinta">{formatarData(`${t.vigenteDe}T12:00:00Z`)}</span>{' '}
                    <span
                      className={cn(
                        'ml-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                        t.vigente ? 'bg-sucesso/15 text-sucesso' : 'bg-superficie-2 text-tinta-suave',
                      )}
                    >
                      {t.vigente ? 'Vale hoje' : t.vigenteDe > hoje() ? 'Ainda não vale' : 'Anterior'}
                    </span>
                  </td>
                  <td className="max-w-[18rem] px-3 py-2.5 text-xs text-tinta-suave [overflow-wrap:anywhere]">
                    {t.fonte ?? '—'}
                    {t.criadoPor ? <span className="block">por {t.criadoPor}</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Button tamanho="sm" variante="secundario" onClick={() => abrir(t)}>
                      Corrigir
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
