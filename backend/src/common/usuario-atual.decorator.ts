import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { RequestAutenticado, UsuarioAutenticado } from './auth.guard';

/** O usuário da sessão, já revalidado no banco pelo guard global. */
export const UsuarioAtual = createParamDecorator(
  (_dados: unknown, contexto: ExecutionContext): UsuarioAutenticado => {
    const req = contexto.switchToHttp().getRequest<RequestAutenticado>();
    if (!req.usuario) {
      // Só acontece se alguém usar o decorator numa rota @Publico().
      throw new Error('Rota sem usuário autenticado usou @UsuarioAtual().');
    }
    return req.usuario;
  },
);
