'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { JANELA_VAZIA, JanelaEnvio, janelaParaEnvio, problemaDosTetos, type Janela } from '@/components/app/janela-envio';
import { IconeMais } from '@/components/app/icones';
import { PublicoDaBase } from '@/components/app/publico-da-base';
import { useSessao } from '@/components/app/sessao';
import { SugestaoHorario } from '@/components/app/sugestao-horario';
import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { mensagemDoErro } from '@/lib/api';
import { explicacaoDaCategoria, nomeDaCategoria, tomDaCategoria } from '@/lib/categorias';
import { formatarData, formatarNumero } from '@/lib/formato';
import { campanhas, contatos, whatsapp } from '@/lib/servicos';
import type {
  ListaDeContatos,
  ModeloDeMensagem,
  PreviaDoPublico,
  PublicoDaCampanha,
  ResumoCampanha,
  VariavelDeLista,
} from '@/lib/tipos';

/** Números digitados: o mesmo teto do servidor. Público maior vem de uma lista. */
const TETO_DESTINATARIOS = 500;

const ROTULO_ORIGEM: Record<VariavelDeLista['origem'], string> = {
  nome: 'Nome do contato',
  primeiro_nome: 'Primeiro nome do contato',
  fixo: 'Texto igual para todos',
};

/**
 * Montagem e edição da campanha, no mesmo formulário.
 *
 * O modelo vem da lista real da Meta, e só os **aprovados** aparecem: oferecer
 * um modelo em análise seria oferecer um disparo que a Meta vai recusar, e o
 * cliente descobriria isso depois de montar a lista inteira.
 *
 * Na EDIÇÃO, o que aparece depende da situação da campanha. Em rascunho nada
 * saiu, então tudo pode mudar. Depois de disparada, modelo e público somem do
 * formulário: eles são o registro do que foi enviado, e deixar trocá-los faria
 * a tela mentir sobre a campanha que já está na rua.
 */
/**
 * A janela como a EDIÇÃO manda. Diferente da criação: desligar a janela
 * precisa ir explícito (vazio/nulo), senão o servidor entende "não mexer" e a
 * campanha continua presa ao horário antigo.
 */
function janelaDaEdicao(j: Janela) {
  if (!j.ativa) {
    return {
      janelaDias: [],
      janelaInicio: null,
      janelaFim: null,
      pausaSegundos: 0,
      maxPorDia: null,
      maxPorSemana: null,
      maxPorMes: null,
    };
  }
  const n = (v: string) => (v.trim() ? Number(v) : null);
  return {
    janelaDias: j.dias,
    janelaInicio: j.inicio && j.fim ? j.inicio : null,
    janelaFim: j.inicio && j.fim ? j.fim : null,
    pausaSegundos: n(j.pausa) ?? 0,
    maxPorDia: n(j.maxDia),
    maxPorSemana: n(j.maxSemana),
    maxPorMes: n(j.maxMes),
  };
}

/** Os blocos de uma divisão, como o seletor de lista agrupa. */
interface GrupoDeBlocos {
  divisaoId: string;
  nome: string;
  blocos: ListaDeContatos[];
}

function rotuloDoBloco(l: ListaDeContatos): string {
  const casas = Math.max(2, String(l.blocos ?? 0).length);
  const uso = l.usadaEm ? `já enviado em ${formatarData(l.usadaEm)}` : 'ainda não usado';
  return `Bloco ${String(l.bloco ?? 0).padStart(casas, '0')} · ${formatarNumero(l.total)} ${l.total === 1 ? 'contato' : 'contatos'} · ${uso}`;
}

