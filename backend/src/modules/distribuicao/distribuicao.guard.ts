/**
 * Portão do console de distribuição.
 *
 * Só passa quem tem sessão de operador com as duas etapas concluídas. A rota
 * também precisa de `@Publico()`, para escapar do guard de CLIENTE — sem isso,
 * o guard global recusaria o operador por não ter sessão de cliente, e com a
 * sessão de cliente ele teria passado pelo portão errado.
 */
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import { DistribuicaoAuthService } from './distribuicao-auth.service';
import { nomeCookieSessao } from './cookie-distribuicao';

export interface OperadorAutenticado {
  id: string;
  nome: string;
  email: string;
}

export interface RequestDeOperador extends Request {
  operador?: OperadorAutenticado;
}

@Injectable()
export class DistribuicaoGuard implements CanActivate {
  constructor(private readonly auth: DistribuicaoAuthService) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const req = contexto.switchToHttp().getRequest<RequestDeOperador>();
    const token = (req.cookies as Record<string, string> | undefined)?.[nomeCookieSessao()];

    if (!token) throw new UnauthorizedException('Entre como operador para continuar.');

    // Revalida no banco a cada request: suspender um operador corta o acesso na
    // próxima chamada, e não quando o cookie expirar horas depois.
    req.operador = await this.auth.validarSessao(token);
    return true;
  }
}
