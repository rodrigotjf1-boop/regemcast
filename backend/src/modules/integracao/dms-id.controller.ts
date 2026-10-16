/**
 * A via do DMS ID (Hub DMS, F2, etapa A2), fora da porta MCP em si:
 *
 * - `GET /.well-known/oauth-protected-resource/api/v1/mcp` — os metadados do
 *   recurso protegido (RFC 9728), FORA do prefixo `/api/v1` (`main.ts`). É por
 *   eles que o cliente MCP acha o DMS ID: o 401 da porta aponta para cá.
 * - `POST /api/v1/dms-id/ligacao` — a troca automática (decisão F2-3): o
 *   aplicativo manda o token do DMS ID dele e o `rct_it_` que já usa na conta
 *   (`{ "token_integracao": "rct_it_…" }`), e recebe o segredo da ligação.
 *
 * Desligado (`DMS_ID_LIGADO`), as duas respondem 404. As recusas saem em
 * `application/problem+json` (`ProblemaFilter`).
 */
import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Req, Res, UseFilters } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { ProblemaFilter } from '../../common/problema.filter';
import { Publico } from '../../common/publico.decorator';
import { ErroProblema } from '../../dms/integracao-dms';
import { DmsIdService } from './dms-id.service';
import { IntegracaoService, type LigacaoEntregue } from './integracao.service';
import { bearerDoCabecalho, CAMINHO_DOS_METADADOS, desafioDaRecusa } from './ligacao.regras';

const DESLIGADA = 'A via do DMS ID não está ligada neste ambiente. Use o token de integração.';

@ApiExcludeController()
@Controller()
@Publico()
@UseFilters(ProblemaFilter)
export class DmsIdController {
  constructor(
    private readonly dmsId: DmsIdService,
    private readonly integracoes: IntegracaoService,
  ) {}

  @Get(CAMINHO_DOS_METADADOS)
  @Header('Cache-Control', 'public, max-age=300')
  metadados() {
    if (!this.dmsId.ligado) throw new ErroProblema('nao-encontrado', DESLIGADA);
    return this.dmsId.metadados();
  }

  @Post('dms-id/ligacao')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async trocar(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() corpo: unknown): Promise<LigacaoEntregue> {
    if (!this.dmsId.ligado) throw new ErroProblema('nao-encontrado', DESLIGADA);
    const bearer = bearerDoCabecalho(req.headers.authorization);
    try {
      const doToken = await this.dmsId.conferir(bearer);
      const tokenIntegracao = corpo !== null && typeof corpo === 'object' ? (corpo as { token_integracao?: unknown }).token_integracao : undefined;
      return await this.integracoes.trocarPorLigacao(tokenIntegracao, doToken.aplicativo, this.dmsId.aplicativos);
    } catch (erro) {
      const desafio = desafioDaRecusa(erro, bearer !== null, this.dmsId.enderecoDosMetadados());
      if (desafio) res.setHeader('WWW-Authenticate', desafio);
      throw erro;
    }
  }
}
