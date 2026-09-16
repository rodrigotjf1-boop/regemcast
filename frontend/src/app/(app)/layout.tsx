'use client';

import { Casca } from '@/components/app/casca';
import { SessaoProvider } from '@/components/app/sessao';

/** Casca das telas autenticadas: barra lateral + área de trabalho. */
export default function LayoutApp({ children }: { children: React.ReactNode }) {
  return (
    <SessaoProvider>
      <Casca>{children}</Casca>
    </SessaoProvider>
  );
}
