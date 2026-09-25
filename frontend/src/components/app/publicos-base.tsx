'use client';

import Link from 'next/link';
import { useState } from 'react';

import { IconeGrafico } from '@/components/app/icones';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { mensagemDoErro } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatarNumero, formatarReais } from '@/lib/formato';
import { contatos as servico } from '@/lib/servicos';
import type { AlvoDePublico, Publico, ResumoPublicos } from '@/lib/tipos';

/**
 * Públicos prontos a partir das compras: quanto gastam, em que momento estão,
 * como compram, onde moram e quando fazem aniversário.
 *
 * Clicar num público filtra a tabela; com um público escolhido, "Criar lista"
 * tira a foto que a campanha usa e "Dividir em blocos" separa o envio. VIP e
 * ticket são relativos à loja: a regra de cada cartão traz os valores dela.
 */

type Fixo = ResumoPublicos['publicos'][number]['id'];

const GRUPOS: { titulo: string; ids: Fixo[]; colunas: string }[] = [
  { titulo: 'Quanto gastam', ids: ['vip', 'ticket_alto', 'ticket_medio', 'ticket_baixo'], colunas: 'sm:grid-cols-2 xl:grid-cols-4' },
  { titulo: 'Momento', ids: ['um_pedido', 'marco_10'], colunas: 'sm:grid-cols-2' },
  { titulo: 'Como compram', ids: ['entrega', 'retirada', 'salao'], colunas: 'sm:grid-cols-3' },
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

/** Quantos bairros aparecem antes de "ver todos". */
const BAIRROS_VISIVEIS = 12;

const mesmoAlvo = (a: AlvoDePublico | null, publico: Publico, valor?: string | null) =>
  Boolean(a && a.publico === publico && (a.valor ?? null) === (valor ?? null));

export function PublicosDaBase({
  resumo,
  selecionado,
  aoSelecionar,
  aoMudar,
  aoDividir,
}: {
  resumo: ResumoPublicos;
  selecionado: AlvoDePublico | null;
  aoSelecionar: (alvo: AlvoDePublico | null) => void;
  /** Uma lista foi criada: recarregar. */
  aoMudar: () => void;
  aoDividir: (alvo: AlvoDePublico) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [todosOsBairros, setTodosOsBairros] = useState(false);

  const porId = new Map(resumo.publicos.map((p) => [p.id, p]));
  const grupos = GRUPOS.map((g) => ({ ...g, itens: g.ids.map((id) => porId.get(id)).filter((p) => p != null) })).filter(
    (g) => g.itens.some((p) => p.total > 0),
  );
  const aniversarios = resumo.aniversarios.filter((a) => a.total > 0);
  const bairros = todosOsBairros ? resumo.bairros : resumo.bairros.slice(0, BAIRROS_VISIVEIS);
  const vazio = !grupos.length && !resumo.bairros.length && !aniversarios.length;

  function escolher(alvo: AlvoDePublico) {
    setAviso('');
    aoSelecionar(mesmoAlvo(selecionado, alvo.publico, alvo.valor) ? null : alvo);
  }

  async function criarLista(alvo: AlvoDePublico) {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      const r = await servico.criarListaDoPublico(alvo.publico, alvo.valor);
      setAviso(
        `Lista "${r.nome}" criada com ${formatarNumero(r.total)} ${r.total === 1 ? 'contato' : 'contatos'}. Escolha essa lista ao montar a campanha.`,
      );
      aoMudar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section aria-label="Públicos pelas compras" className="anima-entrada space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-base font-semibold text-tinta">
          <IconeGrafico className="h-4 w-4" />
          Públicos pelas compras
        </h2>
        <p className="text-xs text-tinta-suave">Só quem pode receber. VIP e ticket são calculados com os valores da sua loja.</p>
      </div>

      {vazio ? (
        <Alerta tom="informacao">
          Para separar a base por valor gasto, bairro e jeito de comprar, traga as compras: conecte o cardápio em{' '}
          <Link href="/integracoes" className="font-semibold underline underline-offset-2">
            Integrações
          </Link>{' '}
          ou importe uma planilha com <strong>pedidos</strong> e <strong>total gasto</strong>.
        </Alerta>
      ) : (
        <>
          {grupos.map((g) => (
            <div key={g.titulo} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-tinta-suave">{g.titulo}</h3>
              <ul className={cn('grid grid-cols-1 gap-2', g.colunas)}>
                {g.itens.map((p) => {
                  const ativo = mesmoAlvo(selecionado, p.id);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => escolher({ publico: p.id, nome: p.nome, total: p.total })}
                        aria-pressed={ativo}
                        className={cn(
                          'flex h-full w-full items-start justify-between gap-3 rounded-card border border-borda bg-superficie p-3 text-left transition-shadow hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento',
                          ativo && 'border-acento bg-acento/5 ring-2 ring-acento',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-tinta">{p.nome}</span>
                          <span className="block text-xs leading-snug text-tinta-suave">{p.regra}</span>
                          {p.gastoCentavos > 0 && (
                            <span className="numerico mt-1 block text-xs text-tinta">
                              {formatarReais(p.gastoCentavos)} no total
                            </span>
                          )}
                        </span>
                        <span className="numerico shrink-0 text-lg font-semibold text-tinta">{formatarNumero(p.total)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {resumo.bairros.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-tinta-suave">
                Bairros <span className="font-normal normal-case tracking-normal">— o mais frequente nas entregas</span>
              </h3>
              <ul className="flex flex-wrap gap-2">
                {bairros.map((b) => (
                  <li key={b.bairro}>
                    <Ficha
                      ativa={mesmoAlvo(selecionado, 'bairro', b.bairro)}
                      onClick={() => escolher({ publico: 'bairro', valor: b.bairro, nome: `Bairro ${b.bairro}`, total: b.total })}
                      rotulo={b.bairro}
                      total={b.total}
                    />
                  </li>
                ))}
                {resumo.bairros.length > BAIRROS_VISIVEIS && (
                  <li>
                    <button
                      type="button"
                      onClick={() => setTodosOsBairros((v) => !v)}
                      aria-expanded={todosOsBairros}
                      className="rounded-full px-3 py-1.5 text-sm font-medium text-acento-forte underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento"
                    >
                      {todosOsBairros ? 'Mostrar menos' : `Mais ${resumo.bairros.length - BAIRROS_VISIVEIS} bairros`}
                    </button>
                  </li>
                )}
              </ul>
            </div>
          )}

          {aniversarios.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-tinta-suave">Aniversariantes</h3>
              <ul className="flex flex-wrap gap-2">
                {aniversarios.map((a) => {
                  const mes = MESES[a.mes - 1] ?? String(a.mes);
                  return (
                    <li key={a.mes}>
                      <Ficha
                        ativa={mesmoAlvo(selecionado, 'aniversario', String(a.mes))}
                        onClick={() =>
                          escolher({ publico: 'aniversario', valor: String(a.mes), nome: `Aniversariantes de ${mes}`, total: a.total })
                        }
                        rotulo={a.mes === resumo.mesAtual ? `${mes} (este mês)` : mes}
                        total={a.total}
                        destaque={a.mes === resumo.mesAtual}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}

      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {aviso && <Alerta tom="sucesso">{aviso}</Alerta>}

      {selecionado && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-acento/40 bg-acento/5 p-3">
          <p className="text-sm text-tinta">
            Mostrando <strong>{selecionado.nome}</strong>: {formatarNumero(selecionado.total)}{' '}
            {selecionado.total === 1 ? 'contato' : 'contatos'}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              tamanho="sm"
              onClick={() => void criarLista(selecionado)}
              carregando={ocupado}
              disabled={selecionado.total === 0}
            >
              Criar lista com estes contatos
            </Button>
            <Button
              tamanho="sm"
              variante="secundario"
              onClick={() => aoDividir(selecionado)}
              disabled={selecionado.total === 0}
            >
              Dividir em blocos
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

function Ficha({
  ativa,
  onClick,
  rotulo,
  total,
  destaque = false,
}: {
  ativa: boolean;
  onClick: () => void;
  rotulo: string;
  total: number;
  destaque?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativa}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento',
        ativa
          ? 'border-acento bg-acento/10 text-tinta ring-2 ring-acento'
          : destaque
            ? 'border-acento/60 bg-superficie text-tinta hover:border-acento'
            : 'border-borda bg-superficie text-tinta hover:border-acento',
      )}
    >
      <span className="font-semibold first-letter:uppercase">{rotulo}</span>
      <span className="numerico text-tinta-suave">{formatarNumero(total)}</span>
    </button>
  );
}
