/**
 * Cookie da pré-sessão: o intervalo entre a senha aceita e o código.
 *
 * Mais fechado que o cookie de sessão, porque só serve a UM passo:
 *
 * - **Caminho `/api/v1/auth/login`.** O navegador só o manda para as rotas do
 *   próprio login (`/login/codigo`, `/login/reenviar`), nunca para o resto da API.
 * - **`sameSite: 'strict'`.** Ninguém chega ao passo do código por link de fora.
 * - **5 minutos.** Esqueceu a tela aberta, recomeça pela senha.
 */
import type { CookieOptions, Request, Response } from 'express';

import { env } from '../../config/env';
import { MINUTOS_PRE_SESSAO } from './segunda-etapa.service';

const CAMINHO = '/api/v1/auth/login';

function opcoes(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.producao,
    sameSite: 'strict',
    path: CAMINHO,
    ...(env.sessao.cookieDominio ? { domain: env.sessao.cookieDominio } : {}),
  };
}

const nome = () => `${env.sessao.cookieNome}_pre`;

export function gravarCookiePreLogin(res: Response, token: string): void {
  res.cookie(nome(), token, { ...opcoes(), maxAge: MINUTOS_PRE_SESSAO * 60_000 });
}

export function limparCookiePreLogin(res: Response): void {
  res.clearCookie(nome(), opcoes());
}

export function lerCookiePreLogin(req: Request): string | undefined {
  return (req.cookies as Record<string, string> | undefined)?.[nome()];
}
