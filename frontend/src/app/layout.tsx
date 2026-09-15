import type { Metadata, Viewport } from 'next';

import { ConfigRuntimeScript } from '@/lib/config-runtime';

import './globals.css';

/**
 * Textos de marca seguem `kit/LEIA-ME.md`, seção "Regras de marca em relação à
 * Meta / WhatsApp":
 *
 * - "WhatsApp" não entra no NOME do produto, no ícone nem no domínio. Pode
 *   aparecer em descrição — e, quando aparece, é no descritor exato abaixo.
 * - Nada de prometer selo verificado: quem concede é a Meta, para a conta do
 *   cliente, não o app.
 */
const DESCRITOR = 'Integração via API Oficial do WhatsApp Business';

export const metadata: Metadata = {
  title: {
    default: 'Regemcast',
    template: '%s · Regemcast',
  },
  description: `Regemcast — disparos e campanhas. ${DESCRITOR}.`,
  applicationName: 'Regemcast',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { url: '/favicon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/favicon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Regemcast',
    description: `Disparos e campanhas. ${DESCRITOR}.`,
    images: [{ url: '/marca/og.png', width: 1200, height: 630, alt: 'Regemcast' }],
    locale: 'pt_BR',
    type: 'website',
  },
  // O painel não é conteúdo público; a landing, quando existir, terá regra
  // própria.
  robots: { index: false, follow: false },
};

/**
 * Renderiza a cada requisição, em vez de no build.
 *
 * Sem isto o Next pré-renderiza as páginas no build, e o `ConfigRuntimeScript`
 * seria avaliado ali — congelando no HTML o endereço da API que existia na
 * máquina de build. Foi exatamente o que aconteceu no primeiro teste: o
 * container subia com `API_URL_PUBLICA` de produção e servia `localhost`.
 *
 * O custo é zero na prática: todas as telas daqui são de aplicação, nenhuma é
 * conteúdo que se beneficie de cache estático.
 */
export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Sem `maximumScale`: travar o zoom quebra quem precisa ampliar para ler.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFF3EA' },
    { media: '(prefers-color-scheme: dark)', color: '#2B1B3D' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-fundo text-tinta">
        {/* Antes de qualquer script da aplicação: o cliente HTTP lê daqui o
            endereço da API. Ver lib/config-runtime. */}
        <ConfigRuntimeScript />
        <a className="pular-para-conteudo" href="#conteudo">
          Pular para o conteúdo
        </a>
        {children}
      </body>
    </html>
  );
}
