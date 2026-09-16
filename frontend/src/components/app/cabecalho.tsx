'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { useSessao } from '@/components/app/sessao';
import { Logotipo } from '@/components/marca/logotipo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

const ITENS: ReadonlyArray<{ href: string; rotulo: string }> = [
  { href: '/painel', rotulo: 'Painel' },
  { href: '/whatsapp', rotulo: 'WhatsApp' },
  { href: '/modelos', rotulo: 'Modelos' },
  { href: '/conta', rotulo: 'Conta' },
];

export function Cabecalho() {
  const { sessao, sair } = useSessao();
  const caminho = usePathname();
  const [saindo, setSaindo] = useState(false);

  const ativo = (href: string) => caminho === href || caminho.startsWith(href + '/');

  async function aoSair() {
    setSaindo(true);
    await sair();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-borda bg-superficie/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-conteudo flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/painel" className="rounded-lg">
          <Logotipo />
        </Link>

        <nav aria-label="Seções" className="order-3 -mx-1 w-full overflow-x-auto sm:order-2 sm:mx-0 sm:w-auto">
          <ul className="flex items-center gap-1 px-1">
            {ITENS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={ativo(item.href) ? 'page' : undefined}
                  className={cn(
                    'inline-flex h-8 items-center whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors',
                    ativo(item.href)
                      ? 'bg-acento-suave text-acento-forte'
                      : 'text-tinta-suave hover:bg-superficie-2 hover:text-tinta',
                  )}
                >
                  {item.rotulo}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="order-2 ml-auto flex items-center gap-3 sm:order-3">
          <span className="hidden text-sm text-tinta-suave sm:inline" title={sessao.usuario.email}>
            {sessao.usuario.nome}
          </span>
          <Button variante="secundario" tamanho="sm" carregando={saindo} onClick={() => void aoSair()}>
            Sair
          </Button>
        </div>
      </div>
    </header>
  );
}
