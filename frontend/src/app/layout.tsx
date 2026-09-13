import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'RegemCast',
    template: '%s · RegemCast',
  },
  description:
    'RegemCast dispara campanhas de WhatsApp pela API oficial da Meta, com modelos aprovados e controle de consumo.',
  applicationName: 'RegemCast',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Sem `maximumScale`: travar o zoom quebra quem precisa ampliar para ler.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-fundo text-tinta">
        <a className="pular-para-conteudo" href="#conteudo">
          Pular para o conteúdo
        </a>
        {children}
      </body>
    </html>
  );
}
