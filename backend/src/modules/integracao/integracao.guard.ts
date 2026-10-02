/**
 * O portão da porta MCP: só passa quem traz um token de integração válido.
 *
 * A rota também leva `@Publico()` (para escapar do guard de cliente, que
 * recusaria por falta de sessão) e `@SkipThrottle()` (o teto global é por IP,
 * e um produto da DMS chega de UM endereço para todas as contas: o teto de IP
 * viraria teto do produto inteiro). O limite daqui é por TOKEN, no mesmo
 * armazenamento do limite global — Redis em produção, para valer entre
 * réplicas e sobreviver a deploy.
 */
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectThrottlerStorage, type ThrottlerStorage } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { tokenDoCabecalho } from './integracao.regras';
import { IntegracaoService, type IntegracaoAutenticada } from './integracao.service';

/** Chamadas por minuto, por token. */
export const LIMITE_POR_MINUTO = 120;
const JANELA_MS = 60_000;

export interface RequestDeIntegracao extends Request {
  integracao?: IntegracaoAutenticada;
}

@Injectable()
export class IntegracaoGuard implements CanActivate {
  constructor(
    private readonly integracoes: IntegracaoService,
    @InjectThrottlerStorage() private readonly limites: ThrottlerStorage,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const http = contexto.switchToHttp();
    const req = http.getRequest<RequestDeIntegracao>();
    const res = http.getResponse<Response>();

    const token = tokenDoCabecalho(req.headers.authorization);
    if (!token) {
      // O cabeçalho que a especificação pede na recusa: diz ao cliente que a porta quer um Bearer.
      res.setHeader('WWW-Authenticate', 'Bearer');
      throw new UnauthorizedException('Informe o token de integração no cabeçalho Authorization.');
    }

    let quem: IntegracaoAutenticada;
    try {
      quem = await this.integracoes.autenticar(token);
    } catch (erro) {
      if (erro instanceof UnauthorizedException) res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      throw erro;
    }

    const uso = await this.limites.increment(`integracao:${quem.tokenId}`, JANELA_MS, LIMITE_POR_MINUTO, JANELA_MS, 'integracao');
    if (uso.isBlocked) {
      res.setHeader('Retry-After', String(Math.max(1, uso.timeToBlockExpire || uso.timeToExpire)));
      throw new HttpException(
        `Limite de ${LIMITE_POR_MINUTO} chamadas por minuto atingido para este token. Tente de novo em instantes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    req.integracao = quem;
    return true;
  }
}
