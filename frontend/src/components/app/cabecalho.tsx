'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import {
  IconeCampanha,
  IconeContatos,
  IconeConta,
  IconeConversa,
  IconeModelo,
  IconePainel,
  IconeSair,
  IconeSeta,
} from '@/components/app/icones';
import { useSessao } from '@/components/app/sessao';
import { Logotipo } from '@/components/marca/logotipo';
import { cn } from '@/lib/cn';

/**
 * A barra do app.
 *
 * Duas decisões de estrutura, e as duas são sobre hierarquia — não sobre gosto.
 *
 * **Ícone junto do rótulo.** Numa fileira de seis links de texto, achar
 * "Modelos" exige ler os seis. O ícone é o que permite mirar sem ler, e é o que
 * separa uma barra de navegação de uma lista de links.
 *
 * **"Conta" saiu do meio do caminho.** Ela não é uma seção de trabalho como
 * Campanhas ou Contatos: é configuração, e configuração mora perto de quem está
 * logado. Misturada às outras, competia por atenção com as telas que a pessoa
 * usa o dia inteiro.
 */

const ITENS = [
  { href: '/painel', rotulo: 'Painel', Icone: IconePainel },
  { href: '/whatsapp', rotulo: 'WhatsApp', Icone: IconeConversa },
  { href: '/modelos', rotulo: 'Modelos', Icone: IconeModelo },
  { href: '/contatos', rotulo: 'Contatos', Icone: IconeContatos },
  { href: '/campanhas', rotulo: 'Campanhas', Icone: IconeCampanha },
] as const;

/** Iniciais para o avatar. Duas no máximo — três já viram borrão. */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export function Cabecalho() {
  const { sessao, sair } = useSessao();
  const caminho = usePathname();
  const [saindo, setSaindo] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  const ativo = (href: string) => caminho === href || caminho.startsWith(href + '/');

  // Fecha no clique fora e no Esc. Menu que só fecha no próprio botão é
  // armadilha em tela pequena, onde o dedo quase sempre erra o alvo.
  useEffect(() => {
    if (!menuAberto) return;

    const noClique = (e: MouseEvent) => {
      if (menu.current && !menu.current.contains(e.target as Node)) setMenuAberto(false);
    };
    const naTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuAberto(false);
    };

    document.addEventListener('mousedown', noClique);
    document.addEventListener('keydown', naTecla);
    return () => {
      document.removeEventListener('mousedown', noClique);
      document.removeEventListener('keydown', naTecla);
    };
  }, [menuAberto]);

  async function aoSair() {
    setSaindo(true);
    await sair();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-borda bg-superficie/90 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-conteudo items-center gap-3 px-4 py-2.5 sm:px-6">
        <Link
          href="/painel"
          className="shrink-0 rounded-lg"
          aria-label="Regemcast — ir para o painel"
        >
          <Logotipo />
        </Link>

        <span aria-hidden className="hidden h-6 w-px shrink-0 bg-borda lg:block" />

        <nav
          aria-label="Seções"
          className="-mx-1 min-w-0 flex-1 overflow-x-auto lg:mx-0 lg:overflow-visible"
        >
          <ul className="flex items-center gap-0.5 px-1">
            {ITENS.map(({ href, rotulo, Icone }) => {
              const estaAtivo = ativo(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={estaAtivo ? 'page' : undefined}
                    className={cn(
                      'group inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium transition-colors',
                      estaAtivo
                        ? 'bg-acento-suave text-acento-forte'
                        : 'text-tinta-suave hover:bg-superficie-2 hover:text-tinta',
                    )}
                  >
                    <Icone
                      className={cn(
                        'h-4 w-4 shrink-0 transition-opacity',
                        estaAtivo ? 'opacity-100' : 'opacity-70 group-hover:opacity-100',
                      )}
                    />
                    {rotulo}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div ref={menu} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuAberto((v) => !v)}
            aria-expanded={menuAberto}
            aria-haspopup="menu"
            className="flex h-9 items-center gap-2 rounded-lg pl-1 pr-1.5 text-sm transition-colors hover:bg-superficie-2"
          >
            <span
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-acento font-mono text-[0.7rem] font-semibold text-acento-contraste"
            >
              {iniciais(sessao.usuario.nome)}
            </span>
            <span className="hidden max-w-[10rem] truncate text-tinta sm:inline">
              {sessao.usuario.nome}
            </span>
            <IconeSeta
              className={cn(
                'h-3.5 w-3.5 text-tinta-suave transition-transform',
                menuAberto && 'rotate-180',
              )}
            />
          </button>

          {menuAberto && (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-card border border-borda bg-superficie shadow-flutuante"
            >
              <div className="border-b border-borda px-3 py-2.5">
                <p className="truncate text-sm font-medium text-tinta">{sessao.usuario.nome}</p>
                <p className="truncate text-xs text-tinta-suave">{sessao.usuario.email}</p>
              </div>

              <Link
                href="/conta"
                role="menuitem"
                onClick={() => setMenuAberto(false)}
                className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-tinta transition-colors hover:bg-superficie-2"
              >
                <IconeConta className="h-4 w-4 shrink-0 opacity-70" />
                Conta e usuários
              </Link>

              <button
                type="button"
                role="menuitem"
                onClick={() => void aoSair()}
                disabled={saindo}
                className="flex w-full items-center gap-2.5 border-t border-borda px-3 py-2.5 text-left text-sm text-tinta transition-colors hover:bg-superficie-2 disabled:opacity-60"
              >
                <IconeSair className="h-4 w-4 shrink-0 opacity-70" />
                {saindo ? 'Saindo…' : 'Sair'}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
