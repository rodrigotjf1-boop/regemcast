'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { IconeCampanha } from '@/components/app/icones';
import { dinheiroNaMoeda } from '@/components/app/teto-do-disparo';
import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CabecalhoPagina } from '@/components/ui/cabecalho-pagina';
import { Card, CardCabecalho, CardCorpo } from '@/components/ui/card';
import { Dialogo } from '@/components/ui/dialogo';
import { EsqueletoLista } from '@/components/ui/esqueleto';
import { EstadoErro } from '@/components/ui/estado-erro';
import { AjudaCampo, AreaDeTexto, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { nomeDoAplicativo } from '@/lib/aplicativo';
import { nomeDaCategoria } from '@/lib/categorias';
import { formatarDataHora, formatarNumero } from '@/lib/formato';
import { centavosDoTexto, codigoDoPlano, mensagemDoPlano } from '@/lib/mensagem-do-plano';
import { aprovacoes } from '@/lib/servicos';
import type { PedidoAberto, RespostaDaAprovacao } from '@/lib/tipos';
import { useCarga } from '@/lib/use-carga';

/**
 * O pedido de disparo aberto (Hub DMS, F5 parte B): tudo o que vai sair, de uma vez — quem pede, a mensagem com os
 * valores fixos no lugar, para quem e quanto, o teto de gasto e o cupom que vai junto. Aprovar pede o código do
 * aplicativo autenticador; recusar pede o motivo, que volta a quem pediu. O plano aberto é o que a aprovação prende: se
 * ele mudou, o servidor encerra o pedido ao abrir, e a tela diz por quê.
 */
export default function PaginaPedidoDeDisparo() {
  const { id } = useParams<{ id: string }>();
  const carga = useCarga(() => aprovacoes.detalhe(id));
  const [resultado, setResultado] = useState<RespostaDaAprovacao | null>(null);
  const [recusado, setRecusado] = useState(false);

  return (
    <div className="space-y-6 lg:space-y-8">
      <p className="text-sm text-tinta-suave">
        <Link href="/campanhas" className="underline-offset-4 hover:underline">
          Campanhas
        </Link>{' '}
        ›{' '}
        <Link href="/campanhas/para-aprovar" className="underline-offset-4 hover:underline">
          Para aprovar
        </Link>
      </p>

      {carga.carregando && <EsqueletoLista linhas={3} />}

      {!carga.carregando && carga.erro && (
        <EstadoErro titulo="Não consegui abrir o pedido" mensagem={carga.erro} aoTentarDeNovo={() => void carga.recarregar()} />
      )}

      {!carga.carregando && !carga.erro && carga.dados && (
        <ConteudoDoPedido
          aberto={carga.dados}
          resultado={resultado}
          recusado={recusado}
          aoAprovar={(r) => {
            setResultado(r);
            void carga.recarregar();
          }}
          aoRecusar={() => {
            setRecusado(true);
            void carga.recarregar();
          }}
        />
      )}
    </div>
  );
}

function ConteudoDoPedido({
  aberto,
  resultado,
  recusado,
  aoAprovar,
  aoRecusar,
}: {
  aberto: PedidoAberto;
  resultado: RespostaDaAprovacao | null;
  recusado: boolean;
  aoAprovar: (r: RespostaDaAprovacao) => void;
  aoRecusar: () => void;
}) {
  const { pedido, plano } = aberto;
  const quem = nomeDoAplicativo(plano.aplicativo) ?? plano.aplicativo;
  const esperando = pedido.situacao === 'aguardando';
  const [teto, setTeto] = useState(plano.custo.estimadoCentavos ? String(Math.ceil(plano.custo.estimadoCentavos / 100)) : '');
  const [erroTeto, setErroTeto] = useState('');
  const [dialogo, setDialogo] = useState<'' | 'fator' | 'recusar'>('');

  const tetoCentavos = centavosDoTexto(teto);
  const abrirAprovar = () => {
    if (tetoCentavos === null || tetoCentavos < 100) {
      setErroTeto('Diga o teto de gasto deste disparo, em reais (pelo menos R$ 1,00).');
      return;
    }
    setErroTeto('');
    setDialogo('fator');
  };

  return (
    <>
      <CabecalhoPagina
        icone={<IconeCampanha />}
        sobretitulo={`Pedido do ${quem}`}
        titulo={plano.nome}
        descricao={<SituacaoDoPedido aberto={aberto} />}
      />

      {resultado ? <AvisoDoResultado resultado={resultado} /> : null}
      {recusado ? (
        <Alerta tom="informacao">Pedido recusado. O {quem} recebeu o motivo e vai desativar o cupom, se houver um.</Alerta>
      ) : null}
      {!aberto.conferido && esperando ? (
        <Alerta tom="atencao">
          Não consegui conferir agora, com a Meta, se o modelo ainda é o mesmo. Aprovar confere de novo antes de qualquer
          mensagem sair.
        </Alerta>
      ) : null}
      {esperando && !aberto.podeAprovar ? (
        <Alerta tom="informacao">
          Só o dono da conta aprova disparos, ou quem ele autorizar em Conta e usuários. Você vê o pedido e pode avisar o dono.
        </Alerta>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardCabecalho titulo="Quem pede" />
          <CardCorpo className="space-y-2 text-sm">
            <p className="text-tinta">
              {quem}, produto da DMS, pela ligação desta conta.{' '}
              {aberto.pedidoPor === 'agente' ? `Pedido pelo agente do ${quem}, sem pessoa` : `Pedido por uma pessoa no ${quem}`}, em{' '}
              {formatarDataHora(pedido.criado_em)}.
            </p>
            <p className="text-tinta-suave">Quem faz um pedido não o aprova. O pedido do agente, o dono aprova.</p>
          </CardCorpo>
        </Card>

        <Card>
          <CardCabecalho titulo="Para quem e quanto" />
          <CardCorpo>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-tinta-suave">Aceitaram receber</dt>
                <dd className="numerico text-2xl font-semibold text-tinta">{formatarNumero(plano.publico.aceitaram)}</dd>
                <dd className="text-xs text-tinta-suave">
                  de {formatarNumero(plano.publico.destinatarios)}
                  {plano.publico.rotulo ? ` em "${plano.publico.rotulo}"` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-tinta-suave">Custo estimado</dt>
                <dd className="numerico text-2xl font-semibold text-tinta">
                  {plano.custo.estimadoCentavos !== null ? dinheiroNaMoeda(plano.custo.estimadoCentavos, plano.custo.moeda) : '—'}
                </dd>
                <dd className="text-xs text-tinta-suave">a Meta cobra por mensagem entregue</dd>
              </div>
            </dl>
          </CardCorpo>
        </Card>
      </div>

      <Card>
        <CardCabecalho
          titulo="O que vai sair"
          descricao={`Modelo "${plano.modelo.nome}"${nomeDaCategoria(plano.modelo.categoria) ? ` · ${nomeDaCategoria(plano.modelo.categoria)}` : ''} · como a Meta o tem agora`}
        />
        <CardCorpo className="space-y-2">
          {plano.modelo.cabecalho ? <p className="text-sm font-semibold text-tinta">{plano.modelo.cabecalho}</p> : null}
          <p className="whitespace-pre-wrap break-words rounded-xl bg-superficie-2/60 p-3 text-sm text-tinta">
            {mensagemDoPlano(plano.modelo.corpo, plano.variaveis)}
          </p>
          {plano.modelo.rodape ? <p className="text-xs text-tinta-suave">{plano.modelo.rodape}</p> : null}
          {plano.modelo.botoes.length ? (
            <p className="flex flex-wrap gap-2 text-xs text-tinta-suave">
              {plano.modelo.botoes.map((b) => (
                <span key={b} className="rounded-lg border border-borda px-2 py-1">
                  {b}
                </span>
              ))}
            </p>
          ) : null}
          <p className="text-xs text-tinta-suave">Entre chaves, o que muda de pessoa para pessoa.</p>
        </CardCorpo>
      </Card>

      {plano.cupom ? (
        <Alerta tom="atencao">
          <span className="block">
            <strong>O cupom {plano.cupom.codigo} vai junto</strong>
            {plano.cupom.descricao ? ` (${plano.cupom.descricao})` : ''}. O {quem} o criou. A oferta enviada obriga a loja:
            aprovar esta mensagem é aprovar honrar o cupom. Se o pedido for recusado ou vencer, o {quem} desativa o cupom.
          </span>
        </Alerta>
      ) : null}

      {esperando ? (
        <Card>
          <CardCabecalho
            titulo="Teto de gasto deste disparo"
            descricao="O disparo para se o gasto chegar ao teto; passar dele pede um pedido novo. O orçamento da conta continua valendo."
          />
          <CardCorpo className="space-y-3">
            <div className="max-w-xs space-y-1.5">
              <Label htmlFor="teto">Teto, em reais</Label>
              <Input
                id="teto"
                inputMode="decimal"
                value={teto}
                onChange={(e) => setTeto(e.target.value)}
                invalido={Boolean(erroTeto)}
                aria-describedby={erroTeto ? 'teto-erro' : undefined}
                disabled={!aberto.podeAprovar}
              />
              {erroTeto ? (
                <AjudaCampo tom="erro" id="teto-erro">
                  {erroTeto}
                </AjudaCampo>
              ) : null}
            </div>
            <p className="text-xs text-tinta-suave">
              Plano <span className="numerico">{codigoDoPlano(pedido.resumo_do_plano)}</span>: a aprovação vale só para este
              plano e uma vez só. Se algo mudar, o pedido se encerra.
            </p>
            {aberto.podeAprovar ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={abrirAprovar} disabled={!aberto.segundoFatorPorApp}>
                  Aprovar com o código
                </Button>
                <Button variante="secundario" onClick={() => setDialogo('recusar')}>
                  Recusar
                </Button>
              </div>
            ) : null}
            {aberto.podeAprovar && !aberto.segundoFatorPorApp ? (
              <p className="text-sm text-erro" role="status">
                Aprovar pede o código do aplicativo autenticador. Ligue o aplicativo em{' '}
                <Link href="/conta" className="underline underline-offset-4">
                  Conta e usuários › Segurança do seu acesso
                </Link>{' '}
                e volte a este pedido.
              </p>
            ) : null}
          </CardCorpo>
        </Card>
      ) : null}

      <DialogoAprovar
        aberto={dialogo === 'fator'}
        aberta={aberto}
        tetoCentavos={tetoCentavos ?? 0}
        aoFechar={() => setDialogo('')}
        aoAprovar={(r) => {
          setDialogo('');
          aoAprovar(r);
        }}
      />
      <DialogoRecusar
        aberto={dialogo === 'recusar'}
        aberta={aberto}
        aoFechar={() => setDialogo('')}
        aoRecusar={() => {
          setDialogo('');
          aoRecusar();
        }}
      />
    </>
  );
}

function SituacaoDoPedido({ aberto }: { aberto: PedidoAberto }) {
  const p = aberto.pedido;
  switch (p.situacao) {
    case 'aguardando':
      return (
        <span className="flex flex-wrap items-center gap-2">
          <Badge tom="atencao">Esperando {aberto.podeAprovar ? 'você' : 'o dono'}</Badge>
          <span>vence {formatarDataHora(p.vence_em)}</span>
        </span>
      );
    case 'aprovado':
    case 'executando':
      return <Badge tom="acento">Aprovado; o disparo sai assim que puder, até {formatarDataHora(p.vence_em)}</Badge>;
    case 'executado':
      return (
        <Badge tom="sucesso">{p.motivo === 'teto-de-gasto' ? 'Disparado; parou no teto de gasto' : 'Aprovado e disparado'}</Badge>
      );
    case 'recusado':
      return <Badge tom="erro">Recusado{p.motivo_da_recusa ? `: "${p.motivo_da_recusa}"` : ''}</Badge>;
    case 'vencido':
      return <Badge tom="neutro">O prazo venceu sem resposta; nada saiu</Badge>;
    case 'cancelado':
      return (
        <Badge tom="neutro">
          {p.motivo === 'plano-mudou' ? 'O plano mudou depois do pedido: encerrado, nada saiu' : 'Cancelado antes de sair; nada saiu'}
        </Badge>
      );
    default:
      return <Badge tom="neutro">Não saiu</Badge>;
  }
}

function AvisoDoResultado({ resultado }: { resultado: RespostaDaAprovacao }) {
  if (resultado.resultado === 'executado') {
    return (
      <Alerta tom="sucesso">
        <span className="block space-y-2">
          <span className="block">Aprovado. O disparo começou, uma vez, dentro do teto; quem pediu foi avisado.</span>
          {resultado.campanhaId ? (
            <Link href={`/campanhas/${resultado.campanhaId}`} className="font-medium underline underline-offset-4">
              Acompanhar a campanha
            </Link>
          ) : null}
        </span>
      </Alerta>
    );
  }
  if (resultado.resultado === 'adiado') return <Alerta tom="atencao">{resultado.aviso ?? 'Aprovado. O disparo sai assim que puder.'}</Alerta>;
  return <Alerta tom="atencao">{resultado.aviso ?? 'O pedido se encerrou antes de aprovar; nada saiu.'}</Alerta>;
}

function DialogoAprovar({
  aberto,
  aberta,
  tetoCentavos,
  aoFechar,
  aoAprovar,
}: {
  aberto: boolean;
  aberta: PedidoAberto;
  tetoCentavos: number;
  aoFechar: () => void;
  aoAprovar: (r: RespostaDaAprovacao) => void;
}) {
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const { plano, pedido } = aberta;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const digitado = codigo.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(digitado)) {
      setErro('Digite os 6 números do código.');
      return;
    }
    setEnviando(true);
    setErro('');
    try {
      const r = await aprovacoes.aprovar(pedido.id, { codigo: digitado, tetoCentavos, resumoVisto: pedido.resumo_do_plano });
      setCodigo('');
      aoAprovar(r);
    } catch (falha) {
      setErro(mensagemDoErro(falha));
      setCodigo('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo
      aberto={aberto}
      titulo={`Aprovar o disparo de ${plano.nome}`}
      aoFechar={() => {
        setErro('');
        setCodigo('');
        aoFechar();
      }}
      descricao={
        <>
          {formatarNumero(plano.publico.aceitaram)} {plano.publico.aceitaram === 1 ? 'pessoa' : 'pessoas'}
          {plano.custo.estimadoCentavos !== null ? `, cerca de ${dinheiroNaMoeda(plano.custo.estimadoCentavos, plano.custo.moeda)}` : ''}, teto de{' '}
          {dinheiroNaMoeda(tetoCentavos, plano.custo.moeda)}
          {plano.cupom ? `, com o cupom ${plano.cupom.codigo}` : ''}. Abra o aplicativo autenticador e digite o código de 6
          números da conta Regemcast.
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => void enviar(e)} noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="codigo">Código do aplicativo autenticador</Label>
          <Input
            id="codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            invalido={Boolean(erro)}
            aria-describedby={erro ? 'codigo-erro' : undefined}
          />
          {erro ? (
            <AjudaCampo tom="erro" id="codigo-erro">
              {erro}
            </AjudaCampo>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variante="secundario" onClick={aoFechar} disabled={enviando}>
            Voltar
          </Button>
          <Button type="submit" carregando={enviando}>
            Aprovar e disparar
          </Button>
        </div>
      </form>
    </Dialogo>
  );
}

function DialogoRecusar({
  aberto,
  aberta,
  aoFechar,
  aoRecusar,
}: {
  aberto: boolean;
  aberta: PedidoAberto;
  aoFechar: () => void;
  aoRecusar: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const quem = nomeDoAplicativo(aberta.plano.aplicativo) ?? aberta.plano.aplicativo;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const texto = motivo.replace(/\s+/g, ' ').trim();
    if (!texto) {
      setErro(`Escreva o motivo: ele volta para o ${quem}.`);
      return;
    }
    setEnviando(true);
    setErro('');
    try {
      await aprovacoes.recusar(aberta.pedido.id, texto);
      setMotivo('');
      aoRecusar();
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo
      aberto={aberto}
      titulo={`Recusar o disparo de ${aberta.plano.nome}`}
      aoFechar={() => {
        setErro('');
        aoFechar();
      }}
      descricao={`Nada sai. O ${quem} recebe o motivo${aberta.plano.cupom ? ` e desativa o cupom ${aberta.plano.cupom.codigo}` : ''}.`}
    >
      <form className="space-y-4" onSubmit={(e) => void enviar(e)} noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="motivo">Motivo</Label>
          <AreaDeTexto
            id="motivo"
            rows={3}
            maxLength={300}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            invalido={Boolean(erro)}
            aria-describedby={erro ? 'motivo-erro' : undefined}
          />
          {erro ? (
            <AjudaCampo tom="erro" id="motivo-erro">
              {erro}
            </AjudaCampo>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variante="secundario" onClick={aoFechar} disabled={enviando}>
            Voltar
          </Button>
          <Button type="submit" variante="perigo" carregando={enviando}>
            Recusar o pedido
          </Button>
        </div>
      </form>
    </Dialogo>
  );
}