export function FormularioCampanha({
  campanha,
  aoConcluir,
  aoCancelar,
  listaInicial,
}: {
  /** Presente = edição. Ausente = campanha nova. */
  campanha?: ResumoCampanha;
  aoConcluir: () => void;
  aoCancelar?: () => void;
  /** Lista (ou bloco) já escolhida — quando se chega por "Usar em campanha". */
  listaInicial?: string;
}) {
  const editando = Boolean(campanha);
  const podeTrocarConteudo = !editando || campanha?.status === 'rascunho';
  const [modelos, setModelos] = useState<ModeloDeMensagem[] | null>(null);
  const [erroModelos, setErroModelos] = useState('');
  const [nome, setNome] = useState(campanha?.nome ?? '');
  const [modeloId, setModeloId] = useState(campanha?.modeloId ?? '');
  const [telefones, setTelefones] = useState('');
  const [variaveis, setVariaveis] = useState<string[]>([]);
  const [listas, setListas] = useState<ListaDeContatos[] | null>(null);
  const [publico, setPublico] = useState<'lista' | 'base' | 'numeros'>('lista');
  const [listaId, setListaId] = useState('');
  /** "Da base": toda a base, uma importação, um perfil ou um público pronto. */
  const [daBase, setDaBase] = useState<PublicoDaCampanha | null>(null);
  /** Do público escolhido (lista ou da base): quantos podem receber, descanso e horário. */
  const [previa, setPrevia] = useState<PreviaDoPublico | null>(null);
  const [ignorarDescanso, setIgnorarDescanso] = useState(false);
  const { sessao } = useSessao();
  const ehDono = sessao.usuario.papel === 'dono';
  const [origens, setOrigens] = useState<VariavelDeLista['origem'][]>([]);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [janela, setJanela] = useState<Janela>(() => {
    if (!campanha) return JANELA_VAZIA;
    const texto = (v: number | null) => (v === null || v === 0 ? '' : String(v));
    const hhmm = (v: string | null) => (v ? v.slice(0, 5) : '');
    const ativa = Boolean(
      campanha.janelaDias.length ||
        campanha.janelaInicio ||
        campanha.pausaSegundos ||
        campanha.maxPorDia ||
        campanha.maxPorSemana ||
        campanha.maxPorMes,
    );
    return {
      ativa,
      dias: campanha.janelaDias,
      inicio: hhmm(campanha.janelaInicio),
      fim: hhmm(campanha.janelaFim),
      pausa: texto(campanha.pausaSegundos),
      maxDia: texto(campanha.maxPorDia),
      maxSemana: texto(campanha.maxPorSemana),
      maxMes: texto(campanha.maxPorMes),
    };
  });

  useEffect(() => {
    let vivo = true;
    contatos
      .listas()
      .then((l) => {
        if (!vivo) return;
        setListas(l);
        // Sem lista nenhuma, os contatos importados estão na base.
        if (l.length === 0) setPublico('base');
        // Chegou por "Usar em campanha" num bloco: já vem escolhido.
        else if (listaInicial && l.some((x) => x.id === listaInicial)) {
          setPublico('lista');
          setListaId(listaInicial);
        }
      })
      .catch(() => {
        if (vivo) {
          setListas([]);
          setPublico('numeros');
        }
      });
    return () => {
      vivo = false;
    };
  }, [listaInicial]);

  // Listas comuns primeiro; depois cada divisão, com os blocos em ordem.
  const listasComuns = (listas ?? []).filter((l) => !l.divisaoId);
  const grupos: GrupoDeBlocos[] = [];
  for (const l of listas ?? []) {
    if (!l.divisaoId) continue;
    let g = grupos.find((x) => x.divisaoId === l.divisaoId);
    if (!g) {
      g = { divisaoId: l.divisaoId, nome: l.divisaoNome ?? 'Blocos', blocos: [] };
      grupos.push(g);
    }
    g.blocos.push(l);
  }
  for (const g of grupos) g.blocos.sort((a, b) => (a.bloco ?? 0) - (b.bloco ?? 0));
  const escolhida = (listas ?? []).find((l) => l.id === listaId) ?? null;
  // O próximo bloco ainda não enviado: da divisão do bloco escolhido, ou da divisão mais recente.
  const grupoDoProximo = escolhida?.divisaoId ? grupos.find((g) => g.divisaoId === escolhida.divisaoId) : grupos[0];
  const proximoBloco = grupoDoProximo?.blocos.find((b) => !b.usadaEm && b.total > 0 && b.id !== listaId) ?? null;

  // O público escolhido — uma lista, ou um público da base — e a prévia dele:
  // quantos podem receber (quem pediu para sair não conta), quantos estão em
  // descanso e em que período pedem. Uma ida ao servidor, com a mesma regra
  // da montagem.
  const alvo: PublicoDaCampanha | null =
    publico === 'lista' && listaId ? { origem: 'lista', origemId: listaId } : publico === 'base' ? daBase : null;
  const chaveDoAlvo = alvo ? JSON.stringify(alvo) : '';
  useEffect(() => {
    setPrevia(null);
    if (!chaveDoAlvo) return;
    let vivo = true;
    campanhas
      .previa(JSON.parse(chaveDoAlvo) as PublicoDaCampanha)
      .then((r) => vivo && setPrevia(r))
      .catch(() => vivo && setPrevia(null));
    return () => {
      vivo = false;
    };
  }, [chaveDoAlvo]);
  const alcance = previa ? previa.total : null;

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const todos = await whatsapp.modelos();
        if (!vivo) return;
        setModelos(todos.filter((m) => m.status === 'aprovado'));
      } catch (e) {
        if (!vivo) return;
        setErroModelos(mensagemDoErro(e));
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const escolhido = modelos?.find((m) => m.id === modeloId) ?? null;
  const ehMarketing = (escolhido?.categoria ?? '').toLowerCase() === 'marketing';

  // Descanso: vale para campanha NOVA de marketing. A prévia usa a mesma regra
  // do envio, que confere de novo na hora de mandar.
  const descanso = !editando && ehMarketing && previa ? previa.descanso : null;

  const numeros = telefones
    .split(/[\s,;]+/)
    .map((t) => t.replace(/\D/g, ''))
    .filter((t) => t.length > 0);

  async function enviar() {
    setErro('');
    if (!escolhido && podeTrocarConteudo) {
      setErro('Escolha um modelo aprovado.');
      return;
    }

    const problemaJanelaEdicao = janela.ativa ? problemaDosTetos(janela) : null;
    if (editando && !podeTrocarConteudo) {
      // Campanha que já saiu: só nome, janela, ritmo e limites.
      if (problemaJanelaEdicao) {
        setErro(problemaJanelaEdicao);
        return;
      }
      setSalvando(true);
      try {
        await campanhas.editar(campanha!.id, { nome: nome.trim(), ...janelaDaEdicao(janela) });
        aoConcluir();
      } catch (e) {
        setErro(mensagemDoErro(e));
      } finally {
        setSalvando(false);
      }
      return;
    }
    const nVars = escolhido!.variaveis;
    if (publico === 'lista') {
      if (!listaId) {
        setErro('Escolha a lista de contatos que vai receber.');
        return;
      }
      if (alcance === 0) {
        setErro('Essa lista não tem ninguém que possa receber: está vazia ou todos pediram para sair.');
        return;
      }
    } else if (publico === 'base') {
      if (!daBase) {
        setErro('Escolha de onde sai o público: toda a base, uma importação, um perfil ou um público pronto.');
        return;
      }
      if (alcance === 0) {
        setErro('Esse público não tem ninguém que possa receber agora.');
        return;
      }
    } else {
      if (numeros.length === 0) {
        setErro('Informe ao menos um número.');
        return;
      }
      if (numeros.length > TETO_DESTINATARIOS) {
        setErro(
          `Digitando, cada campanha aceita até ${TETO_DESTINATARIOS} números. Para mais, importe em Contatos e escolha a lista.`,
        );
        return;
      }
    }
    for (let i = 0; i < nVars; i++) {
      if (!(variaveis[i] ?? '').trim()) {
        setErro(
          publico !== 'numeros' && (origens[i] ?? 'fixo') !== 'fixo'
            ? `Preencha o que usar em {{${i + 1}}} quando o contato não tiver nome.`
            : `Preencha o valor de {{${i + 1}}}.`,
        );
        return;
      }
    }

    const problemaJanela = janela.ativa ? problemaDosTetos(janela) : null;
    if (problemaJanela) {
      setErro(problemaJanela);
      return;
    }

    setSalvando(true);
    try {
      const corpo = {
        ...janelaParaEnvio(janela),
        nome: nome.trim(),
        modeloNome: escolhido!.nome,
        modeloIdioma: escolhido!.idioma,
        modeloId: escolhido!.id,
        modeloCategoria: escolhido!.categoria,
        ...(!editando && ehDono && ignorarDescanso ? { ignorarDescanso: true } : {}),
        ...(publico !== 'numeros'
          ? {
              ...(publico === 'lista' ? { listaId } : { daBase: daBase! }),
              variaveisLista: Array.from({ length: nVars }, (_, i) => ({
                origem: origens[i] ?? 'fixo',
                valor: (variaveis[i] ?? '').trim(),
              })),
            }
          : {
              destinatarios: numeros.map((telefone) => ({
                telefone,
                variaveis: variaveis.slice(0, nVars).map((v) => v.trim()),
              })),
            }),
      };

      if (editando) {
        await campanhas.editar(campanha!.id, { ...corpo, ...janelaDaEdicao(janela) });
        aoConcluir();
        return;
      }

      const { id } = await campanhas.criar(corpo);
      aoConcluir();
      // Leva direto para a campanha: é lá que se dispara e se acompanha.
      window.location.href = `/campanhas/${id}`;
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  if (erroModelos) {
    return (
      <Card>
        <Alerta tom="erro">{erroModelos}</Alerta>
      </Card>
    );
  }

  if (!modelos) {
    return (
      <Card>
        <div className="flex items-center gap-3 text-sm text-tinta-suave">
          <Spinner /> Carregando seus modelos…
        </div>
      </Card>
    );
  }

  if (modelos.length === 0) {
    return (
      <Card>
        <EmptyState
          titulo="Nenhum modelo aprovado"
          descricao="Só modelo aprovado pela Meta pode iniciar conversa. Assim que o primeiro for aprovado, ele aparece aqui."
          acao={<Link href="/modelos" className="text-sm text-acento-forte underline">Ver meus modelos</Link>}
        />
      </Card>
    );
  }

  return (
    <Card className="anima-entrada border-acento/50 shadow-flutuante">
      <div className="space-y-5">
        <div className="flex items-center gap-3 border-b border-borda pb-4">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-acento text-acento-contraste">
            <IconeMais className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-tinta">
              {editando ? 'Editar campanha' : 'Montar campanha'}
            </h2>
            <p className="text-xs text-tinta-suave">
              {editando && !podeTrocarConteudo
                ? 'Esta campanha já foi disparada: dá para ajustar o nome, a janela, o ritmo e os limites.'
                : 'Modelo, público e janela de envio. Nada sai antes de você disparar.'}
            </p>
          </div>
        </div>

        {erro && <Alerta tom="erro">{erro}</Alerta>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="nome-campanha">Nome da campanha</Label>
            <Input
              id="nome-campanha"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Promoção de sexta"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="modelo-campanha">Modelo</Label>
            <Select
              id="modelo-campanha"
              value={modeloId}
              onChange={(e) => {
                setModeloId(e.target.value);
                setVariaveis([]);
                setOrigens([]);
              }}
            >
              <option value="">Escolha…</option>
              {modelos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome} — {nomeDaCategoria(m.categoria) ?? 'sem categoria'}
                </option>
              ))}
            </Select>
            {escolhido && nomeDaCategoria(escolhido.categoria) && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs leading-relaxed text-tinta-suave">
                <Badge tom={tomDaCategoria(escolhido.categoria)}>{nomeDaCategoria(escolhido.categoria)}</Badge>
                <span>{explicacaoDaCategoria(escolhido.categoria)}</span>
              </p>
            )}
          </div>
        </div>

        {escolhido && (
          <div className="space-y-3 rounded-card border border-borda bg-superficie-2 p-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-tinta">
              {escolhido.corpo}
            </p>

            {escolhido.variaveis > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {Array.from({ length: escolhido.variaveis }, (_, i) => {
                  const origem = publico !== 'numeros' ? (origens[i] ?? 'fixo') : 'fixo';
                  return (
                    <div key={i} className="space-y-1.5 rounded-lg border border-borda bg-superficie p-2.5">
                      <Label htmlFor={`var-${i}`}>{`Variável {{${i + 1}}}`}</Label>
                      {publico !== 'numeros' ? (
                        <Select
                          aria-label={`De onde vem {{${i + 1}}}`}
                          value={origem}
                          onChange={(e) => {
                            const novo = [...origens];
                            novo[i] = e.target.value as VariavelDeLista['origem'];
                            setOrigens(novo);
                          }}
                        >
                          {(Object.keys(ROTULO_ORIGEM) as VariavelDeLista['origem'][]).map((o) => (
                            <option key={o} value={o}>
                              {ROTULO_ORIGEM[o]}
                            </option>
                          ))}
                        </Select>
                      ) : null}
                      <Input
                        id={`var-${i}`}
                        value={variaveis[i] ?? ''}
                        placeholder={origem === 'fixo' ? 'Texto' : 'Se não tiver nome, ex.: cliente'}
                        onChange={(e) => {
                          const novo = [...variaveis];
                          novo[i] = e.target.value;
                          setVariaveis(novo);
                        }}
                      />
                      {origem !== 'fixo' ? (
                        <p className="text-xs text-tinta-suave">Usado quando o contato não tem nome cadastrado.</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-tinta">Quem recebe</legend>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Origem do público">
            {(['lista', 'base', 'numeros'] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={publico === p}
                disabled={p === 'lista' && listas !== null && listas.length === 0}
                onClick={() => setPublico(p)}
                className={
                  'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ' +
                  (publico === p
                    ? 'border-transparent bg-acento text-acento-contraste'
                    : 'border-borda bg-superficie text-tinta-suave hover:border-acento')
                }
              >
                {p === 'lista' ? 'Uma lista de contatos' : p === 'base' ? 'Da base' : 'Digitar números'}
              </button>
            ))}
          </div>

          {publico === 'lista' && (
            <div className="space-y-1">
              <Label htmlFor="lista-campanha">Lista</Label>
              <Select id="lista-campanha" value={listaId} onChange={(e) => setListaId(e.target.value)}>
                <option value="">{listas === null ? 'Carregando listas…' : 'Escolha…'}</option>
                {listasComuns.length > 0 && (
                  <optgroup label="Listas">
                    {listasComuns.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.nome} · {formatarNumero(l.total)} {l.total === 1 ? 'contato' : 'contatos'}
                      </option>
                    ))}
                  </optgroup>
                )}
                {grupos.map((g) => (
                  <optgroup key={g.divisaoId} label={`Blocos — ${g.nome}`}>
                    {g.blocos.map((l) => (
                      <option key={l.id} value={l.id}>
                        {rotuloDoBloco(l)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              {escolhida?.divisaoId && escolhida.usadaEm && (
                <p className="rounded-md bg-atencao/10 px-2 py-1 text-xs text-tinta">
                  Este bloco já foi enviado em {formatarData(escolhida.usadaEm)} — mandar de novo repete as mesmas
                  pessoas.
                </p>
              )}
              {proximoBloco && (
                <button
                  type="button"
                  onClick={() => setListaId(proximoBloco.id)}
                  className="text-xs font-medium text-acento-forte underline underline-offset-4"
                >
                  Usar o próximo bloco ainda não enviado ({rotuloDoBloco(proximoBloco).split(' · ')[0]} de{' '}
                  {proximoBloco.blocos})
                </button>
              )}
              <p className="text-xs text-tinta-suave">
                {listaId && alcance !== null ? (
                  <>
                    <strong className="numerico text-tinta">{formatarNumero(alcance)}</strong>{' '}
                    {alcance === 1 ? 'pessoa vai receber' : 'pessoas vão receber'}. Quem pediu para sair fica de fora
                    automaticamente.
                  </>
                ) : (
                  <>
                    Os contatos importados sem lista (planilhas, Cardápio Web) estão em{' '}
                    <button
                      type="button"
                      onClick={() => setPublico('base')}
                      className="font-medium text-acento-forte underline underline-offset-4"
                    >
                      Da base
                    </button>
                    . As listas nascem em{' '}
                    <Link href="/contatos" className="text-acento-forte underline">
                      Contatos
                    </Link>
                    .
                  </>
                )}
              </p>
            </div>
          )}

          {publico === 'base' && (
            <div className="space-y-2">
              <PublicoDaBase valor={daBase} aoMudar={setDaBase} />
              <p className="text-xs text-tinta-suave">
                {daBase && alcance !== null ? (
                  <>
                    <strong className="numerico text-tinta">{formatarNumero(alcance)}</strong>{' '}
                    {alcance === 1 ? 'pessoa vai receber' : 'pessoas vão receber'}. O público é copiado ao montar a
                    campanha: quem entrar na base depois não recebe esta.
                  </>
                ) : (
                  'Toda a base, uma importação (os contatos importados sem lista estão aqui), um perfil ou um público pronto. Quem pediu para sair fica de fora automaticamente.'
                )}
              </p>
            </div>
          )}

          {publico !== 'numeros' && descanso && descanso.dias > 0 && descanso.emDescanso > 0 && (
            <div className="space-y-2 rounded-lg border border-borda bg-superficie-2 p-3 text-xs leading-relaxed text-tinta">
              <p>
                <strong className="numerico">{formatarNumero(descanso.emDescanso)}</strong>{' '}
                {descanso.emDescanso === 1 ? 'pessoa deste público recebeu' : 'pessoas deste público receberam'}{' '}
                campanha de marketing nos últimos {descanso.dias} {descanso.dias === 1 ? 'dia' : 'dias'} e{' '}
                {descanso.emDescanso === 1 ? 'fica' : 'ficam'} de fora — é o descanso entre campanhas. Não conta no
                plano. O prazo se ajusta em Conta.
              </p>
              {ehDono && (
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={ignorarDescanso}
                    onChange={(e) => setIgnorarDescanso(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <span>
                    Enviar mesmo para quem está em descanso (só nesta campanha). Mensagem demais faz a Meta segurar o
                    marketing dessa pessoa e derruba a qualidade do número.
                  </span>
                </label>
              )}
            </div>
          )}

          {publico !== 'numeros' && !editando && alvo && (
            <SugestaoHorario
              dados={previa?.horario ?? null}
              janelaAtual={janela}
              aoUsar={(inicio, fim) => setJanela((j) => ({ ...j, ativa: true, inicio, fim }))}
            />
          )}

          {publico === 'numeros' && (
            <div className="space-y-1">
              <Label htmlFor="numeros">Números</Label>
              <textarea
                id="numeros"
                value={telefones}
                onChange={(e) => setTelefones(e.target.value)}
                rows={3}
                placeholder="5521999998888, 5511988887777"
                className="w-full rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-tinta"
              />
              <p className="text-xs text-tinta-suave">
                País + DDD + número, separados por vírgula ou quebra de linha. Reconhecidos até agora:{' '}
                <strong className="numerico">{numeros.length}</strong> de {TETO_DESTINATARIOS}.
              </p>
            </div>
          )}
        </fieldset>

        <JanelaEnvio valor={janela} aoMudar={setJanela} />

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void enviar()} carregando={salvando}>
            {editando ? 'Salvar alterações' : 'Montar campanha'}
          </Button>
          {aoCancelar ? (
            <Button variante="discreto" onClick={aoCancelar}>
              Cancelar
            </Button>
          ) : null}
        </div>
        {editando ? null : (
          <p className="text-xs text-tinta-suave">
            Montar não envia nada. Você confere a campanha e dispara na tela seguinte.
          </p>
        )}
      </div>
    </Card>
  );
}
