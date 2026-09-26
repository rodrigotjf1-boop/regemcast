'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { IconeEscudo } from '@/components/app/icones';
import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CabecalhoPagina } from '@/components/ui/cabecalho-pagina';
import { EmptyState } from '@/components/ui/empty-state';
import { EsqueletoLista } from '@/components/ui/esqueleto';
import { EstadoErro } from '@/components/ui/estado-erro';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumerosSemWhatsapp } from '@/components/app/numeros-sem-whatsapp';
import { mensagemDoErro } from '@/lib/api';
import { formatarData, formatarNumero } from '@/lib/formato';
import { contatos as servico } from '@/lib/servicos';
import type { Contato, PaginaDeContatos } from '@/lib/tipos';

/**
 * Bloqueios: quem pediu para não receber mais.
 *
 * A lista existe por dois motivos. O primeiro é operacional: quando alguém
 * reclama que "parei de receber", é aqui que se vê o que aconteceu, quando e
 * por onde. O segundo é legal: o pedido de exclusão de dados (LGPD) chega e
 * precisa de um lugar para ser atendido, sem quebrar a promessa feita a quem
 * pediu para sair.
 *
 * Por isso as três ações são diferentes de propósito — e a mais destrutiva é a
 * que menos protege o número da empresa.
 */

const POR_PAGINA = 50;

const ORIGEM: Record<string, string> = {
  botao_modelo: 'Tocou em "Parar promoções"',
  mensagem: 'Respondeu pedindo para sair',
  painel: 'Descadastrado no painel',
  cardapioweb: 'Desligou o WhatsApp no Cardápio Web',
  pedido_exclusao: 'Pediu a exclusão dos dados',
};

