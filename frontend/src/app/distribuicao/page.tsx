'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { IconeAtualizar, IconeSair } from '@/components/app/icones';
import { PainelListaEspera } from '@/components/app/painel-lista-espera';
import { CarregandoMarca } from '@/components/marca/carregando-marca';
import { Logotipo } from '@/components/marca/logotipo';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { EsqueletoLista } from '@/components/ui/esqueleto';
import { NumeroAnimado } from '@/components/ui/numero-animado';
import { ErroApi, mensagemDoErro } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  distribuicao,
  type ContaNoConsole,
  type OperadorLogado,
  type ResumoDoConsole,
  type SituacaoConta,
  type TelemetriaDoConsole,
} from '@/lib/servicos';

/**
 * O console de distribuição.
 *
 * Um painel é lido de relance, não de cima a baixo. Por isso o resumo vem
 * primeiro, e a situação de cada conta aparece em forma — uma pílula colorida —
 * e não só em texto: o olho acha "em risco" na lista antes de ler qualquer nome.
 *
 * O cabeçalho escuro com o selo "Distribuição" existe para que ninguém confunda
 * esta tela com o app do cliente. Operar achando que se está numa conta, quando
 * se está vendo todas, é o tipo de engano que a cor evita sem precisar avisar.
 */

const SITUACAO: Record<SituacaoConta, { rotulo: string; classe: string; ordem: number }> = {
  em_risco: { rotulo: 'Em risco', classe: 'bg-realce text-tinta', ordem: 0 },
  ativa: { rotulo: 'Ativa', classe: 'bg-sucesso/15 text-sucesso', ordem: 1 },
  inativa: { rotulo: 'Inativa', classe: 'bg-erro/10 text-erro', ordem: 2 },
  nunca_usou: { rotulo: 'Nunca usou', classe: 'bg-superficie-2 text-tinta-suave', ordem: 3 },
};

