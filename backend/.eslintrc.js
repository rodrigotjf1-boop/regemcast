// ESLint 8 (formato legado), que é o que a versão instalada entende.
// Enxuto de propósito: o portão de qualidade real é o typecheck estrito + os
// testes. O lint aqui pega o que o compilador não pega.
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { project: 'tsconfig.json', sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, jest: true },
  ignorePatterns: ['dist/', 'node_modules/', '.eslintrc.js', 'scripts/'],
  rules: {
    // `any` é o começo de toda divergência silenciosa entre camadas — no Regem
    // os módulos de campanha e de template abrem com um eslint-disable global
    // de no-explicit-any, e é exatamente ali que os contratos divergiram.
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': 'error',
  },
};
