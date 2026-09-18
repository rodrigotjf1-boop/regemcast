'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { JANELA_VAZIA, JanelaEnvio, janelaParaEnvio, problemaDosTetos, type Janela } from '@/components/app/janela-envio';
import { IconeMais } from '@/components/app/icones';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { mensagemDoErro } from '@/lib/api';
import { formatarNumero } from '@/lib/formato';
import { campanhas, contatos, whatsapp } from '@/lib/servicos';
import type {
  ListaDeContatos,
  ModeloDeMensagem,
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
export function FormularioCampanha({
  campanha,
  aoConcluir,
  aoCancelar,
}: {
  /** Presente = edição. Ausente = campanha nova. */
  campanha?: ResumoCampanha;
  aoConcluir: () => void;
  aoCancelar?: () => void;
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
  const [publico, setPublico] = useState<'lista' | 'numeros'>('lista');
  const [listaId, setListaId] = useState('');
  const [alcance, setAlcance] = useState<number | null>(null);
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
        // Sem lista nenhuma, o caminho que resta é digitar.
        if (l.length === 0) setPublico('numeros');
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
  }, []);

  // Quantos da lista escolhida podem receber: quem pediu para sair não conta.
  useEffect(() => {
    if (!listaId) {
      setAlcance(null);
      return;
    }
    let vivo = true;
    setAlcance(null);
    contatos
      .publicoDaLista(listaId)
      .then((r) => vivo && setAlcance(r.total))
      .catch(() => vivo && setAlcance(null));
    return () => {
      vivo = false;
    };
  }, [listaId]);

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
        await campanhas.editar(campanha!.id, { nome: nome.trim(), ...janelaParaEnvio(janela) });
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
          publico === 'lista' && (origens[i] ?? 'fixo') !== 'fixo'
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
        ...(publico === 'lista'
          ? {
              listaId,
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
        await campanhas.editar(campanha!.id, corpo);
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
                  {m.nome} · {m.categoria}
                </option>
              ))}
            </Select>
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
                  const origem = publico === 'lista' ? (origens[i] ?? 'fixo') : 'fixo';
                  return (
                    <div key={i} className="space-y-1.5 rounded-lg border border-borda bg-superficie p-2.5">
                      <Label htmlFor={`var-${i}`}>{`Variável {{${i + 1}}}`}</Label>
                      {publico === 'lista' ? (
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
            {(['lista', 'numeros'] as const).map((p) => (
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
                {p === 'lista' ? 'Uma lista de contatos' : 'Digitar números'}
              </button>
            ))}
          </div>

          {publico === 'lista' ? (
            <div className="space-y-1">
              <Label htmlFor="lista-campanha">Lista</Label>
              <Select id="lista-campanha" value={listaId} onChange={(e) => setListaId(e.target.value)}>
                <option value="">{listas === null ? 'Carregando listas…' : 'Escolha…'}</option>
                {(listas ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nome} · {formatarNumero(l.total)} {l.total === 1 ? 'contato' : 'contatos'}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-tinta-suave">
                {listaId && alcance !== null ? (
                  <>
                    <strong className="numerico text-tinta">{formatarNumero(alcance)}</strong>{' '}
                    {alcance === 1 ? 'pessoa vai receber' : 'pessoas vão receber'}. Quem pediu para sair fica de fora
                    automaticamente.
                  </>
                ) : (
                  <>
                    As listas nascem na importação em{' '}
                    <Link href="/contatos" className="text-acento-forte underline">
                      Contatos
                    </Link>
                    .
                  </>
                )}
              </p>
            </div>
          ) : (
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
