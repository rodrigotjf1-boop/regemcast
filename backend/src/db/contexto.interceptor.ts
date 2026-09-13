/**
 * Abre a transação de banco da requisição, já isolada na conta do usuário.
 *
 * Toda rota autenticada roda dentro de uma transação com `app.conta_id`
 * definido — é isso que faz a RLS valer. Rotas `@Publico()` passam sem abrir
 * transação: elas mesmas decidem o escopo (login usa `comEscopoSistema`, o
 * webhook da Meta resolve a conta pelo `phone_number_id` e depois entra em
 * `comConta`).
 *
 * Trade-off consciente: a transação vive pelo request inteiro, então uma rota
 * lenta segura uma conexão do pool. Vale enquanto as rotas forem curtas — todo
 * trabalho demorado (import de contatos, disparo) é job de fila, não request.
 * Se uma rota precisar ficar de pé por muito tempo, ela sai do interceptor e
 * abre contextos pontuais.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, defaultIfEmpty, firstValueFrom, from } from 'rxjs';

import type { RequestAutenticado } from '../common/auth.guard';
import { ContextoDb } from './contexto';

@Injectable()
export class ContextoInterceptor implements NestInterceptor {
  constructor(private readonly ctx: ContextoDb) {}

  intercept(contexto: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = contexto.switchToHttp().getRequest<RequestAutenticado>();
    const contaId = req.usuario?.contaId;
    if (!contaId) return next.handle();

    return from(
      this.ctx.comConta(contaId, async () =>
        // defaultIfEmpty cobre o handler que responde 204 sem emitir valor —
        // sem ele, firstValueFrom rejeitaria com EmptyError e a transação
        // rolaria para trás por engano.
        firstValueFrom(next.handle().pipe(defaultIfEmpty(undefined))),
      ),
    );
  }
}
