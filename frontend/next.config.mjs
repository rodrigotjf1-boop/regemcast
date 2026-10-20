/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // A página da autorização por clique não abre dentro de moldura de outro site: um clique "por baixo" de uma página
  // falsa autorizaria um aplicativo sem a pessoa ver (clickjacking).
  async headers() {
    return [
      {
        source: '/integracoes/autorizar',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};
export default nextConfig;
