'use client';

import Link from 'next/link';

import { AnelUso } from '@/components/app/anel-uso';
import {
  IconeCampanha,
  IconeCheck,
  IconeContatos,
  IconeConversa,
  IconeImportar,
  IconeMais,
  IconeModelo,
  IconeRaio,
  IconeSetaDireita,
} from '@/components/app/icones';
import { BadgeCampanha, BarraStatus } from '@/components/app/status-campanha';
import { useSessao } from '@/components/app/sessao';
import { Button } from '@/components/ui/button';
import { Esqueleto, EsqueletoLista } from '@/components/ui/esqueleto';
import { EstadoErro } from '@/components/ui/estado-erro';
import { Estatistica } from '@/components/ui/estatistica';
import { cn } from '@/lib/cn';
import { formatarData, formatarNumero } from '@/lib/formato';
import { campanhas, contatos, conta, whatsapp } from '@/lib/servicos';
import { useCarga } from '@/lib/use-carga';

/**
 * Painel da conta — a primeira tela depois do login.
 *
 * Responde, nesta ordem, às perguntas de quem abre um produto de disparo:
 * quanto ainda posso enviar, o que está saindo agora, e o que falta para eu
 * conseguir disparar.
 *
 * REGRA desta tela: número só aparece quando veio do servidor. Cada bloco tem a
 * própria leitura e o próprio erro — a Meta fora do ar não apaga o consumo do
 * plano, e "não consegui ler" nunca vira zero.
 */