function quando(iso: string | null): string {
  if (!iso) return '—';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

const numero = (n: number) => n.toLocaleString('pt-BR');

export default function ConsoleDistribuicao() {
  const router = useRouter();
  const [operador, setOperador] = useState<OperadorLogado | null>(null);
  const [resumo, setResumo] = useState<ResumoDoConsole | null>(null);
  const [contas, setContas] = useState<ContaNoConsole[]>([]);
  const [telemetria, setTelemetria] = useState<TelemetriaDoConsole | null>(null);
  const [aba, setAba] = useState<'contas' | 'lista' | 'telemetria'>('contas');
  const [filtro, setFiltro] = useState<SituacaoConta | 'todas'>('todas');
  const [dias, setDias] = useState(7);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const eu = await distribuicao.eu();
      setOperador(eu);
      const [r, c] = await Promise.all([distribuicao.resumo(), distribuicao.contas()]);
      setResumo(r);
      setContas(c);
    } catch (e) {
      // Sem sessão de operador: para o login DO CONSOLE, não o do cliente.
      if (e instanceof ErroApi && e.status === 401) {
        router.replace('/distribuicao/entrar');
        return;
      }
      setErro(mensagemDoErro(e));
    } finally {
      setCarregando(false);
    }
  }, [router]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    if (aba !== 'telemetria' || !operador) return;
    distribuicao
      .telemetria(dias)
      .then(setTelemetria)
      .catch((e) => setErro(mensagemDoErro(e)));
  }, [aba, dias, operador]);

  const visiveis = useMemo(() => {
    const lista = filtro === 'todas' ? contas : contas.filter((c) => c.situacao === filtro);
    // "Em risco" primeiro: é quem ainda dá para recuperar com um contato.
    return [...lista].sort((a, b) => SITUACAO[a.situacao].ordem - SITUACAO[b.situacao].ordem);
  }, [contas, filtro]);

  async function sair() {
    await distribuicao.sair().catch(() => undefined);
    router.replace('/distribuicao/entrar');
  }

  if (carregando) {
    return <CarregandoMarca texto="Abrindo o console…" />;
  }

  return (
    <div className="min-h-screen bg-fundo">
      <header className="sticky top-0 z-40 overflow-hidden border-b border-lateral-borda bg-lateral text-lateral-tinta shadow-flutuante">
        <div aria-hidden="true" className="fundo-pontos-claro pointer-events-none absolute inset-0" />
        <div className="relative mx-auto flex max-w-[90rem] items-center gap-3 px-4 py-3 sm:px-6">
          <Logotipo sobreEscuro animado />
          <span className="rounded-full bg-acento px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-acento-contraste">
            Distribuição
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-2 text-sm text-lateral-suave sm:inline-flex">
              <span className="ponto-vivo h-2 w-2 rounded-full bg-acento text-acento" aria-hidden="true" />
              {operador?.nome}
            </span>
            <button
              type="button"
              onClick={() => void sair()}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-lateral-suave transition-colors hover:bg-white/10 hover:text-lateral-tinta"
            >
              <IconeSair className="h-4 w-4" />
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="anima-entrada mx-auto max-w-[90rem] space-y-6 px-4 py-6 sm:px-6 lg:py-8">
        {erro && <Alerta tom="erro">{erro}</Alerta>}

        {resumo && <Indicadores resumo={resumo} aoFiltrar={(s) => { setAba('contas'); setFiltro(s); }} />}

        <div className="flex flex-wrap items-center gap-2 border-b border-borda" role="tablist">
          {(['contas', 'lista', 'telemetria'] as const).map((a) => (
            <button
              key={a}
              type="button"
              role="tab"
              aria-selected={aba === a}
              onClick={() => setAba(a)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                aba === a ? 'border-acento text-tinta' : 'border-transparent text-tinta-suave hover:text-tinta',
              )}
            >
              {a === 'contas'
                ? `Contas (${numero(contas.length)})`
                : a === 'lista'
                  ? 'Lista de espera'
                  : 'Telemetria'}
            </button>
          ))}
          <Button variante="secundario" tamanho="sm" className="ml-auto mb-1" onClick={() => void carregar()}>
            <IconeAtualizar />
            Atualizar
          </Button>
        </div>

        {aba === 'contas' ? (
          <TabelaContas contas={visiveis} filtro={filtro} aoFiltrar={setFiltro} total={contas.length} />
        ) : aba === 'lista' ? (
          <PainelListaEspera />
        ) : (
          <PainelTelemetria telemetria={telemetria} dias={dias} aoMudarDias={setDias} />
        )}
      </main>
    </div>
  );
}

/* --------------------------------------------------------------- indicadores */

function Indicadores({
  resumo,
  aoFiltrar,
}: {
  resumo: ResumoDoConsole;
  aoFiltrar: (s: SituacaoConta) => void;
}) {
  const r = resumo;
  return (
    <div className="space-y-3">
      {/* A saúde da base: cada número leva à lista filtrada. */}
      <div className="escalonado grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Cartao rotulo="Contas" valor={r.contas.total} />
        <Cartao rotulo="Ativas" valor={r.contas.ativas} tom="sucesso" onClick={() => aoFiltrar('ativa')} ajuda="enviaram nos últimos 30 dias" />
        <Cartao rotulo="Em risco" valor={r.contas.emRisco} tom="realce" onClick={() => aoFiltrar('em_risco')} ajuda="30 a 60 dias sem enviar" />
        <Cartao rotulo="Inativas" valor={r.contas.inativas} tom="erro" onClick={() => aoFiltrar('inativa')} ajuda="mais de 60 dias" />
        <Cartao rotulo="Nunca usaram" valor={r.contas.nuncaUsaram} onClick={() => aoFiltrar('nunca_usou')} />
      </div>

      <div className="escalonado grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Cartao rotulo="Disparos no ciclo" valor={r.disparos.ciclo} />
        <Cartao rotulo="Disparos em 7 dias" valor={r.disparos.ultimos7d} ajuda={`${numero(r.disparos.ultimas24h)} nas últimas 24h`} />
        <Cartao rotulo="Campanhas saindo" valor={r.campanhasEmAndamento} />
        <Cartao rotulo="Perto do teto" valor={r.perto_do_teto} tom={r.perto_do_teto ? 'realce' : undefined} ajuda="acima de 80% do plano" />
        <Cartao
          rotulo="Erros em 24h"
          valor={r.erros.ultimas24h}
          tom={r.erros.ultimas24h ? 'erro' : undefined}
          ajuda={`${numero(r.erros.contasAfetadas24h)} conta(s) afetada(s)`}
        />
      </div>
    </div>
  );
}

