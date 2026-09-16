/**
 * Cookies da distribuição.
 *
 * Duas diferenças em relação ao cookie do cliente, as duas para encolher o que
 * um vazamento alcança:
 *
 * - **Caminho restrito a `/api/v1/distribuicao`.** O navegador nunca envia a
 *   sessão de operador para as rotas de cliente. Um defeito numa rota comum não
 *   tem como ler nem reaproveitar esse cookie.
 * - **`sameSite: 'strict'`.** O cliente usa `lax` para que o clique num link
 *   externo chegue logado. O console não tem esse caso: ninguém chega nele por
 *   link de fora, e `strict` fecha a porta de CSRF por completo.
 *
 * A pré-sessão (entre a senha e o código) também é cookie httpOnly, e não campo
 * no corpo da resposta: token no JSON é token que qualquer script da página lê.
 */
import type { CookieOptions, Response } from 'express';

import { env } from '../../config/env';

export const CAMINHO_DISTRIBUICAO = '/api/v1/distribuicao';

function opcoes(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.producao,
    sameSite: 'strict',
    path: CAMINHO_DISTRIBUICAO,
    ...(env.sessao.cookieDominio ? { domain: env.sessao.cookieDominio } : {}),
  };
}

export const nomeCookieSessao = () => env.distribuicao.cookieNome;
export const nomeCookiePre = () => `${env.distribuicao.cookieNome}_pre`;

export function gravarSessao(res: Response, token: string): void {
  res.cookie(nomeCookieSessao(), token, { ...opcoes(), maxAge: env.distribuicao.ttlHoras * 3_600_000 });
  // A pré-sessão já cumpriu o papel. Deixá-la viva seria manter um segundo
  // caminho aberto até ela expirar.
  res.clearCookie(nomeCookiePre(), opcoes());
}

export function gravarPre(res: Response, token: string): void {
  res.cookie(nomeCookiePre(), token, { ...opcoes(), maxAge: 5 * 60_000 });
}

export function limparTudo(res: Response): void {
  res.clearCookie(nomeCookieSessao(), opcoes());
  res.clearCookie(nomeCookiePre(), opcoes());
}
