/**
 * Aparelhos do app Android que recebem avisos.
 *
 * O app chama `POST /dispositivos` depois do login (e sempre que o Firebase
 * troca o token), `POST /dispositivos/remover` antes de sair, e lê/grava as
 * preferências de aviso DESTE aparelho pelo token.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, MaxLength } from 'class-validator';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { AvisoService, type Avisos } from './aviso.service';

class RegistrarDispositivoDto {
  @IsString()
  @Length(20, 4096, { message: 'Token de aparelho inválido.' })
  token!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersao?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  modelo?: string;
}

class TokenDto {
  @IsString()
  @Length(20, 4096, { message: 'Token de aparelho inválido.' })
  token!: string;
}

class PreferenciasDto extends TokenDto {
  @IsOptional()
  @IsBoolean()
  campanhas?: boolean;

  @IsOptional()
  @IsBoolean()
  modelos?: boolean;

  @IsOptional()
  @IsBoolean()
  cobranca?: boolean;
}

const NAO_REGISTRADO = 'Este aparelho ainda não está registrado para avisos. Abra o app de novo.';

@ApiTags('Dispositivos')
@Controller('dispositivos')
export class AvisoController {
  constructor(private readonly avisos: AvisoService) {}

  @Post()
  registrar(@UsuarioAtual() u: UsuarioAutenticado, @Body() dto: RegistrarDispositivoDto): Promise<Avisos> {
    return this.avisos.registrar(u, dto);
  }

  @Post('remover')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remover(@UsuarioAtual() u: UsuarioAutenticado, @Body() dto: TokenDto): Promise<void> {
    await this.avisos.remover(u, dto.token);
  }

  @Get('avisos')
  async preferencias(@UsuarioAtual() u: UsuarioAutenticado, @Query('token') token = ''): Promise<Avisos> {
    const r = await this.avisos.preferencias(u, token);
    if (!r) throw new NotFoundException(NAO_REGISTRADO);
    return r;
  }

  @Patch('avisos')
  async definir(@UsuarioAtual() u: UsuarioAutenticado, @Body() dto: PreferenciasDto): Promise<Avisos> {
    const { token, ...mudancas } = dto;
    const r = await this.avisos.definirPreferencias(u, token, mudancas);
    if (!r) throw new NotFoundException(NAO_REGISTRADO);
    return r;
  }
}
