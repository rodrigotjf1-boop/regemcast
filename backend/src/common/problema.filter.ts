/**
 * As recusas no formato do Padrão DMS (§7): `application/problem+json`, RFC 9457.
 *
 * Só pega `ErroProblema` (o erro do pacote comum, `dms/integracao-dms.ts`), e só
 * nos controladores que o declaram (`@UseFilters`): a porta MCP na via do DMS
 * ID e a troca pela ligação. O resto da API segue com o `ErroFilter` e o corpo
 * `{ mensagem }` que as telas leem.
 *
 * O motivo de um token recusado (vencido, outro destino, assinatura…) fica no
 * log local, nunca na resposta: para quem chama, todo token que não vale recebe
 * a mesma frase.
 */
import { Catch, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';

import { corpoProblema, ErroProblema, ErroTokenDmsId, TIPO_CONTEUDO_PROBLEMA } from '../dms/integracao-dms';

@Catch(ErroProblema)
export class ProblemaFilter implements ExceptionFilter {
  private readonly log = new Logger('Problema');

  catch(erro: ErroProblema, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();

    const motivo = erro instanceof ErroTokenDmsId ? ` (${erro.motivo})` : '';
    this.log.debug(`${req.method} ${req.path} → ${erro.status} ${erro.tipo}${motivo}`);

    if (erro.retryAfterSeg !== undefined) res.setHeader('Retry-After', String(Math.max(1, Math.ceil(erro.retryAfterSeg))));
    res
      .status(erro.status)
      .type(TIPO_CONTEUDO_PROBLEMA)
      .send(JSON.stringify(corpoProblema(erro.tipo, erro.detalhe, { status: erro.status })));
  }
}
