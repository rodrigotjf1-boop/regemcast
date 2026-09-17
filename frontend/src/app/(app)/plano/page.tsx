'use client';

import { useCallback, useEffect, useState } from 'react';

import { EVENTO_PLANO_ALTERADO } from '@/components/app/casca';
import { IconeCartao, IconeCheck, IconeRaio } from '@/components/app/icones';
import { useSessao } from '@/components/app/sessao';
import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CabecalhoPagina } from '@/components/ui/cabecalho-pagina';
import { EsqueletoLista } from '@/components/ui/esqueleto';
import { EstadoErro } from '@/components/ui/estado-erro';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatarData, formatarNumero, percentual } from '@/lib/formato';
import { planoConta } from '@/lib/servicos';
import type { PlanoOferta, SituacaoCobranca } from '@/lib/tipos';

const reais = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const STATUS_COBRANCA: Record<string, { rotulo: string; tom: 'sucesso' | 'atencao' | 'erro' | 'neutro' }> = {
  aprovada: { rotulo: 'Paga', tom: 'sucesso' },
  pendente: { rotulo: 'Pendente', tom: 'atencao' },
  recusada: { rotulo: 'Recusada', tom: 'erro' },
  cancelada: { rotulo: 'Cancelada', tom: 'neutro' },
  estornada: { rotulo: 'Estornada', tom: 'neutro' },
};

/**
 * Plano e pagamento.
 *
 * A tela responde, nesta ordem: qual é a situação (grátis, pago, atrasado),
 * QUANDO os disparos param se nada for feito, e o que fazer. Contratar leva ao
 * checkout do Mercado Pago; trocar de plano de quem já paga acontece aqui mesmo.
 *
 * Só o dono contrata e cancela — operadores veem a situação.
 */
