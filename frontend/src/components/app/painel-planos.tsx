'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { EsqueletoLista } from '@/components/ui/esqueleto';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { cn } from '@/lib/cn';
import { distribuicao, type DadosPlano, type PlanoNoConsole } from '@/lib/servicos';

const reais = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** "249,00", "249.00" ou "249" viram 24900. Vazio ou inválido vira null. */
function paraCentavos(texto: string): number | null {
  const limpo = texto.trim().replace(/\s|R\$/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!limpo) return null;
  const n = Number(limpo);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

interface Rascunho {
  codigo: string;
  nome: string;
  disparos: string;
  preco: string;
  publico: boolean;
  ativo: boolean;
  ordem: string;
}

const vazio: Rascunho = { codigo: '', nome: '', disparos: '', preco: '', publico: true, ativo: true, ordem: '0' };

/**
 * Catálogo de planos no console.
 *
 * Preço e teto mudam aqui, sem deploy. Aumentar o teto devolve à fila as
 * campanhas das contas desse plano que estavam paradas por falta de disparos —
 * e a tela diz quantas voltaram.
 */
export function PainelPlanos() {
  const [planos, setPlanos] = useState<PlanoNoConsole[] | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [editando, setEditando] = useState<string | 'novo' | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho>(vazio);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setPlanos(await distribuicao.planos());
    } catch (e) {
      setErro(mensagemDoErro(e));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function abrir(p?: PlanoNoConsole) {
    setErro('');
    setAviso('');
    if (!p) {
      setRascunho(vazio);
      setEditando('novo');
      return;
    }
    setRascunho({
      codigo: p.codigo,
      nome: p.nome,
      disparos: String(p.disparosMes),
      preco: (p.precoCentavos / 100).toFixed(2).replace('.', ','),
      publico: p.publico,
      ativo: p.ativo,
      ordem: String(p.ordem),
    });
    setEditando(p.id);
  }

  async function salvar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro('');
    const precoCentavos = paraCentavos(rascunho.preco);
    const disparosMes = Number(rascunho.disparos.replace(/\D/g, ''));
    if (precoCentavos === null) {
      setErro('Confira o preço: use o formato 99,00.');
      return;
    }
    if (!rascunho.disparos.trim() || !Number.isInteger(disparosMes)) {
      setErro('Informe os disparos por mês em número inteiro.');
      return;
    }

    const dados: DadosPlano = {
      nome: rascunho.nome.trim(),
      disparosMes,
      precoCentavos,
      publico: rascunho.publico,
      ativo: rascunho.ativo,
      ordem: Number(rascunho.ordem) || 0,
    };

    setSalvando(true);
    try {
      if (editando === 'novo') {
        await distribuicao.criarPlano({ ...dados, codigo: rascunho.codigo.trim() });
        setAviso(`Plano "${dados.nome}" criado.`);
      } else if (editando) {
        const r = await distribuicao.atualizarPlano(editando, dados);
        setAviso(
          r.campanhasRetomadas > 0
            ? `Plano salvo. ${r.campanhasRetomadas} campanha(s) paradas por falta de disparos voltaram à fila.`
            : 'Plano salvo.',
        );
      }
      setEditando(null);
      await carregar();
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-prose text-sm text-tinta-suave">
          Faixas de disparos por mês. Preço e teto valem para todas as contas do plano; desativar tira o
          plano das opções novas sem mexer em quem já o usa.
        </p>
        <Button tamanho="sm" onClick={() => abrir()}>
          Novo plano
        </Button>
      </div>

      {erro ? <Alerta tom="erro">{erro}</Alerta> : null}
      {aviso ? <Alerta tom="sucesso">{aviso}</Alerta> : null}

      {editando ? (
        <form
          onSubmit={salvar}
          className="anima-entrada space-y-4 rounded-card border border-acento/50 bg-superficie p-5 shadow-flutuante"
        >
          <h2 className="text-base font-semibold text-tinta">
            {editando === 'novo' ? 'Novo plano' : `Editar ${rascunho.nome}`}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="p-codigo">Código</Label>
              <Input
                id="p-codigo"
                value={rascunho.codigo}
                onChange={(e) => setRascunho({ ...rascunho, codigo: e.target.value })}
                readOnly={editando !== 'novo'}
                placeholder="faixa_100k"
                className="font-mono"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-nome">Nome</Label>
              <Input
                id="p-nome"
                value={rascunho.nome}
                onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-disparos">Disparos por mês</Label>
              <Input
                id="p-disparos"
                inputMode="numeric"
                value={rascunho.disparos}
                onChange={(e) => setRascunho({ ...rascunho, disparos: e.target.value })}
                className="font-mono"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-preco">Preço por mês (R$)</Label>
              <Input
                id="p-preco"
                inputMode="decimal"
                value={rascunho.preco}
                onChange={(e) => setRascunho({ ...rascunho, preco: e.target.value })}
                placeholder="99,00"
                className="font-mono"
                required
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-sm text-tinta">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={rascunho.publico}
                onChange={(e) => setRascunho({ ...rascunho, publico: e.target.checked })}
                className="h-4 w-4 accent-[rgb(var(--cor-acento))]"
              />
              Aparece para contratação
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={rascunho.ativo}
                onChange={(e) => setRascunho({ ...rascunho, ativo: e.target.checked })}
                className="h-4 w-4 accent-[rgb(var(--cor-acento))]"
              />
              Ativo
            </label>
            <label className="inline-flex items-center gap-2">
              Ordem
              <Input
                aria-label="Ordem"
                inputMode="numeric"
                value={rascunho.ordem}
                onChange={(e) => setRascunho({ ...rascunho, ordem: e.target.value })}
                className="h-8 w-16 font-mono"
              />
            </label>
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

      {!planos && !erro ? (
        <EsqueletoLista linhas={3} />
      ) : planos ? (
        <div className="overflow-x-auto rounded-card border border-borda bg-superficie shadow-card">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <caption className="sr-only">Planos do catálogo</caption>
            <thead>
              <tr className="border-b border-borda bg-superficie-2 text-xs uppercase tracking-wide text-tinta-suave">
                <th scope="col" className="px-3 py-2.5 font-medium">Plano</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Disparos/mês</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Preço</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Situação</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Contas</th>
                <th scope="col" className="px-3 py-2.5"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {planos.map((p) => (
                <tr key={p.id} className="border-b border-borda/60 last:border-0 hover:bg-superficie-2/60">
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-tinta">{p.nome}</p>
                    <p className="font-mono text-xs text-tinta-suave">{p.codigo}</p>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-tinta">
                    {p.disparosMes.toLocaleString('pt-BR')}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-tinta">
                    {p.precoCentavos === 0 ? 'grátis' : reais(p.precoCentavos)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                        !p.ativo
                          ? 'bg-superficie-2 text-tinta-suave'
                          : p.publico
                            ? 'bg-sucesso/15 text-sucesso'
                            : 'bg-realce text-tinta',
                      )}
                    >
                      {!p.ativo ? 'Inativo' : p.publico ? 'À venda' : 'Interno'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-tinta">{p.contas}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Button tamanho="sm" variante="secundario" onClick={() => abrir(p)}>
                      Editar
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
