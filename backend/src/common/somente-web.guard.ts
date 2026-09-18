/**
 * Rotas que o aplicativo do celular NÃO executa.
 *
 * Criar modelo e montar campanha ficam na web por decisão de produto: são as
 * duas telas longas, com prévia, regras da Meta e conferência antes de gastar
 * disparo — e fazê-las no celular convida ao erro caro.
 *
 * A regra vive AQUI, e não na tela do app, porque o app guarda um token: quem
 * extrair esse token do aparelho falaria direto com a API, e uma restrição que
 * só existe na interface não é restrição nenhuma.
 *
 * Sessão antiga, sem escopo, é `web` — ninguém perde acesso por causa disto.
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

import type { RequestAutenticado } from './auth.guard';

@Injectable()
export class SomenteWebGuard implements CanActivate {
  canActivate(contexto: ExecutionContext): boolean {
    const req = contexto.switchToHttp().getRequest<RequestAutenticado>();

    if (req.usuario?.escopo === 'app') {
      throw new ForbiddenException(
        'Esta ação é feita no computador, pelo navegador. No aplicativo você acompanha, dispara, pausa e edita o que já existe.',
      );
    }

    return true;
  }
}
