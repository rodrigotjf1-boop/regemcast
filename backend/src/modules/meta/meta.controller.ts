import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { DonoGuard } from '../../common/dono.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { Publico } from '../../common/publico.decorator';
import { DistTokenGuard } from '../lista-espera/dist-token.guard';
import { ConcluirSignupDto } from './dto/concluir-signup.dto';
import { ConectarManualDto } from './dto/conectar-manual.dto';
import { IntegrarDto } from './dto/integrar.dto';
import { RegistrarNumeroDto } from './dto/registrar-numero.dto';
import { AgendaService } from './agenda.service';
import { MetaService } from './meta.service';

@ApiTags('WhatsApp')
@Controller('whatsapp')
export class MetaController {
  constructor(
    private readonly servico: MetaService,
    private readonly agenda: AgendaService,
  ) {}

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
   * Modelos de mensagem da conta, lidos direto da Meta.
   *
   * Qualquer usuário da conta pode ver: escolher modelo é trabalho de quem faz
   * campanha, não só do dono. Quem manuseia credencial é o servidor.
   */
  @Get('modelos')
  modelos(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.servico.modelos(usuario.contaId);
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
   * Conecta uma WABA informando o token, sem Embedded Signup.
   *
   * Rota da DISTRIBUIÇÃO: `@Publico()` para escapar do guard de sessão, e
   * `DistTokenGuard` no lugar dele. O `@Publico()` fica aqui, explícito, e não
   * no controller inteiro, porque `grep -rn "@Publico" src/` precisa listar
   * toda a superfície anônima da API numa tela só.
   *
   * Serve ao número de teste da Meta — que não passa pelo Embedded Signup — e
   * ao suporte, quando o signup de um cliente morre no meio.
   */
  @Post('conectar-manual')
  @Publico()
  @UseGuards(DistTokenGuard)
  conectarManual(@Body() dto: ConectarManualDto) {
    return this.servico.conectarManual(dto.contaId, dto);
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

  /**
   * Coexistência: trazer, ou não, os contatos e as conversas do WhatsApp
   * Business deste número.
   *
   * Só o dono responde: a resposta vem com a declaração de que a agenda pode
   * receber mensagens da empresa, e essa declaração é dele.
   */
  @Post('integrar')
  @UseGuards(DonoGuard)
  integrar(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: IntegrarDto) {
    return this.agenda.decidir(usuario.contaId, usuario.id, dto.phoneNumberId, dto.integrar);
  }
}
