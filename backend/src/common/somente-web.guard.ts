/**
 * Rotas que o aplicativo do celular NÃO executa.
 *
 * Montar campanha fica na web por decisão de produto: é a tela longa, com
 * prévia e conferência antes de gastar disparo. Criar modelo saiu desta lista
 * em 29/09/2026 — o app ganhou o editor completo, com a mesma conferência do
 * servidor.
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
