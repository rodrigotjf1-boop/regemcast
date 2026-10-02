/**
 * Tarifas da Meta no console: listar, cadastrar e corrigir. Cada alteração
 * entra no livro de acessos com o antes e o depois — é o preço que alimenta a
 * estimativa de custo e o orçamento de todo cliente.
 */
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { ipDoCliente } from '../../common/ip-cliente';
import { Publico } from '../../common/publico.decorator';
import { DistribuicaoAuthService } from './distribuicao-auth.service';
import { DistribuicaoTarifasService } from './distribuicao-tarifas.service';
import { DistribuicaoGuard, type RequestDeOperador } from './distribuicao.guard';

/**
 * Tudo texto, de propósito: o valor é dinheiro com até seis casas, e passar
 * por `number` no caminho é onde o centavo se perde. Quem confere o conteúdo é
 * `conferirTarifa`, com a frase do que consertar.
 */
class TarifaDto {
  @IsOptional() @IsString() @MaxLength(3) moeda?: string;
  @IsOptional() @IsString() @MaxLength(5) ddi?: string;
  @IsOptional() @IsString() @MaxLength(40) categoria?: string;
  @IsOptional() @IsString() @MaxLength(20) valor?: string;
  @IsOptional() @IsString() @MaxLength(10) vigenteDe?: string;
  @IsOptional() @IsString() @MaxLength(200) fonte?: string;
}

class CorrecaoDaTarifaDto {
  @IsOptional() @IsString() @MaxLength(20) valor?: string;
  @IsOptional() @IsString() @MaxLength(200) fonte?: string;
}

@ApiTags('Distribuição')
@Controller('distribuicao/tarifas')
@Publico()
@UseGuards(DistribuicaoGuard)
export class DistribuicaoTarifasController {
  constructor(
    private readonly tarifas: DistribuicaoTarifasService,
    private readonly auth: DistribuicaoAuthService,
  ) {}

  private async anotar(req: RequestDeOperador, acao: string, detalhe: Record<string, unknown>) {
    const ua = req.headers['user-agent'];
    await this.auth.registrar(
      req.operador!.id,
      req.operador!.nome,
      acao,
      { ip: ipDoCliente(req), userAgent: typeof ua === 'string' ? ua : undefined },
      detalhe,
    );
  }

  @Get()
  async listar(@Req() req: RequestDeOperador) {
    await this.anotar(req, 'tarifas.lidas', {});
    return this.tarifas.listar();
  }

  @Post()
  async criar(@Req() req: RequestDeOperador, @Body() dto: TarifaDto) {
    const criada = await this.tarifas.criar(dto, req.operador!.nome);
    await this.anotar(req, 'tarifa.criada', {
      id: criada.id,
      moeda: dto.moeda,
      ddi: dto.ddi,
      categoria: dto.categoria,
      valor: criada.valor,
      vigenteDe: dto.vigenteDe,
      fonte: dto.fonte ?? null,
    });
    return criada;
  }

  @Patch(':id')
  async atualizar(@Req() req: RequestDeOperador, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CorrecaoDaTarifaDto) {
    const { antes, valor } = await this.tarifas.atualizar(id, dto);
    await this.anotar(req, 'tarifa.corrigida', { id, antes, depois: { valor, fonte: dto.fonte } });
    return { ok: true, valor };
  }
}
