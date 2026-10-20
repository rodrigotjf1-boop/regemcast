/**
 * A autorização por clique, do lado do aplicativo (de servidor para servidor),
 * com o token do DMS ID no `Authorization`:
 *
 * - `POST /api/v1/integracao/autorizacao/pedido` — o pedido empurrado (RFC
 *   9126): devolve `{ request_uri, expires_in }`;
 * - `POST /api/v1/integracao/autorizacao/token` — a troca do código (RFC 6749
 *   §4.1.3, com o verificador PKCE): devolve o segredo da ligação, no mesmo
 *   formato da troca automática (`/api/v1/dms-id/ligacao`).
 *
 * Corpo em formulário (`application/x-www-form-urlencoded`, o das RFCs) ou JSON.
 * Desligada (`AUTORIZACAO_POR_CLIQUE`), as duas respondem 404. As recusas saem em
 * `application/problem+json` (`ProblemaFilter`), e cada chamada vai ao registro do
 * hub (`RegistroDaPorta`), sem o código, o verificador nem o segredo.
 */
import { Body, Controller, Header, HttpCode, HttpStatus, Post, Req, Res, UseFilters } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { ProblemaFilter } from '../../common/problema.filter';
import { Publico } from '../../common/publico.decorator';
import { ErroProblema, type TokenDmsId } from '../../dms/integracao-dms';
import { anotarChamada } from '../hub/chamada-atual';
import { AutorizacaoService, type CorpoDaTroca } from './autorizacao.service';
import type { CorpoDoPedido } from './autorizacao.regras';
import { DmsIdService } from './dms-id.service';
import type { LigacaoEntregue } from './integracao.service';
import { bearerDoCabecalho, desafioDaRecusa } from './ligacao.regras';

const DESLIGADA = 'A autorização por clique não está ligada neste ambiente.';

/** O corpo como objeto: o que não for objeto vira vazio, e a conferência diz o que falta. */
const objeto = (corpo: unknown): Record<string, unknown> => (corpo !== null && typeof corpo === 'object' && !Array.isArray(corpo) ? (corpo as Record<string, unknown>) : {});

@ApiExcludeController()
@Controller('integracao/autorizacao')
@Publico()
@UseFilters(ProblemaFilter)
export class AutorizacaoPortaController {
  constructor(
    private readonly dmsId: DmsIdService,
    private readonly autorizacoes: AutorizacaoService,
  ) {}

  @Post('pedido')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  async pedido(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() corpo: unknown): Promise<{ request_uri: string; expires_in: number }> {
    anotarChamada({ ferramenta: 'autorizacao.pedido', credencial: 'dms_id' });
    if (!this.autorizacoes.ligada) throw new ErroProblema('nao-encontrado', DESLIGADA);
    const doToken = await this.conferir(req, res);
    return this.autorizacoes.criarPedido(objeto(corpo) as CorpoDoPedido, doToken);
  }

  @Post('token')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  async token(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() corpo: unknown): Promise<LigacaoEntregue> {
    anotarChamada({ ferramenta: 'autorizacao.token', credencial: 'dms_id' });
    if (!this.autorizacoes.ligada) throw new ErroProblema('nao-encontrado', DESLIGADA);
    const doToken = await this.conferir(req, res);
    return this.autorizacoes.trocarCodigo(objeto(corpo) as CorpoDaTroca, doToken);
  }

  /** O token do DMS ID (sem ele, ou torto, nada do corpo é olhado), com o desafio da recusa como na porta MCP. */
  private async conferir(req: Request, res: Response): Promise<TokenDmsId> {
    const bearer = bearerDoCabecalho(req.headers.authorization);
    try {
      return await this.dmsId.conferir(bearer);
    } catch (erro) {
      const desafio = desafioDaRecusa(erro, bearer !== null, this.dmsId.enderecoDosMetadados());
      if (desafio) res.setHeader('WWW-Authenticate', desafio);
      throw erro;
    }
  }
}
