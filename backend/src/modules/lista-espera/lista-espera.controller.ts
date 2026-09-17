/**
 * Rotas da fila de entrada.
 *
 * DOIS PÚBLICOS, no mesmo controller:
 *   - `POST /lista-espera` é do MUNDO: anônimo, apertado no throttle e
 *     idempotente.
 *   - o resto é da DISTRIBUIÇÃO (nós): enxerga a fila inteira e emite convite,
 *     atrás do `DistTokenGuard`.
 *
 * O `@Publico()` aparece em toda rota, uma por uma, em vez de no controller
 * inteiro: `grep -rn "@Publico" src/` precisa listar a superfície anônima da
 * API linha a linha, e um decorator na classe esconderia quatro rotas atrás de
 * uma só ocorrência.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { Publico } from '../../common/publico.decorator';
import { CABECALHO_DIST_TOKEN, DistTokenGuard } from './dist-token.guard';
import { ConvidarListaEsperaDto } from './dto/convidar-lista-espera.dto';
import { CriarListaEsperaDto } from './dto/criar-lista-espera.dto';
import { ListarListaEsperaDto } from './dto/listar-lista-espera.dto';
import { RecusarListaEsperaDto } from './dto/recusar-lista-espera.dto';
import {
  ListaEsperaService,
  type Capacidade,
  type OrigemRequest,
  type PaginaListaEspera,
  type RespostaCadastro,
  type RespostaConvite,
} from './lista-espera.service';
import type { StatusListaEspera } from './lista-espera.status';
import { ipDoCliente } from '../../common/ip-cliente';

/**
 * Extrai IP e user-agent para a auditoria.
 *
 * `ip` é validado porque a coluna é `inet`: um proxy mal configurado mandando
 * "unknown" no X-Forwarded-For faria o insert da auditoria estourar 22P02 e,
 * como a auditoria roda na mesma transação, derrubaria o cadastro público
 * inteiro. Melhor auditar sem IP do que perder o cadastro.
 */
function origemDoRequest(req: Request): OrigemRequest {
  const ip = ipDoCliente(req);
  const ua = req.headers['user-agent'];
  return {
    ip,
    // Header longo demais não tem valor de diagnóstico e engorda a tabela.
    userAgent: typeof ua === 'string' ? ua.slice(0, 300) : undefined,
  };
}

@ApiTags('lista de espera')
@Controller('lista-espera')
export class ListaEsperaController {
  constructor(private readonly servico: ListaEsperaService) {}

  // ---------------------------------------------------------------- público

  @Publico()
  // Cinco por minuto por IP. O teto global (120/min) não serve aqui: ele
  // deixaria alguém enfileirar 120 e-mails por minuto e usar a fila como
  // gerador de spam com o nosso domínio no remetente.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Entra na fila de espera.',
    description:
      'Idempotente por e-mail e sempre com a mesma resposta, exista ou não o ' +
      'cadastro — a rota é anônima e não pode virar consulta de "quem já se inscreveu".',
  })
  @ApiResponse({ status: 200, description: 'Pedido recebido.' })
  @ApiResponse({ status: 429, description: 'Muitas tentativas do mesmo IP.' })
  cadastrar(
    @Body() dto: CriarListaEsperaDto,
    @Req() req: Request,
  ): Promise<RespostaCadastro> {
    return this.servico.cadastrar(dto, origemDoRequest(req));
  }

  // ------------------------------------------------- console de distribuição

  @Publico()
  @UseGuards(DistTokenGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiHeader({ name: CABECALHO_DIST_TOKEN, required: true, description: 'Token do console.' })
  @Get('capacidade')
  @ApiOperation({
    summary: 'Quantos convites ainda cabem na janela de 7 dias da Meta.',
  })
  capacidade(): Promise<Capacidade> {
    return this.servico.capacidade();
  }

  @Publico()
  @UseGuards(DistTokenGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiHeader({ name: CABECALHO_DIST_TOKEN, required: true, description: 'Token do console.' })
  @Get()
  @ApiOperation({ summary: 'Lista a fila, em ordem de chegada.' })
  listar(@Query() filtro: ListarListaEsperaDto): Promise<PaginaListaEspera> {
    return this.servico.listar(filtro);
  }

  @Publico()
  @UseGuards(DistTokenGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiHeader({ name: CABECALHO_DIST_TOKEN, required: true, description: 'Token do console.' })
  @Post(':id/convidar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Emite o convite e devolve o link.',
    description: 'O link volta uma única vez: no banco fica só o sha256 do token.',
  })
  @ApiResponse({ status: 409, description: 'Janela de 7 dias cheia ou pedido já convertido.' })
  convidar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvidarListaEsperaDto,
    @Req() req: Request,
  ): Promise<RespostaConvite> {
    return this.servico.convidar(id, dto, origemDoRequest(req));
  }

  @Publico()
  @UseGuards(DistTokenGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiHeader({ name: CABECALHO_DIST_TOKEN, required: true, description: 'Token do console.' })
  @Post(':id/recusar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recusa o pedido.',
    description: 'Também invalida o convite em aberto, se houver.',
  })
  recusar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecusarListaEsperaDto,
    @Req() req: Request,
  ): Promise<{ id: string; status: StatusListaEspera }> {
    return this.servico.recusar(id, dto, origemDoRequest(req));
  }
}
