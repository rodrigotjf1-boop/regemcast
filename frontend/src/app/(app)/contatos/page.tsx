'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { BlocosDaBase } from '@/components/app/blocos/blocos-da-base';
import { DividirEmBlocos, type AlvoDaDivisao } from '@/components/app/blocos/dividir-em-blocos';
import { RegioesPeloDdd } from '@/components/app/blocos/regioes-da-base';
import { IconeBlocos, IconeContatos, IconeEscudo, IconeFechar, IconeImportar } from '@/components/app/icones';
import { ImportarContatos } from '@/components/app/importar-contatos';
import { COR_PERFIL, PerfisDaBase } from '@/components/app/perfis-base';
import { PublicosDaBase } from '@/components/app/publicos-base';
import { useSessao } from '@/components/app/sessao';
import { CabecalhoPagina } from '@/components/ui/cabecalho-pagina';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { EsqueletoLista } from '@/components/ui/esqueleto';
import { EstadoErro } from '@/components/ui/estado-erro';
import { Alerta } from '@/components/ui/alerta';
import { mensagemDoErro } from '@/lib/api';
import { diasDesde, formatarData, formatarNumero, formatarReais } from '@/lib/formato';
import { contatos as servico } from '@/lib/servicos';
import type {
  AlvoDePublico,
  DivisaoDeBlocos,
  ListaDeContatos,
  PaginaDeContatos,
  RegioesDaBase,
  ResumoPublicos,
  ResumoSegmentos,
  Segmento,
} from '@/lib/tipos';

/**
 * A base de contatos.
 *
 * Duas coisas aparecem aqui que costumam ficar escondidas em produto de
 * disparo: **de onde veio o consentimento de cada pessoa** e **quem pediu para
 * sair**. As duas ficam na mesma tabela, à vista, porque são a resposta que o
 * cliente precisa ter na mão quando a Meta pergunta — e porque descadastro que
 * ninguém vê é descadastro que volta a receber.
 */

const POR_PAGINA = 50;

/** Como o consentimento foi obtido, em uma palavra que o cliente entenda. */
const ORIGEM_CONSENTIMENTO: Record<string, string> = {
  declarado: 'Declarado na importação',
  formulario: 'Formulário',
  conversa: 'Conversa iniciada pela pessoa',
  api: 'Sistema do cliente',
};

/** Cor do avatar a partir do telefone: a mesma pessoa tem sempre a mesma cor. */
const AVATARES = [
  'bg-acento text-acento-contraste',
  'bg-realce text-tinta',
  'bg-lateral text-lateral-tinta',
  'bg-acento-suave text-acento-forte',
];
function avatar(telefone: string): string {
  const soma = telefone.split('').reduce((t, c) => t + c.charCodeAt(0), 0);
  return AVATARES[soma % AVATARES.length];
}