export default function PaginaBloqueios() {
  const [pagina, setPagina] = useState<PaginaDeContatos | null>(null);
  const [numero, setNumero] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [reativando, setReativando] = useState<Contato | null>(null);
  const [justificativa, setJustificativa] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      setPagina(await servico.bloqueados(numero, POR_PAGINA));
    } catch (e) {
      setErro(mensagemDoErro(e));
      setPagina(null);
    } finally {
      setCarregando(false);
    }
  }, [numero]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function agir(acao: () => Promise<unknown>, texto: string) {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      await acao();
      setAviso(texto);
      setReativando(null);
      setJustificativa('');
      await carregar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const total = pagina?.total ?? 0;
  const ultimaPagina = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div className="space-y-6 lg:space-y-8">
      <CabecalhoPagina
        icone={<IconeEscudo />}
        sobretitulo={pagina ? `${formatarNumero(total)} ${total === 1 ? 'número bloqueado' : 'números bloqueados'}` : 'Operação'}
        titulo="Bloqueios"
        descricao="Quem pediu para não receber mais. Nenhuma campanha sai para estes números — a conferência é feita no momento do disparo."
        acao={
          <Link href="/contatos">
            <Button variante="secundario">Voltar aos contatos</Button>
          </Link>
        }
      />

      <Alerta tom="informacao">
        Respeitar o pedido de saída é o que protege o seu número: quem não consegue sair bloqueia ou denuncia, e
        bloqueio derruba a qualidade — que leva semanas para voltar. Só devolva alguém à base <strong>se a
        própria pessoa pedir</strong>.
      </Alerta>

      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {aviso && <Alerta tom="sucesso">{aviso}</Alerta>}

      {carregando && !pagina ? (
        <EsqueletoLista />
      ) : !pagina ? (
        <EstadoErro titulo="Não consegui carregar os bloqueios" mensagem={erro} aoTentarDeNovo={() => void carregar()} />
      ) : total === 0 ? (
        <EmptyState
          titulo="Ninguém pediu para sair"
          descricao="Quando alguém tocar em “Parar promoções” ou responder pedindo para sair, o número aparece aqui."
        />
      ) : (
        <section className="anima-entrada overflow-hidden rounded-card border border-borda bg-superficie shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <caption className="sr-only">Números bloqueados, com a data e o motivo da saída</caption>
              <thead>
                <tr className="bg-superficie-2/60 text-xs uppercase tracking-wide text-tinta-suave">
                  <th scope="col" className="px-5 py-2.5 font-medium">Nome</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Telefone</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Saiu em</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Como saiu</th>
                  <th scope="col" className="px-5 py-2.5 font-medium">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {pagina.itens.map((c) => (
                  <tr key={c.id} className="align-middle">
                    <td className="px-5 py-3 text-tinta">{c.nome || <span className="text-tinta-suave">Sem nome</span>}</td>
                    <td className="numerico whitespace-nowrap px-3 py-3 text-tinta">{c.telefone}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-tinta-suave">{formatarData(c.optOutEm)}</td>
                    <td className="px-3 py-3 text-tinta-suave">
                      {c.optOutOrigem ? (ORIGEM[c.optOutOrigem] ?? c.optOutOrigem) : <Badge tom="neutro">Não informado</Badge>}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          tamanho="sm"
                          variante="secundario"
                          onClick={() => {
                            setReativando(c);
                            setJustificativa('');
                            setAviso('');
                          }}
                        >
                          Voltar à base
                        </Button>
                        <Button
                          tamanho="sm"
                          variante="secundario"
                          disabled={ocupado}
                          onClick={() => {
                            if (!confirm('Apagar nome, e-mail, aniversário e histórico desta pessoa? O número continua bloqueado.')) return;
                            void agir(() => servico.anonimizar(c.id), 'Dados pessoais apagados. O número segue bloqueado.');
                          }}
                        >
                          Apagar dados
                        </Button>
                        <Button
                          tamanho="sm"
                          variante="perigo"
                          disabled={ocupado}
                          onClick={() => {
                            if (
                              !confirm(
                                'Apagar tudo, inclusive o número?\n\nSem o número na lista, esta pessoa pode voltar numa importação futura e receber campanha de novo. Para atender um pedido de exclusão mantendo o bloqueio, use "Apagar dados".',
                              )
                            )
                              return;
                            void agir(() => servico.apagar(c.id), 'Contato apagado por completo.');
                          }}
                        >
                          Apagar tudo
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {ultimaPagina > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-borda px-5 py-3">
              <span className="text-xs text-tinta-suave">
                Página <span className="numerico text-tinta">{pagina.pagina}</span> de{' '}
                <span className="numerico text-tinta">{ultimaPagina}</span>
              </span>
              <div className="flex gap-2">
                <Button variante="secundario" tamanho="sm" onClick={() => setNumero((n) => Math.max(1, n - 1))} disabled={pagina.pagina <= 1}>
                  Anterior
                </Button>
                <Button
                  variante="secundario"
                  tamanho="sm"
                  onClick={() => setNumero((n) => Math.min(ultimaPagina, n + 1))}
                  disabled={pagina.pagina >= ultimaPagina}
                >
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {reativando && (
        <section className="anima-entrada space-y-3 rounded-card border border-acento/40 bg-acento/5 p-4">
          <h2 className="text-base font-semibold text-tinta">
            Voltar {reativando.nome || reativando.telefone} à base
          </h2>
          <p className="text-sm leading-relaxed text-tinta-suave">
            Só faça isso se a própria pessoa pediu. O que você escrever fica gravado no contato e na trilha de
            auditoria — é a prova de que o retorno foi pedido, e não uma saída apagada.
          </p>
          <div className="max-w-xl space-y-1.5">
            <Label htmlFor="justificativa">Quem pediu, e como</Label>
            <Input
              id="justificativa"
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              placeholder="Ex.: a cliente pediu no balcão para voltar a receber as promoções"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              carregando={ocupado}
              disabled={justificativa.trim().length < 5}
              onClick={() =>
                void agir(
                  () => servico.reativar(reativando.id, justificativa.trim()),
                  'Contato de volta à base, com o pedido registrado.',
                )
              }
            >
              Confirmar retorno
            </Button>
            <Button variante="secundario" onClick={() => setReativando(null)}>
              Cancelar
            </Button>
          </div>
        </section>
      )}
      <NumerosSemWhatsapp />
    </div>
  );
}
