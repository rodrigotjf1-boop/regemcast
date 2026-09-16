'use client';

import { Cabecalho } from '@/components/app/cabecalho';
import { SessaoProvider } from '@/components/app/sessao';

/** Casca das telas autenticadas: cabeçalho fixo + conteúdo. */
export default function LayoutApp({ children }: { children: React.ReactNode }) {
  return (
    <SessaoProvider>
      <div className="flex min-h-screen flex-col">
        <Cabecalho />
        <main id="conteudo" className="anima-entrada mx-auto w-full max-w-conteudo flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </div>
    </SessaoProvider>
  );
}
