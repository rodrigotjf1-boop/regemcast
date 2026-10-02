/**
 * A porta MCP: `POST /api/v1/mcp`.
 *
 * O portão (`IntegracaoGuard`) reconhece o token e aplica o limite por token;
 * daqui o pedido vai para o SDK oficial como um `Request` padrão da web, com o
 * corpo já lido pelo Express e SEM os cabeçalhos de credencial — o token em
 * claro não passa da porta. A resposta do SDK volta como veio.
 *
 * GET e DELETE (operações de sessão da geração 2025) não existem num servidor
 * sem estado: 405.
 */
import { All, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Readable } from 'node:stream';

import { Publico } from '../../common/publico.decorator';
import { IntegracaoGuard, type RequestDeIntegracao } from './integracao.guard';
import { McpServidor } from './mcp.servidor';

/** Cabeçalhos que não seguem para o SDK: credencial e o que o Node recalcula. */
const FICAM_NA_PORTA = new Set(['authorization', 'cookie', 'host', 'connection', 'content-length', 'transfer-encoding']);

@ApiExcludeController()
@Controller('mcp')
@Publico()
@SkipThrottle()
export class McpController {
  constructor(private readonly mcp: McpServidor) {}

  @Post()
  @UseGuards(IntegracaoGuard)
  async pedir(@Req() req: RequestDeIntegracao, @Res() res: Response): Promise<void> {
    const cabecalhos = new Headers();
    for (const [nome, valor] of Object.entries(req.headers)) {
      if (FICAM_NA_PORTA.has(nome.toLowerCase()) || valor === undefined) continue;
      cabecalhos.set(nome, Array.isArray(valor) ? valor.join(', ') : valor);
    }
    const url = `${req.protocol}://${req.get('host') ?? 'localhost'}${req.originalUrl}`;
    const pedido = new Request(url, { method: 'POST', headers: cabecalhos });

    const r = await this.mcp.handler.fetch(pedido, {
      authInfo: McpServidor.autorizacao(req.integracao!),
      parsedBody: req.body,
    });

    res.status(r.status);
    r.headers.forEach((valor, nome) => res.setHeader(nome, valor));
    if (!r.body) {
      res.end();
      return;
    }
    Readable.fromWeb(r.body as import('node:stream/web').ReadableStream).pipe(res);
  }

  /** Sem sessão, não há o que abrir nem fechar. */
  @All()
  @HttpCode(HttpStatus.METHOD_NOT_ALLOWED)
  semSessao(@Res() res: Response): void {
    res.setHeader('Allow', 'POST');
    res.status(HttpStatus.METHOD_NOT_ALLOWED).json({ mensagem: 'Este servidor MCP é sem estado: só aceita POST.' });
  }
}
