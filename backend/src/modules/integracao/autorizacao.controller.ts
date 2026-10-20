/**
 * A página da autorização por clique (`/integracoes/autorizar`), do lado da
 * sessão do Regemcast: ler o pedido, autorizar e recusar. Os códigos de resposta
 * dizem à página em que situação ela está (o corpo de erro é só `{ mensagem }`):
 *
 * - 422: senha incorreta (a mensagem diz quantas faltam para travar);
 * - 423: autorização travada (5 senhas erradas em 15 minutos);
 * - 410: o pedido já foi usado, venceu ou chegou incompleto;
 * - 403: quem entrou não é o dono da conta;
 * - 503: o aplicativo está parado pela DMS.
 *
 * Só na nuvem não precisa dizer: o Regemcast não tem servidor de loja.
 */
import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { DonoGuard } from '../../common/dono.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { AutorizacaoService } from './autorizacao.service';
import { AutorizarDto, PedidoNaTelaDto } from './dto/autorizacao.dto';

@ApiTags('Autorização por clique')
@Controller('integracoes/autorizacao')
export class AutorizacaoController {
  constructor(private readonly autorizacoes: AutorizacaoService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'O que a página de autorização mostra para este pedido (situação e, para decidir, a tela inteira)' })
  ler(@UsuarioAtual() usuario: UsuarioAutenticado, @Query('client_id') clientId?: string, @Query('request_uri') requestUri?: string) {
    return this.autorizacoes.lerParaTela(usuario, clientId, requestUri);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(DonoGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'O dono autoriza com a senha: devolve o endereço de volta ao aplicativo, com o código de uso único' })
  autorizar(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: AutorizarDto, @Req() req: Request) {
    const userAgent = req.headers['user-agent'];
    return this.autorizacoes.autorizar(usuario, dto, { ip: req.ip, userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : undefined });
  }

  @Post('recusar')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Cancelar ou voltar: devolve o endereço de volta ao aplicativo, sem nada compartilhado' })
  recusar(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: PedidoNaTelaDto) {
    return this.autorizacoes.recusar(usuario, dto);
  }
}
