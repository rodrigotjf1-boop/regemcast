import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { DonoGuard } from '../../common/dono.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { Publico } from '../../common/publico.decorator';
import { DistTokenGuard } from '../lista-espera/dist-token.guard';
import { ConcluirSignupDto } from './dto/concluir-signup.dto';
import { ConectarManualDto } from './dto/conectar-manual.dto';
import { IntegrarDto } from './dto/integrar.dto';
import { ReconectarDto } from './dto/reconectar.dto';
import { RegistrarNumeroDto } from './dto/registrar-numero.dto';
import { AgendaService } from './agenda.service';
import { MetaService } from './meta.service';
import { SaudeService } from './saude.service';

@ApiTags('WhatsApp')
@Controller('whatsapp')
export class MetaController {
  constructor(
    private readonly servico: MetaService,
    private readonly agenda: AgendaService,
    private readonly saudeDaConta: SaudeService,
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
   * A saúde da conta na Meta: "posso enviar agora e, se não, o que eu resolvo?".
   * O veredito dela para a conta e o número, o pagamento e a conexão — cada um
   * com o que fazer. `atualizar=1` pergunta de novo à Meta (o "Conferir agora").
   *
   * Qualquer usuário da conta vê: quem monta campanha precisa saber se dá para
   * enviar. Nada aqui é credencial.
   */
  @Get('saude')
  saude(@UsuarioAtual() usuario: UsuarioAutenticado, @Query('atualizar') atualizar?: string) {
    return this.saudeDaConta.daConta(usuario.contaId, { atualizar: atualizar === '1' || atualizar === 'true' });
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
  async conectar(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: ConcluirSignupDto) {
    const resultado = await this.servico.concluirOnboarding(usuario.contaId, usuario.id, dto);
    // Conectou: a primeira leitura da saúde sai já, para a tela abrir sabendo se
    // dá para enviar. Falha aqui não desfaz a conexão — a tela lê de novo.
    await this.saudeDaConta.daConta(usuario.contaId, { atualizar: true }).catch(() => undefined);
    return resultado;
  }

  /**
   * Refaz a autorização de uma conta já conectada (a que venceu, ou que a Meta
   * passou a recusar). Só o dono, como no conectar. Renova a autorização e
   * mais nada: o número e a cópia dos contatos e das conversas não são tocados.
   */
  @Post('reconectar')
  @UseGuards(DonoGuard)
  async reconectar(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: ReconectarDto) {
    const resultado = await this.servico.reconectar(usuario.contaId, usuario.id, dto);
    // A tela precisa abrir já sabendo se a autorização nova resolveu: relê a saúde
    // na hora (a leitura boa apaga a anotação da falha).
    await this.saudeDaConta.daConta(usuario.contaId, { atualizar: true }).catch(() => undefined);
    return resultado;
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
