/**
 * "Aplicativos conectados": o que a conta vê e desliga.
 *
 * Qualquer pessoa da conta vê quais produtos têm acesso e com que permissões;
 * só o dono desliga. Nada aqui devolve o token, nem o hash dele.
 */
import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { DonoGuard } from '../../common/dono.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { IntegracaoService } from './integracao.service';

@ApiTags('Aplicativos conectados')
@Controller('integracoes/aplicativos')
export class IntegracaoController {
  constructor(private readonly integracoes: IntegracaoService) {}

  @Get()
  @ApiOperation({ summary: 'Os produtos com acesso à conta pela integração, e o que cada um pode fazer' })
  listar(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.integracoes.daConta(usuario.contaId);
  }

  @Post(':id/revogar')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DonoGuard)
  @ApiOperation({ summary: 'Desliga um aplicativo: o token para de valer na hora' })
  revogar(@UsuarioAtual() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.integracoes.revogarPelaConta(usuario.contaId, { id: usuario.id, nome: usuario.nome }, id);
  }
}
