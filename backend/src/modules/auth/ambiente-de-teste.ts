/**
 * Defaults de ambiente para a suíte de testes.
 *
 * `config/env` é fail-fast: sem DATABASE_URL e JWT_SECRET, o simples import do
 * service derruba o jest antes do primeiro `it`. Este arquivo preenche APENAS
 * o que falta e APENAS em NODE_ENV=test (o jest define isso sozinho), então em
 * dev e em produção ele não muda nada.
 *
 * Precisa ser importado ANTES de qualquer coisa que leia `env` — o TypeScript
 * emite os imports na ordem em que aparecem.
 */
if (process.env.NODE_ENV === 'test') {
  process.env.DATABASE_URL ??= 'postgres://regemcast_app:teste@localhost:5432/regemcast_teste';
  process.env.JWT_SECRET ??= 'segredo-so-de-teste-sem-valor-em-producao';
}

export {};
