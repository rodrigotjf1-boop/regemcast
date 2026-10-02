'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';

import { IconeAtualizar, IconeSair } from '@/components/app/icones';
import { PainelListaEspera } from '@/components/app/painel-lista-espera';
import { PainelPlanos } from '@/components/app/painel-planos';
import { PainelTarifas } from '@/components/app/painel-tarifas';
import { PainelRegem } from '@/components/app/painel-regem';
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
  type AcessoNoConsole,
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
  const [aba, setAba] = useState<'contas' | 'lista' | 'planos' | 'tarifas' | 'regem' | 'telemetria'>('contas');
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
          {(['contas', 'lista', 'planos', 'tarifas', 'regem', 'telemetria'] as const).map((a) => (
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
                  : a === 'planos'
                    ? 'Planos'
                    : a === 'tarifas'
                      ? 'Tarifas da Meta'
                    : a === 'regem'
                      ? 'Regem'
                      : 'Telemetria'}
            </button>
          ))}
          <Button variante="secundario" tamanho="sm" className="ml-auto mb-1" onClick={() => void carregar()}>
            <IconeAtualizar />
            Atualizar
          </Button>
        </div>

        {aba === 'contas' ? (
          <TabelaContas
            contas={visiveis}
            filtro={filtro}
            aoFiltrar={setFiltro}
            total={contas.length}
            aoAtualizar={() => void carregar()}
          />
        ) : aba === 'lista' ? (
          <PainelListaEspera />
        ) : aba === 'planos' ? (
          <PainelPlanos />
        ) : aba === 'tarifas' ? (
          <PainelTarifas />
        ) : aba === 'regem' ? (
          <PainelRegem contas={contas} />
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

      {/* Dinheiro: o que entra todo mês e quem está atrasado. */}
      <div className="escalonado grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Cartao rotulo="Receita mensal" valor={r.receita.mrrCentavos} moeda tom="sucesso" ajuda="assinaturas pagas e em dia" />
        <Cartao rotulo="Pagantes" valor={r.receita.pagantes} />
        <Cartao rotulo="Em grátis" valor={r.receita.emGratis} />
        <Cartao rotulo="Grátis pelo Regem" valor={r.receita.gratisPeloRegem ?? 0} ajuda="integração ativa" />
        <Cartao
          rotulo="Inadimplentes"
          valor={r.receita.inadimplentes}
          tom={r.receita.inadimplentes ? 'erro' : undefined}
          ajuda="disparos param após a carência"
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
  moeda = false,
}: {
  rotulo: string;
  valor: number;
  tom?: 'sucesso' | 'realce' | 'erro';
  ajuda?: string;
  onClick?: () => void;
  /** O valor vem em centavos e é mostrado em reais. */
  moeda?: boolean;
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
      <NumeroAnimado
        valor={valor}
        formatar={moeda ? (n) => (n / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : undefined}
        className="numerico mt-1 block text-2xl font-semibold text-tinta"
      />
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
  aoAtualizar,
}: {
  contas: ContaNoConsole[];
  filtro: SituacaoConta | 'todas';
  aoFiltrar: (f: SituacaoConta | 'todas') => void;
  total: number;
  aoAtualizar: () => void;
}) {
  const opcoes: (SituacaoConta | 'todas')[] = ['todas', 'em_risco', 'ativa', 'inativa', 'nunca_usou'];
  const [acessosAbertos, setAcessosAbertos] = useState<string | null>(null);

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

      <div className="relative overflow-x-auto rounded-card border border-borda bg-superficie shadow-card">
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
              <th scope="col" className="px-3 py-2.5 font-medium"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {contas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-tinta-suave">
                  Nenhuma conta nesta situação.
                </td>
              </tr>
            )}
            {contas.map((c) => (
              <Fragment key={c.id}>
              <tr className="border-b border-borda/60 last:border-0 hover:bg-superficie-2/60">
                <td className="px-3 py-2.5">
                  <p className="font-medium text-tinta">{c.nome}</p>
                  <p className="text-xs text-tinta-suave">
                    {c.gratisPeloRegem
                      ? `grátis pelo Regem${c.assinaturaStatus === 'ativa' ? ` · também paga ${c.planoNome ?? ''}` : ''}`
                      : `${c.planoNome ?? 'sem plano'} · ${c.assinaturaStatus ?? 'sem assinatura'}`}
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
                <td className="px-3 py-2.5 text-right">
                  <div className="flex flex-col items-end gap-1.5">
                    <Button
                      tamanho="sm"
                      variante="discreto"
                      aria-expanded={acessosAbertos === c.id}
                      onClick={() => setAcessosAbertos((atual) => (atual === c.id ? null : c.id))}
                    >
                      {acessosAbertos === c.id ? 'Fechar acessos' : 'Acessos'}
                    </Button>
                    {c.assinaturaStatus && c.assinaturaStatus !== 'ativa' && !c.gratisPeloRegem ? (
                      <EstenderGratis contaId={c.id} nome={c.nome} aoConcluir={aoAtualizar} />
                    ) : null}
                  </div>
                </td>
              </tr>
              {acessosAbertos === c.id ? (
                <tr className="border-b border-borda/60 bg-superficie-2/40">
                  <td colSpan={8} className="px-3 py-3">
                    <AcessosDaConta contaId={c.id} />
                  </td>
                </tr>
              ) : null}
              </Fragment>
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
        <div className="relative overflow-x-auto rounded-card border border-borda bg-superficie shadow-card">
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

/**
 * Estende o grátis de uma conta (negociação, conta interna, revisão da Meta).
 * Pede os dias ali mesmo, sem sair da tabela.
 */
const DOIS_FATORES: Record<string, string> = { nenhum: 'só senha', email: 'código por e-mail', app: 'aplicativo autenticador' };

/**
 * Quem acessa a conta, para o suporte. "Zerar duas etapas" é para quem perdeu o
 * celular do autenticador — só depois de confirmar a identidade por fora.
 */
function AcessosDaConta({ contaId }: { contaId: string }) {
  const [acessos, setAcessos] = useState<AcessoNoConsole[] | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro('');
    try {
      setAcessos(await distribuicao.acessos(contaId));
    } catch (e) {
      setErro(mensagemDoErro(e));
    }
  }, [contaId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function zerar(a: AcessoNoConsole) {
    setErro('');
    setOcupado(a.id);
    try {
      await distribuicao.zerarDuasEtapas(a.id);
      setAviso(`Duas etapas de ${a.nome} zeradas. A pessoa entra só com a senha e pode cadastrar de novo.`);
      setConfirmar(null);
      await carregar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado(null);
    }
  }

  if (erro && !acessos) return <p className="text-xs text-erro">{erro}</p>;
  if (!acessos) return <p className="text-xs text-tinta-suave">Carregando acessos…</p>;

  return (
    <div className="space-y-2">
      {aviso ? <p className="text-xs text-sucesso">{aviso}</p> : null}
      {erro ? <p className="text-xs text-erro">{erro}</p> : null}
      <ul className="divide-y divide-borda/60">
        {acessos.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-tinta">
                {a.nome} <span className="text-xs font-normal text-tinta-suave">· {a.papel === 'dono' ? 'dono' : 'operador'}</span>
              </p>
              <p className="break-all text-xs text-tinta-suave">
                {a.email} · {DOIS_FATORES[a.doisFatores] ?? a.doisFatores}
                {a.status !== 'ativo' ? ' · suspenso' : ''}
                {a.travado ? ' · travado por tentativas' : ''} · último acesso {quando(a.ultimoLoginEm)}
              </p>
            </div>
            {a.doisFatores !== 'nenhum' || a.travado ? (
              confirmar === a.id ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-tinta-suave">Identidade confirmada por fora?</span>
                  <Button tamanho="sm" variante="discreto" onClick={() => setConfirmar(null)}>
                    Cancelar
                  </Button>
                  <Button tamanho="sm" variante="perigo" carregando={ocupado === a.id} onClick={() => void zerar(a)}>
                    Zerar agora
                  </Button>
                </div>
              ) : (
                <Button tamanho="sm" variante="discreto" onClick={() => setConfirmar(a.id)}>
                  {a.doisFatores !== 'nenhum' ? 'Zerar duas etapas' : 'Destravar'}
                </Button>
              )
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EstenderGratis({ contaId, nome, aoConcluir }: { contaId: string; nome: string; aoConcluir: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [dias, setDias] = useState('30');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  if (!aberto) {
    return (
      <Button tamanho="sm" variante="discreto" onClick={() => setAberto(true)}>
        Estender grátis
      </Button>
    );
  }

  async function confirmar() {
    setErro('');
    setOcupado(true);
    try {
      await distribuicao.estenderGratis(contaId, Number(dias));
      setAberto(false);
      aoConcluir();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="ml-auto flex max-w-[14rem] flex-col items-end gap-1.5">
      <label className="flex items-center gap-2 text-xs text-tinta-suave">
        Dias a mais para {nome}
        <input
          value={dias}
          onChange={(e) => setDias(e.target.value.replace(/\D/g, ''))}
          inputMode="numeric"
          className="w-14 rounded-lg border border-borda bg-superficie px-2 py-1 text-right font-mono text-xs text-tinta"
          aria-label="Dias"
        />
      </label>
      {erro ? <p className="text-right text-xs text-erro">{erro}</p> : null}
      <div className="flex gap-1.5">
        <Button tamanho="sm" variante="discreto" onClick={() => setAberto(false)}>
          Cancelar
        </Button>
        <Button tamanho="sm" carregando={ocupado} onClick={() => void confirmar()}>
          Estender
        </Button>
      </div>
    </div>
  );
}