function Cartao({
  rotulo,
  valor,
  tom,
  ajuda,
  onClick,
}: {
  rotulo: string;
  valor: number;
  tom?: 'sucesso' | 'realce' | 'erro';
  ajuda?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'relative overflow-hidden rounded-card border border-borda bg-superficie p-4 text-left shadow-card',
        onClick && 'cartao-interativo',
      )}
    >
      {/* Faixa lateral de estado: lida antes do número. */}
      {tom && (
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-0 left-0 w-1',
            tom === 'sucesso' && 'bg-sucesso',
            tom === 'realce' && 'bg-realce',
            tom === 'erro' && 'bg-erro',
          )}
        />
      )}
      <p className="text-xs font-medium text-tinta-suave">{rotulo}</p>
      <NumeroAnimado valor={valor} className="numerico mt-1 block text-2xl font-semibold text-tinta" />
      {ajuda && <p className="mt-0.5 text-[0.7rem] text-tinta-suave">{ajuda}</p>}
    </Tag>
  );
}

/* ---------------------------------------------------------------------- contas */

function TabelaContas({
  contas,
  filtro,
  aoFiltrar,
  total,
}: {
  contas: ContaNoConsole[];
  filtro: SituacaoConta | 'todas';
  aoFiltrar: (f: SituacaoConta | 'todas') => void;
  total: number;
}) {
  const opcoes: (SituacaoConta | 'todas')[] = ['todas', 'em_risco', 'ativa', 'inativa', 'nunca_usou'];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por situação">
        {opcoes.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={filtro === o}
            onClick={() => aoFiltrar(o)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              filtro === o
                ? 'border-transparent bg-acento text-acento-contraste'
                : 'border-borda bg-superficie text-tinta-suave hover:border-acento',
            )}
          >
            {o === 'todas' ? `Todas (${total})` : SITUACAO[o].rotulo}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-card border border-borda bg-superficie shadow-card">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <caption className="sr-only">Contas, com situação, uso do plano e atividade</caption>
          <thead>
            <tr className="border-b border-borda bg-superficie-2 text-xs uppercase tracking-wide text-tinta-suave">
              <th scope="col" className="px-3 py-2.5 font-medium">Conta</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Situação</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Uso do ciclo</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Último envio</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Envios 30d</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Erros 7d</th>
              <th scope="col" className="px-3 py-2.5 font-medium">WhatsApp</th>
            </tr>
          </thead>
          <tbody>
            {contas.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-tinta-suave">
                  Nenhuma conta nesta situação.
                </td>
              </tr>
            )}
            {contas.map((c) => (
              <tr key={c.id} className="border-b border-borda/60 last:border-0 hover:bg-superficie-2/60">
                <td className="px-3 py-2.5">
                  <p className="font-medium text-tinta">{c.nome}</p>
                  <p className="text-xs text-tinta-suave">
                    {c.planoNome ?? 'sem plano'} · {c.assinaturaStatus ?? 'sem assinatura'}
                  </p>
                </td>
                <td className="px-3 py-2.5">
                  <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', SITUACAO[c.situacao].classe)}>
                    {SITUACAO[c.situacao].rotulo}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <BarraDeUso uso={c.usoCiclo} teto={c.teto} percentual={c.usoPercentual} />
                </td>
                <td className="px-3 py-2.5 text-tinta-suave">{quando(c.ultimoEnvio)}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-tinta">{numero(c.envios30d)}</td>
                <td className={cn('px-3 py-2.5 text-right font-mono tabular-nums', c.erros7d ? 'text-erro' : 'text-tinta-suave')}>
                  {numero(c.erros7d)}
                </td>
                <td className="px-3 py-2.5">
                  <span className={cn('text-xs', c.whatsappPronto ? 'text-sucesso' : 'text-tinta-suave')}>
                    {c.whatsappPronto ? '● pronto' : '○ não conectado'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Uso sobre o teto, com a cor mudando ANTES de estourar. */
function BarraDeUso({ uso, teto, percentual }: { uso: number; teto: number | null; percentual: number | null }) {
  if (!teto || percentual === null) {
    return <span className="font-mono text-xs tabular-nums text-tinta-suave">{numero(uso)}</span>;
  }
  const largura = Math.min(percentual, 100);
  return (
    <div className="w-36 space-y-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-superficie-2">
        <div
          className={cn('h-full rounded-full', percentual >= 100 ? 'bg-erro' : percentual >= 80 ? 'bg-realce' : 'bg-acento')}
          style={{ width: `${largura}%` }}
        />
      </div>
      <p className="font-mono text-[0.7rem] tabular-nums text-tinta-suave">
        {numero(uso)} / {numero(teto)} · {percentual}%
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------- telemetria */

function PainelTelemetria({
  telemetria,
  dias,
  aoMudarDias,
}: {
  telemetria: TelemetriaDoConsole | null;
  dias: number;
  aoMudarDias: (d: number) => void;
}) {
  if (!telemetria) {
    return <EsqueletoLista linhas={4} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Janela de tempo">
        {[1, 7, 30].map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={dias === d}
            onClick={() => aoMudarDias(d)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium',
              dias === d ? 'border-transparent bg-acento text-acento-contraste' : 'border-borda bg-superficie text-tinta-suave hover:border-acento',
            )}
          >
            {d === 1 ? 'Últimas 24h' : `${d} dias`}
          </button>
        ))}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-tinta">Por código</h2>
        <p className="text-xs text-tinta-suave">
          Um código em muitas contas é UM problema — token vencendo em massa, limite da Meta —, não vários.
        </p>
        <div className="overflow-x-auto rounded-card border border-borda bg-superficie shadow-card">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">Erros agrupados por código</caption>
            <thead>
              <tr className="border-b border-borda bg-superficie-2 text-xs uppercase tracking-wide text-tinta-suave">
                <th scope="col" className="px-3 py-2.5 font-medium">Código</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Origem · classe</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Ocorrências</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Contas</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Última</th>
              </tr>
            </thead>
            <tbody>
              {telemetria.porCodigo.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-tinta-suave">
                    Nenhum erro nesta janela.
                  </td>
                </tr>
              )}
              {telemetria.porCodigo.map((l, i) => (
                <tr key={i} className="border-b border-borda/60 last:border-0">
                  <td className="px-3 py-2.5 font-mono font-medium text-tinta">{l.codigo ?? '—'}</td>
                  <td className="px-3 py-2.5 text-tinta-suave">
                    {l.origem}
                    {l.classe ? ` · ${l.classe}` : ''}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-tinta">{numero(l.ocorrencias)}</td>
                  <td className={cn('px-3 py-2.5 text-right font-mono tabular-nums', l.contas > 1 ? 'font-semibold text-erro' : 'text-tinta')}>
                    {numero(l.contas)}
                  </td>
                  <td className="px-3 py-2.5 text-tinta-suave">{quando(l.ultima)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-tinta">Mais recentes</h2>
        <ul className="divide-y divide-borda/60 overflow-hidden rounded-card border border-borda bg-superficie shadow-card">
          {telemetria.recentes.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-tinta-suave">Nada por aqui.</li>
          )}
          {telemetria.recentes.map((r) => (
            <li key={r.id} className="space-y-1 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="font-mono font-medium text-tinta">{r.codigo ?? r.status ?? '—'}</span>
                <span className="text-tinta-suave">{r.contaNome ?? 'sem conta'}</span>
                {r.referencia && (
                  <span className="rounded bg-superficie-2 px-1.5 py-0.5 font-mono text-[0.65rem] text-tinta-suave">
                    ref {r.referencia}
                  </span>
                )}
                <span className="ml-auto text-tinta-suave">{r.criadoEm ? new Date(r.criadoEm).toLocaleString('pt-BR') : ''}</span>
              </div>
              {r.mensagem && <p className="break-words font-mono text-[0.72rem] text-tinta-suave">{r.mensagem}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
