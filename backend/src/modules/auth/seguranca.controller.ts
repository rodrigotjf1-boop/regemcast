/**
 * Verificação em duas etapas nas configurações da conta.
 *
 * Cada pessoa liga a SUA: é do usuário, não da conta. O dono não liga nem
 * desliga pelos operadores — a segunda etapa é do celular ou do e-mail de quem
 * entra, e só essa pessoa tem o código.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { metaDoRequest } from './auth.controller';
import { CodigoSegundaEtapaDto, SenhaConfirmacaoDto } from './dto/segunda-etapa.dto';
import { SegundaEtapaService, type SituacaoSeguranca } from './segunda-etapa.service';

@ApiTags('auth')
@ApiCookieAuth()
@Controller('auth/seguranca')
export class SegurancaController {
  constructor(private readonly segundaEtapa: SegundaEtapaService) {}

  @Get()
  @ApiOperation({ summary: 'Situação da verificação em duas etapas de quem está logado' })
  situacao(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<SituacaoSeguranca> {
    return this.segundaEtapa.situacao(usuario);
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @Post('email/codigo')
  @ApiOperation({ summary: 'Envia o código para ativar a verificação por e-mail' })
  enviarCodigoEmail(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.segundaEtapa.enviarCodigoDeAtivacao(usuario);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @Post('email/ativar')
  @ApiOperation({ summary: 'Ativa a verificação por e-mail (e confirma o e-mail)' })
  ativarEmail(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() dto: CodigoSegundaEtapaDto,
    @Req() req: Request,
  ): Promise<SituacaoSeguranca> {
    return this.segundaEtapa.ativarEmail(usuario, dto.codigo, metaDoRequest(req));
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @Post('app/iniciar')
  @ApiOperation({ summary: 'Gera o QR code do aplicativo autenticador' })
  iniciarApp(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.segundaEtapa.iniciarApp(usuario);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @Post('app/ativar')
  @ApiOperation({ summary: 'Confirma o primeiro código do app e ativa' })
  ativarApp(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() dto: CodigoSegundaEtapaDto,
    @Req() req: Request,
  ): Promise<SituacaoSeguranca> {
    return this.segundaEtapa.ativarApp(usuario, dto.codigo, metaDoRequest(req));
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @Post('desativar')
  @ApiOperation({ summary: 'Desliga a verificação em duas etapas (exige a senha)' })
  desativar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() dto: SenhaConfirmacaoDto,
    @Req() req: Request,
  ): Promise<SituacaoSeguranca> {
    return this.segundaEtapa.desativar(usuario, dto.senha, metaDoRequest(req));
  }
}
