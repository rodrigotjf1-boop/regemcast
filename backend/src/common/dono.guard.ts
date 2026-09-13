import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

import type { RequestAutenticado } from './auth.guard';

/** Restringe a rota ao dono da conta. Operador recebe 403. */
@Injectable()
export class DonoGuard implements CanActivate {
  canActivate(contexto: ExecutionContext): boolean {
    const req = contexto.switchToHttp().getRequest<RequestAutenticado>();
    if (req.usuario?.papel !== 'dono') {
      throw new ForbiddenException('Só o dono da conta pode fazer isso.');
    }
    return true;
  }
}
