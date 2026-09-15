import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { DonoGuard } from '../../common/dono.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { ConcluirSignupDto } from './dto/concluir-signup.dto';
import { MetaService } from './meta.service';

@ApiTags('WhatsApp')
@Controller('whatsapp')
export class MetaController {
  constructor(private readonly servico: MetaService) {}

  /** O que o front precisa para abrir o Embedded Signup. Nada aqui é segredo. */
  @Get('config')
  config() {
    return this.servico.configDoSignup();
  }

  /** Estado da conexão: conta, números, qualidade e tier. Nunca o token. */
  @Get('situacao')
  situacao(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.servico.situacao(usuario.contaId);
  }

  /**
   * Conclui o onboarding. Só o dono conecta: é a credencial do WhatsApp da
   * empresa que está em jogo, não uma preferência de tela.
   */
  @Post('conectar')
  @UseGuards(DonoGuard)
  conectar(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: ConcluirSignupDto) {
    return this.servico.concluirOnboarding(usuario.contaId, usuario.id, dto);
  }
}
