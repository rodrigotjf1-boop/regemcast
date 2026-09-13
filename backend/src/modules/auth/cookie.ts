/**
 * O cookie de sessão, num lugar só.
 *
 * Gravar e limpar usam EXATAMENTE as mesmas opções de path e domínio de
 * propósito: o navegador só apaga um cookie quando path e domain batem. Quando
 * as duas chamadas divergem, o "sair" responde 200 e o cookie continua lá — o
 * usuário acha que saiu e não saiu.
 */
import type { CookieOptions, Response } from 'express';

import { env } from '../../config/env';

function opcoesBase(): CookieOptions {
  return {
    httpOnly: true,
    // Em produção o cookie só viaja por HTTPS. Em dev-local (http) `secure`
    // impediria o login de funcionar.
    secure: env.producao,
    // 'lax' deixa o clique num link externo chegar autenticado e continua
    // barrando POST de outro site (CSRF).
    sameSite: 'lax',
    path: '/',
    ...(env.sessao.cookieDominio ? { domain: env.sessao.cookieDominio } : {}),
  };
}

export function gravarCookieSessao(res: Response, token: string): void {
  res.cookie(env.sessao.cookieNome, token, {
    ...opcoesBase(),
    maxAge: env.sessao.ttlHoras * 3_600_000,
  });
}

export function limparCookieSessao(res: Response): void {
  res.clearCookie(env.sessao.cookieNome, opcoesBase());
}
