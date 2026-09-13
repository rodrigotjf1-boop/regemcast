/**
 * Rotas de saúde.
 *
 * Duas são anônimas e ficam expostas na internet — então o corpo delas é o
 * mínimo necessário para a decisão de quem pergunta ("posso mandar tráfego?"):
 * `{postgres, redis}` e o código HTTP. O diagnóstico completo (nome, mensagem,
 * SQLSTATE e `detail` do driver) fica no LOG e em `/saude/pronto/detalhe`,
 * atrás do token do console de distribuição.
 *
 * O que se ganha com isso: com o Redis fora, o corpo antigo devolvia
 * `connect ECONNREFUSED 10.0.0.5:6379` para qualquer um — host, porta e um
 * pedaço da topologia interna de graça, numa rota sem autenticação e sem
 * throttle.
 */
import {
  Controller,
  Get,
  HttpStatus,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Publico } from '../../common/publico.decorator';
import {
  CABECALHO_DIST_TOKEN,
  DistTokenGuard,
} from '../lista-espera/dist-token.guard';
import {
  SaudeService,
  type CorpoPronto,
  type CorpoProntoDetalhado,
  type CorpoVivo,
} from './saude.service';

/**
 * `@SkipThrottle()` no controller inteiro: a sonda do Docker bate a cada
 * poucos segundos, sempre do mesmo IP. Sob o teto global ela acabaria tomando
 * 429 — e um 429 é resposta de serviço doente para qualquer orquestrador, que
 * reiniciaria um contêiner perfeitamente saudável. A rota de diagnóstico não
 * é sonda de ninguém e devolve o skip com `@SkipThrottle({ default: false })`.
 */
@ApiTags('saúde')
@SkipThrottle()
@Controller('saude')
export class SaudeController {
  constructor(private readonly saude: SaudeService) {}

  @Publico()
  @Get()
  @ApiOperation({
    summary: 'O processo está de pé (liveness).',
    description:
      'Não toca no banco: é o alvo do healthcheck do contêiner. O corpo não ' +
      'traz a versão do build — ela diz qual release está no ar e, com ela, ' +
      'quais correções ainda não estão. Para vê-la, use /saude/pronto/detalhe.',
  })
  vivo(): CorpoVivo {
    return this.saude.vivo();
  }

  @Publico()
  @Get('pronto')
  @ApiOperation({
    summary: 'Dá para trabalhar (readiness): Postgres e Redis respondendo.',
    description:
      'O corpo diz apenas QUAL dependência falhou. O motivo real vai para o ' +
      'log e para /saude/pronto/detalhe, que exige o token do console.',
  })
  @ApiResponse({ status: 200, description: 'Dependências de pé.' })
  @ApiResponse({
    status: 503,
    description: 'Alguma dependência falhou; o motivo está no log.',
  })
  async pronto(
    // `passthrough` para escolher 200 ou 503 mantendo a serialização do Nest.
    // Uma exceção aqui passaria pelo filtro global e trocaria o corpo pelo
    // envelope de erro padrão — a sonda perderia o veredito por dependência.
    @Res({ passthrough: true }) res: Response,
  ): Promise<CorpoPronto> {
    const { ok, publico } = await this.saude.pronto();
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return publico;
  }

  /**
   * Mesma checagem da rota acima, com o motivo real junto. É nossa, não do
   * cliente: só entra com o token do console de distribuição.
   */
  @Publico()
  @UseGuards(DistTokenGuard)
  // Devolve o throttle que o `@SkipThrottle()` da classe tirou: aqui não há
  // sonda batendo de segundo em segundo, e um endpoint de diagnóstico sem teto
  // vira alavanca para descobrir o token na tentativa e erro.
  @SkipThrottle({ default: false })
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiHeader({
    name: CABECALHO_DIST_TOKEN,
    required: true,
    description: 'Token do console.',
  })
  @Get('pronto/detalhe')
  @ApiOperation({
    summary: 'O mesmo readiness, com o motivo real da falha.',
    description:
      'Traz nome, mensagem, código e detalhe do erro, mais a versão do build. ' +
      'O status HTTP acompanha o da sonda pública: 503 quando algo falhou.',
  })
  @ApiResponse({ status: 401, description: 'Token do console ausente ou inválido.' })
  @ApiResponse({ status: 503, description: 'DIST_TOKEN não configurado, ou dependência fora.' })
  async prontoDetalhe(
    @Res({ passthrough: true }) res: Response,
  ): Promise<CorpoProntoDetalhado> {
    const { ok, detalhado } = await this.saude.pronto();
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return detalhado;
  }
}
