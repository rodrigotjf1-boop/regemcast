/**
 * Planos no console: listar, criar e editar. Cada alteração entra no livro de
 * acessos com o antes e o depois — preço é o tipo de coisa que alguém pergunta
 * "quem mudou isto, e quando?".
 */
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

import { Publico } from '../../common/publico.decorator';
import { DistribuicaoAuthService } from './distribuicao-auth.service';
import { DistribuicaoPlanosService } from './distribuicao-planos.service';
import { DistribuicaoGuard, type RequestDeOperador } from './distribuicao.guard';
import { ipDoCliente } from '../../common/ip-cliente';

class PlanoDto {
  @IsOptional() @IsString() @MaxLength(40) codigo?: string;
  @IsOptional() @IsString() @MaxLength(60) nome?: string;
  @IsOptional() @Type(() => Number) @IsInt({ message: 'Disparos por mês precisa ser inteiro.' }) disparosMes?: number;
  @IsOptional() @Type(() => Number) @IsInt({ message: 'O preço vai em centavos, inteiro.' }) precoCentavos?: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
  @IsOptional() @IsBoolean() publico?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() ordem?: number;
}

@ApiTags('Distribuição')
@Controller('distribuicao/planos')
@Publico()
@UseGuards(DistribuicaoGuard)
export class DistribuicaoPlanosController {
  constructor(
    private readonly planos: DistribuicaoPlanosService,
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
    await this.anotar(req, 'planos.lidos', {});
    return this.planos.listar();
  }

  @Post()
  async criar(@Req() req: RequestDeOperador, @Body() dto: PlanoDto) {
    const criado = await this.planos.criar(dto);
    await this.anotar(req, 'plano.criado', { id: criado.id, ...dto });
    return criado;
  }

  @Patch(':id')
  async atualizar(@Req() req: RequestDeOperador, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PlanoDto) {
    const { antes, retomadas } = await this.planos.atualizar(id, dto);
    await this.anotar(req, 'plano.alterado', { id, antes, depois: dto, campanhasRetomadas: retomadas });
    return { ok: true, campanhasRetomadas: retomadas };
  }
}
