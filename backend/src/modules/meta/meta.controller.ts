import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { DonoGuard } from '../../common/dono.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { ConcluirSignupDto } from './dto/concluir-signup.dto';
import { RegistrarNumeroDto } from './dto/registrar-numero.dto';
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

  /**
   * Registra o número na Cloud API.
   *
   * Separado do conectar por causa do PIN: quando o número já tem verificação
   * em duas etapas, só o PIN que o cliente definiu no WhatsApp Manager serve —
   * e sem esta rota o onboarding terminaria numa pendência sem saída.
   */
  @Post('registrar-numero')
  @UseGuards(DonoGuard)
  registrarNumero(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: RegistrarNumeroDto) {
    return this.servico.registrarNumero(usuario.contaId, usuario.id, dto.phoneNumberId, dto.pin);
  }
}
