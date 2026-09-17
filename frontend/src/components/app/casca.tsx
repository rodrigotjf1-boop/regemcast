'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import {
  IconeCampanha,
  IconeContatos,
  IconeConta,
  IconeConversa,
  IconeEscudo,
  IconeFechar,
  IconeMenu,
  IconeModelo,
  IconePainel,
  IconeSair,
} from '@/components/app/icones';
import { useSessao } from '@/components/app/sessao';
import { Logotipo } from '@/components/marca/logotipo';
import { cn } from '@/lib/cn';
import { formatarNumero, percentual } from '@/lib/formato';
import { conta } from '@/lib/servicos';
import { useCarga } from '@/lib/use-carga';

/**
 * A casca do app: barra lateral escura + área de trabalho.
 *
 * **Por que lateral, e não barra no topo.** Barra no topo cabe cinco seções e
 * acaba; a lateral cresce sem apertar ninguém, e é o formato que a pessoa
 * reconhece de software de gestão. Ela também carrega a MARCA: ameixa com lima,
 * nos dois temas, é o que faz o produto parecer ele mesmo em qualquer tela.
 *
 * **O consumo do plano mora aqui.** É a pergunta que o cliente de disparo faz
 * o tempo todo ("quanto ainda posso enviar?"), então fica à vista em toda tela.
 * Se a leitura falhar, o bloco some — um "0 de 0" inventado seria pior.
 *
 * No celular vira uma barra no topo com botão de menu, e a lateral abre por
 * cima do conteúdo. Fecha no Esc, no clique fora e ao trocar de tela.
 */

const SECOES = [
  {
    titulo: 'Operação',
    itens: [
      { href: '/painel', rotulo: 'Painel', Icone: IconePainel },
      { href: '/campanhas', rotulo: 'Campanhas', Icone: IconeCampanha },
      { href: '/modelos', rotulo: 'Modelos', Icone: IconeModelo },
      { href: '/contatos', rotulo: 'Contatos', Icone: IconeContatos },
    ],
  },
  {
    titulo: 'Configuração',
    itens: [
      { href: '/whatsapp', rotulo: 'WhatsApp', Icone: IconeConversa },
      { href: '/conta', rotulo: 'Conta e usuários', Icone: IconeConta },
    ],
  },
  {
    titulo: 'Ajuda',
    itens: [{ href: '/regras', rotulo: 'Regras', Icone: IconeEscudo }],
  },
] as const;