function iniciais(nome: string | null): string {
  const partes = (nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '#';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export default function PaginaContatos() {
  const [pagina, setPagina] = useState<PaginaDeContatos | null>(null);
  const [listas, setListas] = useState<ListaDeContatos[]>([]);
  const [numero, setNumero] = useState(1);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [importando, setImportando] = useState(false);
  const [perfis, setPerfis] = useState<ResumoSegmentos | null>(null);
  const [segmento, setSegmento] = useState<Segmento | null>(null);
  const [regioes, setRegioes] = useState<RegioesDaBase | null>(null);
  const [uf, setUf] = useState<string | null>(null);
  const [publicos, setPublicos] = useState<ResumoPublicos | null>(null);
  const [publico, setPublico] = useState<AlvoDePublico | null>(null);
  const [divisoes, setDivisoes] = useState<DivisaoDeBlocos[]>([]);
  const [dividindo, setDividindo] = useState<AlvoDaDivisao | null>(null);
  const [avisoBlocos, setAvisoBlocos] = useState('');
  const { sessao } = useSessao();
  const ehDono = sessao.usuario.papel === 'dono';
  const router = useRouter();

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const [p, l, s, r, d, pb] = await Promise.all([
        servico.listar(numero, POR_PAGINA, segmento, uf, publico),
        servico.listas(),
        servico.segmentos().catch(() => null),
        servico.regioes().catch(() => null),
        servico.divisoes().catch(() => []),
        servico.publicos().catch(() => null),
      ]);
      setPagina(p);
      setListas(l);
      setPerfis(s);
      setRegioes(r);
      setDivisoes(d);
      setPublicos(pb);
    } catch (e) {
      setErro(mensagemDoErro(e));
      setPagina(null);
    } finally {
      setCarregando(false);
    }
  }, [numero, segmento, uf, publico]);

  function abrirDivisao(alvo: AlvoDaDivisao) {
    setAvisoBlocos('');
    setImportando(false);
    setDividindo(alvo);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Chegou pelo atalho "Importar contatos" do painel: já abre a importação.
  // O endereço antigo do Cardápio Web (?importar=cardapioweb) mora agora em Integrações.
  useEffect(() => {
    const importar = new URLSearchParams(window.location.search).get('importar');
    if (importar === 'cardapioweb') router.replace('/integracoes');
    else if (importar === '1') setImportando(true);
  }, [router]);

  async function descadastrar(id: string) {
    try {
      await servico.descadastrar(id);
      await carregar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    }
  }

  const total = pagina?.total ?? 0;
  const ultimaPagina = Math.max(1, Math.ceil(total / POR_PAGINA));
  // Os blocos aparecem na seção deles; aqui, só as listas comuns.
  const listasComuns = listas.filter((l) => !l.divisaoId);
  // Quem pode receber: a soma das regiões já conta só os ativos.
  const ativosDaBase = regioes ? regioes.regioes.reduce((t, r) => t + r.total, 0) + regioes.semRegiao : null;

  return (
    <div className="space-y-6 lg:space-y-8">
      <CabecalhoPagina
        icone={<IconeContatos />}
        sobretitulo={
          pagina
            ? `${formatarNumero(total)} ${total === 1 ? 'contato' : 'contatos'} ${segmento || uf || publico ? 'neste filtro' : 'na base'}`
            : 'Operação'
        }
        titulo="Contatos"
        descricao="Quem pode receber suas campanhas — com o registro de como cada pessoa autorizou."
        acao={
          <div className="flex flex-wrap gap-2">
          <Link href="/contatos/bloqueios">
            <Button variante="secundario">Bloqueios</Button>
          </Link>
          {total > 0 && (
            <Button
              variante="secundario"
              onClick={() =>
                dividindo
                  ? setDividindo(null)
                  : abrirDivisao({ origem: 'base', rotulo: 'Base inteira', total: ativosDaBase })
              }
              aria-expanded={Boolean(dividindo)}
            >
              <IconeBlocos />
              Dividir em blocos
            </Button>
          )}
          <Button
            variante={importando ? 'secundario' : 'primario'}
            onClick={() => setImportando((v) => !v)}
            aria-expanded={importando}
          >
            {importando ? <IconeFechar /> : <IconeImportar />}
            {importando ? 'Cancelar' : 'Importar contatos'}
          </Button>
          </div>
        }
      />

      {importando && (
        <div className="anima-entrada">
          <ImportarContatos
            aoConcluir={() => {
              setNumero(1);
              void carregar();
            }}
            aoDividir={abrirDivisao}
          />
        </div>
      )}

      {dividindo && (
        <DividirEmBlocos
          alvo={dividindo}
          aoCancelar={() => setDividindo(null)}
          aoConcluir={(d) => {
            setDividindo(null);
            setAvisoBlocos(
              `${formatarNumero(d.totalBlocos)} ${d.totalBlocos === 1 ? 'bloco criado' : 'blocos criados'} com ${formatarNumero(d.totalContatos)} ${d.totalContatos === 1 ? 'pessoa' : 'pessoas'}. Cada bloco é uma lista: escolha-o ao montar a campanha.`,
            );
            void carregar().then(() => document.getElementById('blocos')?.scrollIntoView({ behavior: 'smooth' }));
          }}
        />
      )}

      {avisoBlocos && <Alerta tom="sucesso">{avisoBlocos}</Alerta>}

      {perfis && (
        <PerfisDaBase
          key={JSON.stringify(perfis.parametros)}
          resumo={perfis}
          selecionado={segmento}
          aoSelecionar={(s) => {
            setSegmento(s);
            setUf(null);
            setPublico(null);
            setNumero(1);
          }}
          ehDono={ehDono}
          aoMudar={() => void carregar()}
          aoDividir={(s, nome, totalDoPerfil) =>
            abrirDivisao({ origem: 'perfil', segmento: s, rotulo: nome, total: totalDoPerfil })
          }
        />
      )}

      {publicos && (
        <PublicosDaBase
          resumo={publicos}
          selecionado={publico}
          aoSelecionar={(alvo) => {
            setPublico(alvo);
            setSegmento(null);
            setUf(null);
            setNumero(1);
          }}
          aoMudar={() => void carregar()}
          aoDividir={(alvo) =>
            abrirDivisao({
              origem: 'publico',
              publico: alvo.publico,
              publicoValor: alvo.valor ?? null,
              rotulo: alvo.nome,
              total: alvo.total,
            })
          }
        />
      )}

      {regioes && regioes.regioes.length > 0 && (
        <RegioesPeloDdd
          regioes={regioes}
          selecionada={uf}
          aoSelecionar={(u) => {
            setUf(u);
            setSegmento(null);
            setPublico(null);
            setNumero(1);
          }}
          aoDividir={(u, estado, totalDaRegiao) =>
            abrirDivisao({ origem: 'regiao', uf: u, rotulo: estado, total: totalDaRegiao })
          }
        />
      )}

      {divisoes.length > 0 && <BlocosDaBase divisoes={divisoes} ehDono={ehDono} aoMudar={() => void carregar()} />}

      {listasComuns.length > 0 && (
        <section aria-label="Listas" className="anima-entrada space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-tinta">Listas</h2>
            <p className="text-xs text-tinta-suave">A contagem exclui quem pediu para sair.</p>
          </div>
          <ul className="escalonado grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {listasComuns.map((l) => (
              <li
                key={l.id}
                className="cartao-interativo flex items-center gap-3 rounded-card border border-borda bg-superficie p-4 shadow-card"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-realce text-tinta">
                  <IconeContatos className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-tinta">{l.nome}</p>
                  <p className="text-xs text-tinta-suave">
                    <span className="numerico text-tinta">{formatarNumero(l.total)}</span>{' '}
                    {l.total === 1 ? 'pessoa' : 'pessoas'} · {formatarData(l.criadoEm)}
                  </p>
                </div>
                {l.total > 0 && (
                  <button
                    type="button"
                    onClick={() => abrirDivisao({ origem: 'lista', origemId: l.id, rotulo: l.nome, total: l.total })}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-acento-forte underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento"
                    aria-label={`Dividir a lista ${l.nome} em blocos`}
                  >
                    Dividir
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {carregando && <EsqueletoLista linhas={5} />}

      {!carregando && erro && (
        <EstadoErro
          titulo="Não consegui carregar seus contatos"
          mensagem={erro}
          aoTentarDeNovo={() => void carregar()}
        />
      )}

      {!carregando && !erro && total === 0 && !importando && (
        <EmptyState
          icone={<IconeContatos />}
          titulo="Nenhum contato ainda"
          descricao="Importe a agenda do seu celular, uma planilha ou cole uma lista de números."
          acao={
            <Button onClick={() => setImportando(true)}>
              <IconeImportar />
              Importar contatos
            </Button>
          }
        />
      )}

      {!carregando && !erro && total > 0 && (
        <section className="anima-entrada overflow-hidden rounded-card border border-borda bg-superficie shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-borda px-5 py-4">
            <h2 className="text-base font-semibold text-tinta">
              {total === 1 ? '1 contato' : `${formatarNumero(total)} contatos`}
            </h2>
            <p className="inline-flex items-center gap-1.5 text-xs text-tinta-suave">
              <IconeEscudo className="h-4 w-4" />
              Autorização registrada por pessoa
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] text-left text-sm">
              <caption className="sr-only">Contatos da sua base, com a origem do consentimento</caption>
              <thead>
                <tr className="bg-superficie-2/60 text-xs uppercase tracking-wide text-tinta-suave">
                  <th scope="col" className="px-5 py-2.5 font-medium">Nome</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Telefone</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Compras</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Última compra</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Perfil</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Autorização</th>
                  <th scope="col" className="px-5 py-2.5 font-medium">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {pagina?.itens.map((c) => (
                  <tr key={c.id} className="group align-middle transition-colors hover:bg-superficie-2/50">
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[0.7rem] font-semibold ${avatar(c.telefone)}`}
                        >
                          {iniciais(c.nome)}
                        </span>
                        <span className="min-w-0">
                          <span className={`block ${c.nome ? 'font-medium text-tinta' : 'text-tinta-suave'}`}>
                            {c.nome || 'Sem nome'}
                          </span>
                          {c.email && <span className="block truncate text-xs text-tinta-suave">{c.email}</span>}
                        </span>
                      </span>
                    </td>
                    <td className="numerico whitespace-nowrap px-3 py-3 text-tinta">{c.telefone}</td>
                    <td className="numerico whitespace-nowrap px-3 py-3 text-tinta">
                      {c.pedidos != null ? (
                        <>
                          {formatarNumero(c.pedidos)} {c.pedidos === 1 ? 'pedido' : 'pedidos'}
                          {c.totalGastoCentavos != null && (
                            <span className="block text-xs text-tinta-suave">{formatarReais(c.totalGastoCentavos)}</span>
                          )}
                        </>
                      ) : c.totalGastoCentavos != null ? (
                        formatarReais(c.totalGastoCentavos)
                      ) : (
                        <span className="text-tinta-suave">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-tinta">
                      {(() => {
                        const dias = diasDesde(c.ultimoPedidoEm);
                        if (dias === null) return <span className="text-tinta-suave">—</span>;
                        return (
                          <>
                            {dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${formatarNumero(dias)} dias`}
                            <span className="block text-xs text-tinta-suave">{formatarData(c.ultimoPedidoEm)}</span>
                          </>
                        );
                      })()}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {c.segmento && c.segmento !== 'sem_historico' && !c.optOut ? (
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-xs text-tinta ${COR_PERFIL[c.segmento]}`}>
                          {perfis?.segmentos.find((s) => s.id === c.segmento)?.nome ?? c.segmento}
                        </span>
                      ) : (
                        <span className="text-tinta-suave">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-tinta-suave">
                      {c.optOut ? (
                        <Badge tom="erro" ponto>
                          Pediu para sair
                        </Badge>
                      ) : (
                        ((c.consentimentoOrigem ? ORIGEM_CONSENTIMENTO[c.consentimentoOrigem] : null) ?? '—')
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {!c.optOut && (
                        <button
                          type="button"
                          onClick={() => void descadastrar(c.id)}
                          className="rounded-lg px-2 py-1 text-xs text-tinta-suave transition-colors hover:bg-erro/10 hover:text-erro sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                        >
                          Descadastrar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {ultimaPagina > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-borda px-5 py-3">
              <span className="text-xs text-tinta-suave">
                Página <span className="numerico text-tinta">{pagina?.pagina ?? 1}</span> de{' '}
                <span className="numerico text-tinta">{ultimaPagina}</span>
              </span>
              <div className="flex gap-2">
                <Button
                  variante="secundario"
                  tamanho="sm"
                  onClick={() => setNumero((n) => Math.max(1, n - 1))}
                  disabled={(pagina?.pagina ?? 1) <= 1}
                >
                  Anterior
                </Button>
                <Button
                  variante="secundario"
                  tamanho="sm"
                  onClick={() => setNumero((n) => Math.min(ultimaPagina, n + 1))}
                  disabled={(pagina?.pagina ?? 1) >= ultimaPagina}
                >
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