export default function PaginaPlano() {
  const { sessao } = useSessao();
  const ehDono = sessao.usuario.papel === 'dono';

  const [s, setS] = useState<SituacaoCobranca | null>(null);
  const [erro, setErro] = useState('');
  const [acaoErro, setAcaoErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [emailPagador, setEmailPagador] = useState('');
  const [outroEmail, setOutroEmail] = useState(false);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  const [voltouDoCheckout, setVoltouDoCheckout] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setS(await planoConta.situacao());
      setErro('');
    } catch (e) {
      setErro(mensagemDoErro(e));
    }
  }, []);

  useEffect(() => {
    void carregar();
    // O Mercado Pago volta com "?preapproval_id=…" (em links antigos, grudado num
    // "?retorno=mercadopago"). Qualquer um dos dois indica a volta do checkout.
    const busca = window.location.search;
    if (busca.includes('preapproval_id') || busca.includes('retorno=mercadopago')) setVoltouDoCheckout(true);
  }, [carregar]);

  // Voltou do Mercado Pago: a confirmação chega por aviso, segundos depois.
  // A tela confere sozinha por um minuto em vez de pedir para recarregar.
  useEffect(() => {
    if (!voltouDoCheckout || s?.mpStatus === 'authorized') return;
    let voltas = 0;
    const t = setInterval(() => {
      voltas += 1;
      if (voltas > 12) clearInterval(t);
      void carregar();
    }, 5000);
    return () => clearInterval(t);
  }, [voltouDoCheckout, s?.mpStatus, carregar]);

  async function contratar(p: PlanoOferta) {
    setAcaoErro('');
    setAviso('');
    setOcupado(p.id);
    try {
      const r = await planoConta.contratar(p.id, outroEmail ? emailPagador.trim() : undefined);
      if (r.modo === 'checkout') {
        window.location.href = r.checkoutUrl;
        return;
      }
      setAviso(
        r.modo === 'trocado'
          ? `Pronto: você está no plano ${r.plano}. Os disparos a mais já valem neste ciclo.`
          : r.modo === 'agendado'
            ? `Combinado: o plano ${r.plano} começa na virada do ciclo, em ${formatarData(r.vigenteEm)}.`
            : `Redução desfeita: você continua no plano ${r.plano}.`,
      );
      await carregar();
      window.dispatchEvent(new Event(EVENTO_PLANO_ALTERADO));
    } catch (e) {
      setAcaoErro(mensagemDoErro(e));
    } finally {
      setOcupado(null);
    }
  }

  async function cancelar() {
    setAcaoErro('');
    setOcupado('cancelar');
    try {
      const r = await planoConta.cancelar();
      setConfirmarCancelar(false);
      setAviso(
        r.vigenteAte
          ? `Renovação cancelada. Seu plano continua valendo até ${formatarData(r.vigenteAte)}.`
          : 'Contratação cancelada.',
      );
      await carregar();
      window.dispatchEvent(new Event(EVENTO_PLANO_ALTERADO));
    } catch (e) {
      setAcaoErro(mensagemDoErro(e));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="space-y-6 lg:space-y-8">
      <CabecalhoPagina
        icone={<IconeCartao />}
        sobretitulo="Configuração"
        titulo="Plano e pagamento"
        descricao="Quantos disparos por mês a sua conta tem, quanto custa e o histórico de pagamentos."
      />

      {erro && !s ? (
        <EstadoErro titulo="Não consegui ler o seu plano" mensagem={erro} aoTentarDeNovo={() => void carregar()} />
      ) : !s ? (
        <EsqueletoLista linhas={3} />
      ) : (
        <>
          {voltouDoCheckout && s.mpStatus !== 'authorized' ? (
            <Alerta tom="informacao">
              Recebemos você de volta do Mercado Pago. A confirmação do pagamento costuma chegar em
              instantes — esta tela se atualiza sozinha.
            </Alerta>
          ) : null}

          <SituacaoAtual s={s} />

          {aviso ? <Alerta tom="sucesso">{aviso}</Alerta> : null}
          {acaoErro ? <Alerta tom="erro">{acaoErro}</Alerta> : null}

          {s.checkoutPendente && s.mpStatus !== 'authorized' ? (
            <div className="anima-entrada flex flex-wrap items-center justify-between gap-3 rounded-card border border-realce bg-realce/20 p-4">
              <p className="text-sm text-tinta">
                Você começou a contratar o plano <strong>{s.checkoutPendente.plano?.nome ?? ''}</strong> e o
                pagamento ainda não foi concluído.
              </p>
              <a href={s.checkoutPendente.url}>
                <Button tamanho="sm">Concluir pagamento</Button>
              </a>
            </div>
          ) : null}

          {/* Uso do ciclo */}
          <section className="anima-entrada rounded-card border border-borda bg-superficie p-5 shadow-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-tinta">
                {s.planoAtual ? `Plano ${s.planoAtual.nome}` : 'Sem plano'}
              </h2>
              <p className="text-sm text-tinta-suave">
                Ciclo de {formatarData(s.cicloInicio)} a {formatarData(s.cicloFim)}
              </p>
            </div>
            {s.uso.teto !== null ? (
              <>
                <p className="mt-3 text-sm text-tinta-suave">
                  <span className="numerico text-2xl font-semibold text-tinta">{formatarNumero(s.uso.disparos)}</span> de{' '}
                  <span className="numerico">{formatarNumero(s.uso.teto)}</span> disparos usados
                </p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-superficie-2" aria-hidden="true">
                  <div
                    className={cn(
                      'anima-preencher h-full rounded-full',
                      percentual(s.uso.disparos, s.uso.teto) >= 100
                        ? 'bg-erro'
                        : percentual(s.uso.disparos, s.uso.teto) >= 80
                          ? 'bg-realce'
                          : 'bg-acento',
                    )}
                    style={{ width: `${Math.max(2, percentual(s.uso.disparos, s.uso.teto))}%` }}
                  />
                </div>
              </>
            ) : null}
            {s.planoProximoCiclo ? (
              <p className="mt-3 text-sm text-tinta-suave">
                A partir de {formatarData(s.cicloFim)}: plano <strong className="text-tinta">{s.planoProximoCiclo.nome}</strong>.
              </p>
            ) : null}
          </section>

          {/* Planos */}
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-tinta">Planos</h2>
            {!s.cobrancaDisponivel ? (
              <Alerta tom="informacao">
                A contratação pelo Mercado Pago ainda não está disponível. Fale com o suporte do RegemCast.
              </Alerta>
            ) : null}
            {!ehDono ? (
              <p className="text-sm text-tinta-suave">Só o dono da conta pode contratar ou trocar de plano.</p>
            ) : null}

            <ul className="escalonado grid grid-cols-1 gap-4 md:grid-cols-3">
              {s.planos.map((p) => {
                const pago = s.mpStatus === 'authorized';
                const atual = pago && s.planoAtual?.id === p.id;
                const agendado = s.planoProximoCiclo?.id === p.id;
                const maior = !s.planoAtual || p.precoCentavos >= s.planoAtual.precoCentavos;
                const rotulo = atual
                  ? s.planoProximoCiclo
                    ? 'Continuar neste plano'
                    : 'Seu plano'
                  : agendado
                    ? 'Começa no próximo ciclo'
                    : pago
                      ? maior
                        ? 'Mudar para este'
                        : 'Reduzir no próximo ciclo'
                      : 'Contratar';
                const desabilitado =
                  !ehDono || !s.cobrancaDisponivel || ocupado !== null || (atual && !s.planoProximoCiclo) || agendado;

                return (
                  <li
                    key={p.id}
                    className={cn(
                      'cartao-interativo flex flex-col gap-4 rounded-card border bg-superficie p-5 shadow-card',
                      atual ? 'border-acento shadow-brilho' : 'border-borda',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-lg font-semibold text-tinta">{p.nome}</p>
                      {atual ? <Badge tom="sucesso" ponto>Atual</Badge> : null}
                    </div>
                    <p className="flex items-baseline gap-1">
                      <span className="numerico text-3xl font-semibold text-tinta">{reais(p.precoCentavos)}</span>
                      <span className="text-sm text-tinta-suave">/mês</span>
                    </p>
                    <p className="flex items-center gap-2 text-sm text-tinta">
                      <IconeRaio className="h-4 w-4 text-tinta-suave" />
                      <span className="numerico font-semibold">{formatarNumero(p.disparosMes)}</span> disparos por mês
                    </p>
                    <p className="text-xs text-tinta-suave">
                      {reais(Math.round((p.precoCentavos / p.disparosMes) * 1000))} a cada mil disparos
                    </p>
                    <Button
                      className="mt-auto"
                      variante={atual ? 'secundario' : 'primario'}
                      disabled={desabilitado}
                      carregando={ocupado === p.id}
                      onClick={() => void contratar(p)}
                    >
                      {atual && !s.planoProximoCiclo ? <IconeCheck /> : null}
                      {rotulo}
                    </Button>
                  </li>
                );
              })}
            </ul>

            {ehDono && s.cobrancaDisponivel && s.mpStatus !== 'authorized' ? (
              <div className="space-y-2 text-sm">
                <label className="inline-flex items-center gap-2 text-tinta-suave">
                  <input
                    type="checkbox"
                    checked={outroEmail}
                    onChange={(e) => setOutroEmail(e.target.checked)}
                    className="h-4 w-4 accent-[rgb(var(--cor-acento))]"
                  />
                  Vou pagar com uma conta do Mercado Pago de outro e-mail
                </label>
                {outroEmail ? (
                  <div className="max-w-sm space-y-1.5">
                    <Label htmlFor="email-pagador">E-mail da conta do Mercado Pago</Label>
                    <Input
                      id="email-pagador"
                      type="email"
                      value={emailPagador}
                      onChange={(e) => setEmailPagador(e.target.value)}
                      placeholder="financeiro@suaempresa.com.br"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            <p className="text-xs text-tinta-suave">
              O pagamento é feito pelo Mercado Pago e renova todo mês. A cobrança das mensagens enviadas pelo WhatsApp é
              da Meta, na conta da sua empresa, e é separada do plano.
            </p>
          </section>

          {/* Histórico */}
          <section className="anima-entrada overflow-hidden rounded-card border border-borda bg-superficie shadow-card">
            <div className="border-b border-borda px-5 py-4">
              <h2 className="text-base font-semibold text-tinta">Pagamentos</h2>
            </div>
            {s.cobrancas.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-tinta-suave">Nenhum pagamento ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <caption className="sr-only">Histórico de pagamentos do plano</caption>
                  <thead>
                    <tr className="bg-superficie-2/60 text-xs uppercase tracking-wide text-tinta-suave">
                      <th scope="col" className="px-5 py-2.5 font-medium">Data</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Plano</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">Valor</th>
                      <th scope="col" className="px-5 py-2.5 font-medium">Situação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-borda">
                    {s.cobrancas.map((c) => {
                      const st = STATUS_COBRANCA[c.status] ?? { rotulo: c.status, tom: 'neutro' as const };
                      return (
                        <tr key={c.id} className="align-top">
                          <td className="whitespace-nowrap px-5 py-3 text-tinta">
                            {formatarData(c.pagoEm ?? c.vencimento ?? c.criadoEm)}
                          </td>
                          <td className="px-3 py-3 text-tinta-suave">{c.plano ?? '—'}</td>
                          <td className="numerico px-3 py-3 text-right text-tinta">{reais(c.valorCentavos)}</td>
                          <td className="px-5 py-3">
                            <Badge tom={st.tom} ponto>
                              {st.rotulo}
                            </Badge>
                            {c.motivo ? <p className="mt-1 text-xs text-erro">{c.motivo}</p> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {ehDono && (s.mpStatus === 'authorized' || s.mpStatus === 'pending') ? (
            <section className="rounded-card border border-borda bg-superficie p-5 shadow-card">
              {!confirmarCancelar ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-tinta-suave">
                    {s.mpStatus === 'authorized'
                      ? 'Cancelar a renovação: o plano continua até o fim do ciclo pago.'
                      : 'Desistir da contratação iniciada.'}
                  </p>
                  <Button variante="perigo" tamanho="sm" onClick={() => setConfirmarCancelar(true)}>
                    {s.mpStatus === 'authorized' ? 'Cancelar renovação' : 'Cancelar contratação'}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-tinta">
                    {s.mpStatus === 'authorized'
                      ? `Os disparos param em ${formatarData(s.cicloFim)}, quando o ciclo pago acabar. Contatos, modelos e histórico continuam na conta.`
                      : 'O link de pagamento deixa de valer.'}
                  </p>
                  <div className="flex gap-2">
                    <Button variante="perigo" carregando={ocupado === 'cancelar'} onClick={() => void cancelar()}>
                      Confirmar cancelamento
                    </Button>
                    <Button variante="discreto" onClick={() => setConfirmarCancelar(false)}>
                      Voltar
                    </Button>
                  </div>
                </div>
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function SituacaoAtual({ s }: { s: SituacaoCobranca }) {
  if (s.bloqueado) {
    return (
      <Alerta tom="erro">
        {s.status === 'cancelada'
          ? 'Sua assinatura terminou e os disparos estão parados. Escolha um plano abaixo para voltar a enviar.'
          : 'Os disparos estão parados por falta de pagamento. Contrate ou regularize o plano abaixo — as campanhas voltam sozinhas quando o pagamento for confirmado.'}
      </Alerta>
    );
  }

  if (s.status === 'cortesia') {
    const perto = s.gratisAte && new Date(s.gratisAte).getTime() - Date.now() < 7 * 86_400_000;
    return (
      <Alerta tom={perto ? 'atencao' : 'informacao'}>
        Primeiro mês grátis até <strong>{formatarData(s.gratisAte)}</strong>. Escolha um plano antes de{' '}
        <strong>{formatarData(s.disparosParamEm)}</strong> para os disparos não pararem.
      </Alerta>
    );
  }

  if (s.status === 'inadimplente') {
    return (
      <Alerta tom="atencao">
        O último pagamento não foi aprovado. Os disparos param em <strong>{formatarData(s.disparosParamEm)}</strong> se ele
        não for regularizado — confira o meio de pagamento no Mercado Pago.
      </Alerta>
    );
  }

  if (s.status === 'ativa' && (s.mpStatus === 'cancelled' || s.mpStatus === 'paused')) {
    return (
      <Alerta tom="atencao">
        Renovação cancelada. Seu plano vale até <strong>{formatarData(s.cicloFim)}</strong>.
      </Alerta>
    );
  }

  if (s.status === 'ativa') {
    return (
      <Alerta tom="sucesso">
        Plano {s.planoAtual?.nome} ativo e em dia. Renova em <strong>{formatarData(s.cicloFim)}</strong>.
      </Alerta>
    );
  }

  return null;
}