/** Iniciais para o avatar. Duas no máximo — três já viram borrão. */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export function Casca({ children }: { children: ReactNode }) {
  const caminho = usePathname();
  const [aberta, setAberta] = useState(false);

  // Trocou de tela: a gaveta fecha sozinha.
  useEffect(() => setAberta(false), [caminho]);

  useEffect(() => {
    if (!aberta) return;
    const naTecla = (e: KeyboardEvent) => e.key === 'Escape' && setAberta(false);
    document.addEventListener('keydown', naTecla);
    // A página de trás não rola enquanto a gaveta está aberta.
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', naTecla);
      document.body.style.overflow = antes;
    };
  }, [aberta]);

  return (
    <div className="min-h-screen lg:pl-72">
      {/* Barra do celular */}
      <div className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-lateral-borda bg-lateral px-4 py-2.5 lg:hidden">
        <Link href="/painel" aria-label="RegemCast — ir para o painel">
          <Logotipo sobreEscuro animado />
        </Link>
        <button
          type="button"
          onClick={() => setAberta(true)}
          aria-expanded={aberta}
          aria-controls="navegacao-lateral"
          className="grid h-10 w-10 place-items-center rounded-xl text-lateral-tinta transition-colors hover:bg-white/10"
        >
          <IconeMenu className="h-5 w-5" />
          <span className="sr-only">Abrir menu</span>
        </button>
      </div>

      {/* Fundo escurecido da gaveta, só no celular */}
      <div
        aria-hidden="true"
        onClick={() => setAberta(false)}
        className={cn(
          'fixed inset-0 z-40 bg-lateral/60 backdrop-blur-sm transition-opacity lg:hidden',
          aberta ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <aside
        id="navegacao-lateral"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col overflow-y-auto overflow-x-hidden bg-lateral text-lateral-tinta',
          'transition-[transform,visibility] duration-300 ease-out lg:visible lg:translate-x-0',
          // Fechada no celular, sai também do Tab: fora da tela não é o mesmo
          // que fora do foco.
          aberta ? 'visible translate-x-0 shadow-flutuante' : 'invisible -translate-x-full',
        )}
      >
        <Lateral aoFechar={() => setAberta(false)} caminho={caminho} />
      </aside>

      <div className="relative isolate">
        {/* Luz de marca no alto da área de trabalho. Decorativa. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 overflow-hidden"
        >
          <div className="anima-aurora absolute -top-40 right-[-10%] h-96 w-[36rem] rounded-full bg-acento/[0.12] blur-3xl" />
          <div className="anima-aurora absolute -top-48 left-[10%] h-80 w-[28rem] rounded-full bg-realce/[0.10] blur-3xl [animation-delay:-7s]" />
        </div>

        <main
          id="conteudo"
          className="mx-auto w-full max-w-conteudo px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

function Lateral({ aoFechar, caminho }: { aoFechar: () => void; caminho: string }) {
  const { sessao, sair } = useSessao();
  const [saindo, setSaindo] = useState(false);
  const ativo = (href: string) => caminho === href || caminho.startsWith(href + '/');

  return (
    <>
      {/* Brilho de fundo da lateral */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-acento/10 blur-3xl"
      />
      <div aria-hidden="true" className="fundo-pontos-claro pointer-events-none absolute inset-0 opacity-60" />

      <div className="relative flex items-center justify-between px-5 pb-3 pt-4">
        <Link href="/painel" aria-label="RegemCast — ir para o painel" className="rounded-lg">
          <Logotipo sobreEscuro animado />
        </Link>
        <button
          type="button"
          onClick={aoFechar}
          className="grid h-9 w-9 place-items-center rounded-lg text-lateral-suave hover:bg-white/10 hover:text-lateral-tinta lg:hidden"
        >
          <IconeFechar className="h-5 w-5" />
          <span className="sr-only">Fechar menu</span>
        </button>
      </div>

      <div className="relative mx-4 mb-2 rounded-xl border border-lateral-borda bg-lateral-2/70 px-3 py-2.5">
        <p className="truncate text-sm font-semibold text-lateral-tinta">{sessao.conta.nome}</p>
        <p className="flex items-center gap-1.5 text-xs text-lateral-suave">
          <span className="h-1.5 w-1.5 rounded-full bg-acento" aria-hidden="true" />
          {sessao.usuario.papel === 'dono' ? 'Dono da conta' : 'Operador'}
        </p>
      </div>

      <nav aria-label="Seções" className="relative flex-1 px-3 py-1">
        {SECOES.map((secao) => (
          <div key={secao.titulo} className="mb-2">
            <p className="px-3 pb-1.5 pt-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-lateral-suave/80">
              {secao.titulo}
            </p>
            <ul className="space-y-0.5">
              {secao.itens.map(({ href, rotulo, Icone }) => {
                const estaAtivo = ativo(href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={estaAtivo ? 'page' : undefined}
                      className={cn(
                        'group relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-all duration-200',
                        estaAtivo
                          ? 'bg-acento text-acento-contraste shadow-brilho'
                          : 'text-lateral-suave hover:translate-x-0.5 hover:bg-white/[0.07] hover:text-lateral-tinta',
                      )}
                    >
                      <Icone
                        className={cn(
                          'h-5 w-5 shrink-0 transition-transform duration-200',
                          estaAtivo ? '' : 'group-hover:scale-110',
                        )}
                      />
                      {rotulo}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <ConsumoLateral />

      <div className="relative border-t border-lateral-borda p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-acento to-realce font-mono text-xs font-bold text-acento-contraste"
          >
            {iniciais(sessao.usuario.nome)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-lateral-tinta">{sessao.usuario.nome}</p>
            <p className="truncate text-xs text-lateral-suave">{sessao.usuario.email}</p>
          </div>
          <button
            type="button"
            onClick={async () => {
              setSaindo(true);
              await sair();
            }}
            disabled={saindo}
            title="Sair"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-lateral-suave transition-colors hover:bg-white/10 hover:text-lateral-tinta disabled:opacity-50"
          >
            <IconeSair className="h-[1.125rem] w-[1.125rem]" />
            <span className="sr-only">{saindo ? 'Saindo…' : 'Sair'}</span>
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Consumo do ciclo, sempre à vista.
 *
 * Só aparece com dado lido. Carregando, mostra o trilho vazio; falhou, some —
 * o painel tem o erro completo, e a lateral não é lugar de mensagem de erro.
 */
function ConsumoLateral() {
  const { dados } = useCarga(() => conta.resumo());
  if (!dados?.uso) return null;

  const { disparos, teto } = dados.uso;
  const pct = teto ? percentual(disparos, teto) : 0;

  return (
    <div className="relative mx-4 mb-3 rounded-xl border border-lateral-borda bg-lateral-2/70 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-lateral-suave">{dados.plano?.nome ?? 'Uso do ciclo'}</p>
        {teto ? <p className="numerico text-xs text-lateral-tinta">{pct}%</p> : null}
      </div>
      <p className="mt-1 text-sm text-lateral-tinta">
        <span className="numerico font-semibold">{formatarNumero(disparos)}</span>
        <span className="text-lateral-suave">
          {teto ? ` de ${formatarNumero(teto)} disparos` : ' disparos no ciclo'}
        </span>
      </p>
      {teto ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
          <div
            className={cn(
              'anima-preencher h-full rounded-full',
              pct >= 100 ? 'bg-erro' : pct >= 80 ? 'bg-realce' : 'bg-acento',
            )}
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
