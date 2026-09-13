import type { Config } from 'tailwindcss';

/**
 * A paleta REAL mora em `src/app/globals.css`, como custom properties.
 * Aqui só existe o nome do token -> a variável. Trocar a marca (logo e cores
 * ainda vão chegar) é editar um bloco de CSS, não caçar cor crua em componente.
 *
 * As variáveis guardam CANAIS ("16 25 28"), e não "#10191C", porque é isso que
 * permite `bg-acento/10`, `text-tinta/60` etc. continuarem funcionando.
 */
const cor = (nome: string) => `rgb(var(--${nome}) / <alpha-value>)`;

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        fundo: cor('cor-fundo'),
        superficie: cor('cor-superficie'),
        'superficie-2': cor('cor-superficie-2'),
        tinta: cor('cor-tinta'),
        'tinta-suave': cor('cor-tinta-suave'),
        borda: cor('cor-borda'),
        acento: cor('cor-acento'),
        'acento-forte': cor('cor-acento-forte'),
        'acento-suave': cor('cor-acento-suave'),
        'acento-contraste': cor('cor-acento-contraste'),
        sucesso: cor('cor-sucesso'),
        atencao: cor('cor-atencao'),
        erro: cor('cor-erro'),
      },
      fontFamily: {
        // Pilha do sistema até a marca chegar. Ver comentário em globals.css.
        sans: ['var(--fonte-corpo)'],
        mono: ['var(--fonte-mono)'],
      },
      borderRadius: {
        card: '0.875rem',
      },
      boxShadow: {
        card: '0 1px 2px rgb(var(--cor-sombra) / 0.06), 0 8px 24px -12px rgb(var(--cor-sombra) / 0.18)',
      },
      maxWidth: {
        conteudo: '72rem',
      },
    },
  },
  plugins: [],
};

export default config;