export default function Painel() {
  const { sessao } = useSessao();
  const resumo = useCarga(() => conta.resumo());
  const listaCampanhas = useCarga(() => campanhas.listar());
  const paginaContatos = useCarga(() => contatos.listar(1, 1));
  const situacao = useCarga(() => whatsapp.situacao());
  const conectado = situacao.dados?.conectado === true;
  // Modelos aprovados só existem na Meta, e só dá para perguntar com o número conectado.
  const modelosMeta = useCarga(() => whatsapp.modelos(), conectado);

  const primeiroNome = sessao.usuario.nome.split(' ')[0] || sessao.usuario.nome;
  const nomeConta = resumo.dados?.conta.nome ?? sessao.conta.nome;
  const uso = resumo.dados?.uso ?? null;
  const lista = listaCampanhas.dados;
  const emAndamento = lista?.filter((c) => c.status === 'enviando' || c.status === 'agendada') ?? [];
  const aprovados = modelosMeta.dados?.filter((m) => m.status === 'aprovado').length ?? null;
  const totalContatos = paginaContatos.dados?.total ?? null;

  const passos = [
    {
      titulo: 'Conectar o número',
      descricao: 'Você autoriza na janela da Meta e nós concluímos a conexão.',
      href: '/whatsapp',
      feito: conectado,
      Icone: IconeConversa,
    },
    {
      titulo: 'Importar contatos',
      descricao: 'Agenda do celular, planilha ou números colados.',
      href: '/contatos?importar=1',
      feito: (totalContatos ?? 0) > 0,
      Icone: IconeContatos,
    },
    {
      titulo: 'Ter um modelo aprovado',
      descricao: 'Conferimos as regras da Meta antes de enviar para análise.',
      href: '/modelos',
      feito: (aprovados ?? 0) > 0,
      Icone: IconeModelo,
    },
    {
      titulo: 'Disparar a primeira campanha',
      descricao: 'Escolha o público, o modelo e a janela de envio.',
      href: '/campanhas?nova=1',
      feito: (lista ?? []).some((c) => c.status !== 'rascunho'),
      Icone: IconeCampanha,
    },
  ];
  const feitos = passos.filter((p) => p.feito).length;
  const carregandoPassos = situacao.carregando || paginaContatos.carregando || listaCampanhas.carregando;

  return (
    <div className="space-y-6 lg:space-y-8">
      {/* Faixa de destaque */}
      <section className="anima-entrada relative isolate overflow-hidden rounded-3xl bg-lateral text-lateral-tinta shadow-flutuante">
        <div aria-hidden="true" className="fundo-pontos-claro absolute inset-0 -z-10" />
        <div
          aria-hidden="true"
          className="anima-aurora absolute -right-20 -top-32 -z-10 h-80 w-80 rounded-full bg-acento/[0.14] blur-3xl"
        />
        <div
          aria-hidden="true"
          className="anima-aurora absolute -bottom-40 left-1/3 -z-10 h-72 w-72 rounded-full bg-realce/[0.08] blur-3xl [animation-delay:-5s]"
        />
        <svg
          aria-hidden="true"
          viewBox="0 0 600 80"
          preserveAspectRatio="none"
          className="absolute bottom-0 left-0 -z-10 h-10 w-full opacity-40"
          fill="none"
        >
          <path
            d="M0 50H180L200 30L220 70L240 14L262 76L282 40L300 50H600"
            stroke="rgb(var(--cor-acento))"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className="anima-pulso-traco"
          />
        </svg>

        <div className="flex flex-col gap-8 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between lg:p-10">
          <div className="escalonado min-w-0 max-w-xl space-y-4">
            <p className="text-sm text-lateral-suave">Olá, {primeiroNome}</p>
            <h1 className="text-balance text-3xl font-semibold tracking-tight text-lateral-tinta sm:text-4xl">
              {nomeConta}
            </h1>
            <EstadoConexao carregando={situacao.carregando} erro={situacao.erro} conectado={conectado} />
            <div className="flex flex-wrap gap-3 pt-2">
              <Link href="/campanhas?nova=1">
                <Button className="h-11 px-5">
                  <IconeMais />
                  Nova campanha
                </Button>
              </Link>
              <Link href="/contatos?importar=1">
                <Button
                  variante="discreto"
                  className="h-11 border border-lateral-borda bg-white/5 px-5 text-lateral-tinta backdrop-blur-sm hover:bg-white/10 hover:text-lateral-tinta"
                >
                  <IconeImportar />
                  Importar contatos
                </Button>
              </Link>
            </div>
          </div>

          <div className="flex flex-col items-center gap-5 rounded-2xl border border-lateral-borda bg-lateral-2/60 p-5 text-center backdrop-blur-sm sm:flex-row sm:gap-6 sm:text-left">
            {resumo.carregando ? (
              <Esqueleto className="h-40 w-40 rounded-full opacity-20" />
            ) : uso ? (
              <AnelUso usado={uso.disparos} teto={uso.teto} />
            ) : (
              <div className="grid h-40 w-40 place-items-center rounded-full border-[9px] border-white/10 text-center text-xs text-lateral-suave">
                Consumo
                <br />
                indisponível
              </div>
            )}
            <div className="min-w-0 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-lateral-suave">
                Uso do ciclo
              </p>
              <p className="text-lg font-semibold text-lateral-tinta">
                {resumo.dados?.plano?.nome ?? (resumo.carregando ? '…' : 'Sem plano definido')}
              </p>
              {uso?.restantes !== null && uso?.restantes !== undefined ? (
                <p className="text-sm text-lateral-suave">
                  <span className="numerico font-semibold text-acento">{formatarNumero(uso.restantes)}</span>{' '}
                  disparos disponíveis
                </p>
              ) : null}
              {resumo.dados?.assinatura?.cicloFim ? (
                <p className="text-xs text-lateral-suave">
                  Renova em {formatarData(resumo.dados.assinatura.cicloFim)}
                </p>
              ) : null}
              {resumo.erro ? (
                <button
                  type="button"
                  onClick={() => void resumo.recarregar()}
                  className="text-xs font-medium text-acento underline underline-offset-4"
                >
                  Tentar ler de novo
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* Indicadores */}
      <section aria-label="Indicadores" className="escalonado grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Estatistica
          rotulo="Disparos no ciclo"
          valor={uso?.disparos ?? null}
          carregando={resumo.carregando}
          tom="acento"
          icone={<IconeRaio className="h-5 w-5" />}
          apoio={uso?.teto ? `Teto de ${formatarNumero(uso.teto)} no plano` : 'Aceitos pela Meta neste ciclo'}
        />
        <Estatistica
          rotulo="Campanhas"
          valor={lista ? lista.length : null}
          carregando={listaCampanhas.carregando}
          tom="realce"
          icone={<IconeCampanha className="h-5 w-5" />}
          apoio={
            emAndamento.length > 0
              ? `${emAndamento.length} saindo agora`
              : 'Nenhuma saindo agora'
          }
        />
        <Estatistica
          rotulo="Contatos"
          valor={totalContatos}
          carregando={paginaContatos.carregando}
          tom="neutro"
          icone={<IconeContatos className="h-5 w-5" />}
          apoio="Na sua base, com autorização registrada"
        />
        <Estatistica
          rotulo="Modelos aprovados"
          valor={conectado ? aprovados : null}
          carregando={situacao.carregando || (conectado && modelosMeta.carregando)}
          tom="sucesso"
          icone={<IconeModelo className="h-5 w-5" />}
          apoio="Prontos para iniciar conversa"
          indisponivel={
            !situacao.carregando && !conectado && !situacao.erro
              ? 'Conecte o número para ver os aprovados'
              : 'Não consegui ler agora.'
          }
        />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3 xl:items-start">
        {/* Campanhas recentes */}
        <section className="anima-entrada rounded-card border border-borda bg-superficie shadow-card xl:col-span-2">
          <div className="flex items-center justify-between gap-3 border-b border-borda px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-tinta">Campanhas recentes</h2>
              <p className="text-xs text-tinta-suave">O que saiu e como cada envio terminou.</p>
            </div>
            <Link
              href="/campanhas"
              className="group inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-sm font-medium text-acento-forte"
            >
              Ver todas
              <IconeSetaDireita className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          <div className="p-5">
            {listaCampanhas.carregando ? (
              <EsqueletoLista linhas={3} />
            ) : listaCampanhas.erro ? (
              <EstadoErro
                titulo="Não consegui ler suas campanhas"
                mensagem={listaCampanhas.erro}
                aoTentarDeNovo={() => void listaCampanhas.recarregar()}
              />
            ) : !lista || lista.length === 0 ? (
              <div className="fundo-pontos flex flex-col items-center gap-3 rounded-xl border border-dashed border-borda px-4 py-10 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-acento text-acento-contraste shadow-brilho">
                  <IconeCampanha className="h-6 w-6" />
                </span>
                <p className="text-sm font-semibold text-tinta">Nenhuma campanha ainda</p>
                <p className="max-w-sm text-sm text-tinta-suave">
                  Quando a primeira sair, cada envio aparece aqui com o estado de entrega e leitura.
                </p>
                <Link href="/campanhas?nova=1">
                  <Button tamanho="sm">
                    <IconeMais />
                    Montar a primeira
                  </Button>
                </Link>
              </div>
            ) : (
              <ul className="escalonado divide-y divide-borda">
                {lista.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/campanhas/${c.id}`}
                      className="group -mx-2 flex flex-col gap-3 rounded-xl px-2 py-3.5 transition-colors hover:bg-superficie-2/70 sm:flex-row sm:items-center sm:gap-5"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-superficie-2 text-tinta-suave transition-colors group-hover:bg-acento group-hover:text-acento-contraste">
                          <IconeCampanha className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-tinta">{c.nome}</p>
                          <p className="truncate text-xs text-tinta-suave">
                            {formatarNumero(c.total)} {c.total === 1 ? 'destinatário' : 'destinatários'} ·{' '}
                            {formatarData(c.criadoEm)}
                          </p>
                        </div>
                      </div>
                      <BarraStatus porStatus={c.porStatus} total={c.total} legenda={false} className="sm:w-40" />
                      <span className="shrink-0 self-start sm:self-auto">
                        <BadgeCampanha status={c.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Primeiros passos */}
        <section className="anima-entrada rounded-card border border-borda bg-superficie shadow-card">
          <div className="border-b border-borda px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-tinta">Caminho até o disparo</h2>
              {carregandoPassos ? null : (
                <span className="numerico text-sm font-semibold text-tinta">
                  {feitos}/{passos.length}
                </span>
              )}
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-superficie-2" aria-hidden="true">
              <div
                className="h-full rounded-full bg-gradient-to-r from-acento to-realce transition-[width] duration-700"
                style={{ width: carregandoPassos ? '0%' : `${(feitos / passos.length) * 100}%` }}
              />
            </div>
          </div>

          <ol className="space-y-1 p-3">
            {passos.map(({ titulo, descricao, href, feito, Icone }, i) => (
              <li key={titulo}>
                <Link
                  href={href}
                  className="group flex items-start gap-3 rounded-xl p-2.5 transition-colors hover:bg-superficie-2/70"
                >
                  <span
                    className={cn(
                      'grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-all',
                      carregandoPassos
                        ? 'esqueleto border-transparent'
                        : feito
                          ? 'border-acento bg-acento text-acento-contraste'
                          : 'border-borda bg-superficie text-tinta-suave group-hover:border-acento',
                    )}
                  >
                    {carregandoPassos ? null : feito ? (
                      <IconeCheck className="h-4 w-4" />
                    ) : (
                      <Icone className="h-4 w-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block text-sm font-medium',
                        feito ? 'text-tinta-suave line-through decoration-acento decoration-2' : 'text-tinta',
                      )}
                    >
                      <span className="sr-only">Passo {i + 1}{feito ? ', concluído' : ''}: </span>
                      {titulo}
                    </span>
                    <span className="block text-xs text-tinta-suave">{descricao}</span>
                  </span>
                  <IconeSetaDireita className="mt-2 h-4 w-4 shrink-0 text-tinta-suave opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                </Link>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

function EstadoConexao({
  carregando,
  erro,
  conectado,
}: {
  carregando: boolean;
  erro: string | null;
  conectado: boolean;
}) {
  if (carregando) return <Esqueleto className="h-7 w-52 opacity-20" />;

  if (erro) {
    return (
      <p className="inline-flex items-center gap-2 rounded-full border border-lateral-borda bg-white/5 px-3 py-1 text-xs text-lateral-suave">
        <span className="h-2 w-2 rounded-full bg-lateral-suave" aria-hidden="true" />
        Não consegui conferir a conexão agora
      </p>
    );
  }

  return conectado ? (
    <p className="inline-flex items-center gap-2 rounded-full border border-acento/40 bg-acento/10 px-3 py-1 text-xs font-medium text-acento">
      <span className="ponto-vivo h-2 w-2 rounded-full bg-acento" aria-hidden="true" />
      WhatsApp conectado
    </p>
  ) : (
    <Link
      href="/whatsapp"
      className="inline-flex items-center gap-2 rounded-full border border-realce/50 bg-realce/10 px-3 py-1 text-xs font-medium text-realce hover:bg-realce/20"
    >
      <span className="h-2 w-2 rounded-full bg-realce" aria-hidden="true" />
      Número ainda não conectado — conectar agora
    </Link>
  );
}
