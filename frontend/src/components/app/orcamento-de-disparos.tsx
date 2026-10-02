'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Card, CardCabecalho, CardCorpo } from '@/components/ui/card';
import { Esqueleto } from '@/components/ui/esqueleto';
import { AjudaCampo, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { orcamento as servico } from '@/lib/servicos';
import type { OrcamentoDeDisparos as Orcamento, PeriodoDoOrcamento } from '@/lib/tipos';

/**
 * O orçamento de disparos: quanto a conta aceita gastar na Meta por dia, por
 * semana e por mês.
 *
 * O servidor faz a conta e devolve as frases prontas; a tela mostra, e manda os
 * três campos do jeito que a pessoa digitou — o formato é conferido lá, e a
 * frase do que está errado volta de lá. Qualquer pessoa da conta vê quanto já
 * saiu; só o dono muda.
 */

const CAMPOS: Array<{ periodo: PeriodoDoOrcamento; rotulo: string; exemplo: string }> = [
  { periodo: 'dia', rotulo: 'Por dia', exemplo: '50,00' },
  { periodo: 'semana', rotulo: 'Por semana', exemplo: '300,00' },
  { periodo: 'mes', rotulo: 'Por mês', exemplo: '1.000,00' },
];

const BARRA: Record<'ok' | 'atencao' | 'cheio', string> = {
  ok: 'bg-acento',
  atencao: 'bg-atencao',
  cheio: 'bg-erro',
};

export function OrcamentoDeDisparos() {
  const [dados, setDados] = useState<Orcamento | null>(null);
  const [erroDeLeitura, setErroDeLeitura] = useState('');
  const [campos, setCampos] = useState<Record<PeriodoDoOrcamento, string>>({ dia: '', semana: '', mes: '' });
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(async () => {
    setErroDeLeitura('');
    try {
      const lido = await servico.ler();
      setDados(lido);
      setCampos(lido.campos);
    } catch (falha) {
      setErroDeLeitura(mensagemDoErro(falha));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (salvando) return;
    setErro('');
    setAviso('');
    setSalvando(true);
    try {
      const salvo = await servico.definir(campos);
      setDados(salvo);
      setCampos(salvo.campos);
      setEditando(false);
      setAviso(
        salvo.periodos.length
          ? 'Orçamento salvo. As campanhas pausadas por ele voltam a sair se houver folga.'
          : 'Orçamento removido. As campanhas saem sem teto de gasto.',
      );
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    } finally {
      setSalvando(false);
    }
  }

  const moeda = dados?.moeda === 'BRL' || !dados?.moeda ? 'R$' : dados.moeda;

  return (
    <Card>
      <CardCabecalho
        titulo="Orçamento de disparos"
        descricao="Quanto a conta aceita gastar na Meta por dia, por semana e por mês. Quando um teto é atingido, as campanhas pausam e voltam a sair sozinhas na virada do período."
        acao={
          dados?.podeMudar ? (
            <Button
              variante={editando ? 'discreto' : 'secundario'}
              tamanho="sm"
              aria-expanded={editando}
              aria-controls="form-orcamento"
              onClick={() => {
                setEditando((v) => !v);
                setErro('');
                setCampos(dados.campos);
              }}
            >
              {editando ? 'Cancelar' : dados.periodos.length ? 'Alterar' : 'Definir orçamento'}
            </Button>
          ) : null
        }
      />
      <CardCorpo className="space-y-4">
        {!dados && !erroDeLeitura && (
          <div role="status" aria-label="Carregando o orçamento" className="space-y-3">
            <Esqueleto className="h-4 w-56" />
            <Esqueleto className="h-2 w-full" />
          </div>
        )}
        {erroDeLeitura && (
          <Alerta tom="erro">
            <span className="block space-y-2">
              <span className="block">{erroDeLeitura}</span>
              <Button tamanho="sm" variante="secundario" onClick={() => void carregar()}>
                Tentar de novo
              </Button>
            </span>
          </Alerta>
        )}

        {aviso && <Alerta tom="sucesso">{aviso}</Alerta>}

        {dados && dados.periodos.length === 0 && !editando && (
          <p className="text-sm text-tinta-suave">
            Sem orçamento definido: as campanhas saem sem teto de gasto.
            {dados.podeMudar ? '' : ' Só o dono da conta define o orçamento.'}
          </p>
        )}

        {dados && dados.periodos.length > 0 && (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dados.periodos.map((p) => (
              <li key={p.periodo} className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="text-xs text-tinta-suave">{p.rotulo}</span>
                  <span className="text-xs text-tinta-suave">{p.zera}</span>
                </div>
                <p className="numerico text-sm font-semibold text-tinta">{p.texto}</p>
                <div
                  role="progressbar"
                  aria-valuenow={p.percentual}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${p.rotulo}: ${p.texto}`}
                  className="h-2 overflow-hidden rounded-full bg-superficie-2"
                >
                  <div className={`h-full rounded-full ${BARRA[p.sinal]}`} style={{ width: `${p.percentual}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}

        {dados?.avisos.map((a) => (
          <p key={a} className="rounded-lg border border-atencao/30 bg-atencao/10 px-3 py-2 text-xs leading-relaxed text-tinta">
            {a}
          </p>
        ))}

        {dados && !dados.podeMudar && dados.periodos.length > 0 && (
          <p className="text-xs text-tinta-suave">Só o dono da conta muda o orçamento.</p>
        )}

        {editando && dados?.podeMudar && (
          <form id="form-orcamento" onSubmit={salvar} noValidate className="space-y-4 border-t border-borda pt-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {CAMPOS.map((c) => (
                <div key={c.periodo} className="min-w-0 space-y-1.5">
                  <Label htmlFor={`orcamento-${c.periodo}`}>
                    {c.rotulo} ({moeda})
                  </Label>
                  <Input
                    id={`orcamento-${c.periodo}`}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder={c.exemplo}
                    value={campos[c.periodo]}
                    onChange={(e) => setCampos((atual) => ({ ...atual, [c.periodo]: e.target.value }))}
                    aria-describedby="ajuda-orcamento"
                  />
                </div>
              ))}
            </div>
            <AjudaCampo id="ajuda-orcamento">
              Deixe vazio para não ter teto naquele período. A semana vai de segunda a domingo. Conta o que saiu no
              período, pelo preço da Meta para cada mensagem; a que falha ou sai de graça deixa de contar.
            </AjudaCampo>
            {erro ? <Alerta>{erro}</Alerta> : null}
            <Button type="submit" carregando={salvando}>
              Salvar orçamento
            </Button>
          </form>
        )}
      </CardCorpo>
    </Card>
  );
}
