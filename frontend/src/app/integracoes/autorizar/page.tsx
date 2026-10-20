import type { Metadata } from 'next';

import { AutorizarTela } from '@/components/app/autorizacao/autorizar-tela';
import { SessaoProvider } from '@/components/app/sessao';

export const metadata: Metadata = {
  title: 'Autorizar aplicativo · Regemcast',
  robots: { index: false, follow: false },
};

/**
 * A página da autorização por clique (Hub DMS B1), FORA do grupo `(app)`: sem o
 * menu, só a barra do Regemcast (decisão B1-1). A sessão é a de sempre; sem ela,
 * a pessoa entra e volta para cá (`/entrar?de=…`).
 */
export default function PaginaAutorizar() {
  return (
    <SessaoProvider>
      <AutorizarTela />
    </SessaoProvider>
  );
}
