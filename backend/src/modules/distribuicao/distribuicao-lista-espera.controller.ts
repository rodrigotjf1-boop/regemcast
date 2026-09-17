/**
 * Lista de espera no console de distribuição.
 *
 * As mesmas operações que já existiam atrás do `DIST_TOKEN` — listar, ver a
 * capacidade da semana, convidar e recusar —, agora pela sessão de OPERADOR:
 * com duas etapas, com nome de quem fez e com cada ação no livro de acessos.
 * A chave estática fica para automação; gente usa o console.
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
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Publico } from '../../common/publico.decorator';
import { ConvidarListaEsperaDto } from '../lista-espera/dto/convidar-lista-espera.dto';
import { ListarListaEsperaDto } from '../lista-espera/dto/listar-lista-espera.dto';
import { RecusarListaEsperaDto } from '../lista-espera/dto/recusar-lista-espera.dto';
import { ListaEsperaService } from '../lista-espera/lista-espera.service';
import { DistribuicaoAuthService } from './distribuicao-auth.service';
import { DistribuicaoGuard, type RequestDeOperador } from './distribuicao.guard';

@ApiTags('Distribuição')
@Controller('distribuicao/lista-espera')
@Publico()
@UseGuards(DistribuicaoGuard)
export class DistribuicaoListaEsperaController {
  constructor(
    private readonly lista: ListaEsperaService,
    private readonly auth: DistribuicaoAuthService,
  ) {}

  private meta(req: RequestDeOperador) {
    const ua = req.headers['user-agent'];
    return { ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 300) : undefined };
  }

  private async anotar(req: RequestDeOperador, acao: string, detalhe: Record<string, unknown> = {}) {
    await this.auth.registrar(req.operador!.id, req.operador!.nome, acao, this.meta(req), detalhe);
  }

  @Get()
  async listar(@Req() req: RequestDeOperador, @Query() filtro: ListarListaEsperaDto) {
    await this.anotar(req, 'lista_espera.lida', { status: filtro.status ?? 'todos' });
    const [pagina, capacidade] = await Promise.all([this.lista.listar(filtro), this.lista.capacidade()]);
    return { ...pagina, capacidade };
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @HttpCode(HttpStatus.OK)
  @Post(':id/convidar')
  async convidar(
    @Req() req: RequestDeOperador,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvidarListaEsperaDto,
  ) {
    const resposta = await this.lista.convidar(id, dto, this.meta(req));
    // Nunca o link no livro de acessos: é o token do convite.
    await this.anotar(req, 'lista_espera.convidada', {
      listaEsperaId: id,
      forcado: Boolean(dto.forcar),
      emailEnviado: resposta.emailEnviado,
    });
    return resposta;
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @HttpCode(HttpStatus.OK)
  @Post(':id/recusar')
  async recusar(
    @Req() req: RequestDeOperador,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecusarListaEsperaDto,
  ) {
    const resposta = await this.lista.recusar(id, dto, this.meta(req));
    await this.anotar(req, 'lista_espera.recusada', { listaEsperaId: id });
    return resposta;
  }
}
