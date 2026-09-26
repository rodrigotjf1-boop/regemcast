'use client';

import { useEffect, useState } from 'react';

import { GRUPOS } from '@/components/app/publicos-base';
import { Alerta } from '@/components/ui/alerta';
import { Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { formatarData, formatarNumero } from '@/lib/formato';
import { contatos } from '@/lib/servicos';
import type {
  ImportacaoDaBase,
  ProdutoDaBase,
  Publico,
  PublicoDaCampanha,
  ResumoPublicos,
  ResumoSegmentos,
  Segmento,
} from '@/lib/tipos';

type Tipo = 'base' | 'importacao' | 'perfil' | 'publico';

const TIPOS: { valor: Tipo; titulo: string }[] = [
  { valor: 'base', titulo: 'Toda a base' },
  { valor: 'importacao', titulo: 'Uma importação (arquivo ou Cardápio Web)' },
  { valor: 'perfil', titulo: 'Um perfil (Campeões, Em risco…)' },
  { valor: 'publico', titulo: 'Um público pronto (VIP, horário, produto, bairro…)' },
];

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const contagem = (n: number) => `${formatarNumero(n)} ${n === 1 ? 'contato' : 'contatos'}`;

/**
 * "Quem recebe → Da base": o público sai direto da base — toda ela, uma
 * importação (os contatos importados sem lista estão aqui), um perfil ou um
 * público pronto. O servidor usa a MESMA regra dos blocos e da tela de
 * Contatos, e copia o público ao montar a campanha, como faz com a lista.
 *
 * Os números de cada opção são de quem pode receber, como no resto do app.
 */
export function PublicoDaBase({
  valor,
  aoMudar,
}: {
  valor: PublicoDaCampanha | null;
  aoMudar: (publico: PublicoDaCampanha | null) => void;
}) {
  const [tipo, setTipo] = useState<Tipo | ''>(() =>
    valor && valor.origem !== 'lista' && valor.origem !== 'regiao' ? valor.origem : '',
  );
  const [importacoes, setImportacoes] = useState<ImportacaoDaBase[] | null>(null);
  const [perfis, setPerfis] = useState<ResumoSegmentos | null>(null);
  const [publicos, setPublicos] = useState<ResumoPublicos | null>(null);
  const [produtos, setProdutos] = useState<ProdutoDaBase[] | null>(null);
  const [erro, setErro] = useState('');

  // Cada tipo carrega o seu, uma vez, quando é escolhido.
  useEffect(() => {
    let vivo = true;
    const falhou = (e: unknown) => vivo && setErro(mensagemDoErro(e));
    if (tipo === 'importacao' && importacoes === null) {
      contatos.importacoes().then((r) => vivo && setImportacoes(r), falhou);
    } else if (tipo === 'perfil' && perfis === null) {
      contatos.segmentos().then((r) => vivo && setPerfis(r), falhou);
    } else if (tipo === 'publico' && publicos === null) {
      Promise.all([contatos.publicos(), contatos.produtos()]).then(([r, p]) => {
        if (!vivo) return;
        setPublicos(r);
        setProdutos(p.produtos);
      }, falhou);
    }
    return () => {
      vivo = false;
    };
  }, [tipo, importacoes, perfis, publicos]);

  function escolherTipo(novo: Tipo | '') {
    setTipo(novo);
    setErro('');
    aoMudar(novo === 'base' ? { origem: 'base' } : null);
  }

  const valorDoSegundo =
    !valor || valor.origem !== tipo
      ? ''
      : valor.origem === 'importacao'
        ? (valor.origemId ?? '')
        : valor.origem === 'perfil'
          ? (valor.segmento ?? '')
          : JSON.stringify({ publico: valor.publico, valor: valor.publicoValor ?? null });

  function escolherSegundo(v: string) {
    if (!v) return aoMudar(null);
    if (tipo === 'importacao') aoMudar({ origem: 'importacao', origemId: v });
    else if (tipo === 'perfil') aoMudar({ origem: 'perfil', segmento: v as Segmento });
    else if (tipo === 'publico') {
      const { publico, valor: publicoValor } = JSON.parse(v) as { publico: Publico; valor: string | null };
      aoMudar({ origem: 'publico', publico, ...(publicoValor ? { publicoValor } : {}) });
    }
  }

  const opcoes = (() => {
    if (tipo === 'importacao') {
      if (!importacoes) return null;
      const comGente = importacoes.filter((i) => i.total > 0);
      return comGente.length
        ? [
            {
              titulo: 'Importações',
              itens: comGente.map((i) => ({
                valor: i.id,
                texto: `${i.nome} · ${formatarData(i.criadoEm)} · ${contagem(i.total)}`,
              })),
            },
          ]
        : [];
    }
    if (tipo === 'perfil') {
      if (!perfis) return null;
      const comGente = perfis.segmentos.filter((s) => s.total > 0);
      return comGente.length
        ? [{ titulo: 'Perfis', itens: comGente.map((s) => ({ valor: s.id, texto: `${s.nome} · ${contagem(s.total)}` })) }]
        : [];
    }
    if (tipo === 'publico') {
      if (!publicos || !produtos) return null;
      const chave = (publico: Publico, v: string | null = null) => JSON.stringify({ publico, valor: v });
      const porId = new Map(
        publicos.publicos
          .filter((p) => p.total > 0 && (p.id !== 'conversaram_7d' || publicos.conversasLigadas))
          .map((p) => [p.id, p]),
      );
      const grupos = GRUPOS.map((g) => ({
        titulo: g.titulo,
        itens: g.ids
          .map((id) => porId.get(id))
          .filter((p) => p != null)
          .map((p) => ({ valor: chave(p.id), texto: `${p.nome} · ${contagem(p.total)}` })),
      }));
      grupos.push(
        {
          titulo: 'Já compraram',
          itens: produtos
            .filter((p) => p.total > 0)
            .map((p) => ({ valor: chave('produto', p.nome), texto: `${p.nome} · ${contagem(p.total)}` })),
        },
        {
          titulo: 'Bairros',
          itens: publicos.bairros.map((b) => ({ valor: chave('bairro', b.bairro), texto: `${b.bairro} · ${contagem(b.total)}` })),
        },
        {
          titulo: 'Aniversariantes',
          itens: publicos.aniversarios
            .filter((a) => a.total > 0)
            .map((a) => ({
              valor: chave('aniversario', String(a.mes)),
              texto: `${MESES[a.mes - 1] ?? a.mes}${a.mes === publicos.mesAtual ? ' (este mês)' : ''} · ${contagem(a.total)}`,
            })),
        },
      );
      return grupos.filter((g) => g.itens.length > 0);
    }
    return [];
  })();

  const vazio: Record<Exclude<Tipo, 'base'>, string> = {
    importacao: 'Nenhuma importação com contatos que podem receber. Importe em Contatos.',
    perfil: 'Nenhum perfil com contatos que podem receber ainda.',
    publico: 'Os públicos prontos aparecem com as compras (Integrações) ou com uma planilha de pedidos.',
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="origem-da-base">De onde</Label>
          <Select id="origem-da-base" value={tipo} onChange={(e) => escolherTipo(e.target.value as Tipo | '')}>
            <option value="">Escolha…</option>
            {TIPOS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.titulo}
              </option>
            ))}
          </Select>
        </div>

        {tipo && tipo !== 'base' && (
          <div className="space-y-1">
            <Label htmlFor="valor-da-base">Qual</Label>
            <Select
              id="valor-da-base"
              value={valorDoSegundo}
              disabled={opcoes === null || opcoes.length === 0}
              onChange={(e) => escolherSegundo(e.target.value)}
            >
              <option value="">{opcoes === null ? 'Carregando…' : 'Escolha…'}</option>
              {(opcoes ?? []).map((g) => (
                <optgroup key={g.titulo} label={g.titulo}>
                  {g.itens.map((i) => (
                    <option key={i.valor} value={i.valor}>
                      {i.texto}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>
        )}
      </div>

      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {tipo && tipo !== 'base' && opcoes !== null && opcoes.length === 0 && !erro && (
        <p className="text-xs text-tinta-suave">{vazio[tipo]}</p>
      )}
    </div>
  );
}
