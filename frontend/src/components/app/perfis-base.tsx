'use client';

import { useState } from 'react';

import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatarNumero } from '@/lib/formato';
import { contatos as servico } from '@/lib/servicos';
import type { ParametrosSegmentacao, ResumoSegmentos, Segmento } from '@/lib/tipos';

/**
 * Os perfis da base — Campeões, Fiéis, Em risco, Perdidos… — calculados da
 * última compra e da quantidade de pedidos de cada contato.
 *
 * Clicar num perfil filtra a tabela. Com um perfil escolhido, "Criar lista"
 * tira uma foto de quem está nele hoje: é essa lista que a campanha usa.
 */

/** Cor por perfil: verde para quem está bem, âmbar para quem esfria, vermelho para quem some. */
export const COR_PERFIL: Record<Segmento, string> = {
  campeoes: 'border-sucesso/40 bg-sucesso/10',
  fieis: 'border-sucesso/30 bg-sucesso/5',
  novos: 'border-acento/50 bg-acento/10',
  promissores: 'border-acento/30 bg-acento/5',
  atencao: 'border-atencao/40 bg-atencao/10',
  em_risco: 'border-atencao/50 bg-atencao/15',
  nao_posso_perder: 'border-erro/40 bg-erro/10',
  perdidos: 'border-borda bg-superficie-2',
  sem_historico: 'border-dashed border-borda bg-superficie',
};

export function PerfisDaBase({
  resumo,
  selecionado,
  aoSelecionar,
  ehDono,
  aoMudar,
}: {
  resumo: ResumoSegmentos;
  selecionado: Segmento | null;
  aoSelecionar: (s: Segmento | null) => void;
  ehDono: boolean;
  /** Algo mudou (números da regra ou lista criada): recarregar. */
  aoMudar: () => void;
}) {
  const [ajustando, setAjustando] = useState(false);
  const [p, setP] = useState<ParametrosSegmentacao>(resumo.parametros);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const comHistorico = resumo.segmentos.some((s) => s.id !== 'sem_historico' && s.total > 0);
  const escolhido = resumo.segmentos.find((s) => s.id === selecionado) ?? null;

  async function salvar() {
    setErro('');
    setOcupado(true);
    try {
      await servico.salvarParametros(p);
      setAjustando(false);
      aoMudar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function criarLista(s: Segmento) {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      const r = await servico.criarListaDoPerfil(s);
      setAviso(`Lista "${r.nome}" criada com ${formatarNumero(r.total)} ${r.total === 1 ? 'contato' : 'contatos'}. Escolha essa lista ao montar a campanha.`);
      aoMudar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section aria-label="Perfis da base" className="anima-entrada space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-tinta">Perfis da base</h2>
        <div className="flex items-center gap-3">
          <p className="text-xs text-tinta-suave">Só quem pode receber (sem descadastrados).</p>
          {ehDono && (
            <button
              type="button"
              onClick={() => setAjustando((v) => !v)}
              aria-expanded={ajustando}
              className="text-xs font-medium text-acento-forte underline underline-offset-4"
            >
              {ajustando ? 'Fechar' : 'Ajustar regras'}
            </button>
          )}
        </div>
      </div>

      {!comHistorico && (
        <Alerta tom="informacao">
          Para classificar a base, importe uma planilha com <strong>pedidos</strong> e <strong>última compra</strong>{' '}
          (ou dias sem comprar) — a exportação de clientes do seu cardápio costuma trazer.
        </Alerta>
      )}

      {ajustando && (
        <div className="space-y-3 rounded-card border border-borda bg-superficie p-4">
          <p className="text-sm text-tinta-suave">
            Os perfis mudam na hora, para a base inteira. Os dias precisam crescer: recente &lt; ativo &lt; em risco.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ['recenteDias', 'Recente: até (dias)'],
                ['ativoDias', 'Ativo: até (dias)'],
                ['riscoDias', 'Em risco: até (dias)'],
                ['fielPedidos', 'Frequente: pedidos'],
              ] as const
            ).map(([campo, rotulo]) => (
              <div key={campo} className="space-y-1">
                <Label htmlFor={`p-${campo}`}>{rotulo}</Label>
                <Input
                  id={`p-${campo}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={p[campo]}
                  onChange={(e) => setP({ ...p, [campo]: Number(e.target.value) })}
                />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void salvar()} carregando={ocupado}>
              Salvar regras
            </Button>
            <Button variante="secundario" onClick={() => setP({ recenteDias: 30, ativoDias: 90, riscoDias: 180, fielPedidos: 5 })}>
              Voltar ao padrão
            </Button>
          </div>
        </div>
      )}

      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {aviso && <Alerta tom="sucesso">{aviso}</Alerta>}

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {resumo.segmentos.map((s) => {
          const ativo = s.id === selecionado;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => aoSelecionar(ativo ? null : s.id)}
                aria-pressed={ativo}
                title={s.regra}
                className={cn(
                  'flex w-full items-start justify-between gap-3 rounded-card border p-3 text-left transition-shadow hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento',
                  COR_PERFIL[s.id],
                  ativo && 'ring-2 ring-acento',
                )}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-tinta">{s.nome}</span>
                  <span className="block text-xs leading-snug text-tinta-suave">{s.regra}</span>
                </span>
                <span className="numerico shrink-0 text-lg font-semibold text-tinta">{formatarNumero(s.total)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {escolhido && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-acento/40 bg-acento/5 p-3">
          <p className="text-sm text-tinta">
            Mostrando <strong>{escolhido.nome}</strong>: {formatarNumero(escolhido.total)}{' '}
            {escolhido.total === 1 ? 'contato' : 'contatos'}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              tamanho="sm"
              onClick={() => void criarLista(escolhido.id)}
              carregando={ocupado}
              disabled={escolhido.total === 0}
            >
              Criar lista com estes contatos
            </Button>
            <Button tamanho="sm" variante="secundario" onClick={() => aoSelecionar(null)}>
              Ver todos
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
