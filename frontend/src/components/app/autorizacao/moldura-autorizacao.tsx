import type { ReactNode } from 'react';

import { Logotipo } from '@/components/marca/logotipo';

/**
 * A moldura da página de autorização: só a barra do Regemcast no topo, sem o
 * menu (decisão B1-1). A pessoa vem de outro produto para uma decisão só; o menu
 * inteiro distrai e convida a sair no meio.
 */
export function MolduraAutorizacao({
  contaNome,
  pessoa,
  children,
}: {
  contaNome?: string | null;
  pessoa?: { nome: string; papel: string } | null;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-fundo">
      <header className="flex items-center justify-between gap-3 bg-lateral px-4 py-2.5 sm:px-6">
        <Logotipo sobreEscuro />
        {contaNome ? (
          <div className="min-w-0 text-right leading-tight">
            <p className="truncate text-sm font-semibold text-lateral-tinta">{contaNome}</p>
            {pessoa ? (
              <p className="hidden text-xs text-lateral-suave sm:block">
                {pessoa.nome} · {pessoa.papel}
              </p>
            ) : null}
          </div>
        ) : null}
      </header>
      <main id="conteudo" className="flex justify-center px-3 pb-10 pt-6 sm:px-4 sm:pt-8">
        {children}
      </main>
    </div>
  );
}
