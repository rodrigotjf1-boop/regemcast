/**
 * Superfície HTTP da sessão.
 *
 * O cookie é gravado e limpo AQUI, não no service: cookie é detalhe de HTTP, e
 * manter isso fora da regra deixa o service testável sem simular um `Response`
 * do express.
 *
 * O token é o ÚNICO campo que o service devolve e o controller não repassa: ele
 * vai para o cookie httpOnly e some do corpo. Devolver o token no JSON anularia
 * o httpOnly — qualquer XSS leria a resposta do login e levaria a sessão.
 */
import { isIP } from 'node:net';

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { Publico } from '../../common/publico.decorator';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { env } from '../../config/env';
import {
  AuthService,
  type MetaRequisicao,
  type PreviaConvite,
  type RespostaEu,
  type RespostaSessao,
} from './auth.service';
import { gravarCookieSessao, limparCookieSessao } from './cookie';
import { AceitarConviteDto } from './dto/aceitar-convite.dto';
import { LoginDto } from './dto/login.dto';
import { TrocarSenhaDto } from './dto/trocar-senha.dto';

function ipDoRequest(req: Request): string | undefined {
  // Só confiamos no header do Cloudflare quando a configuração diz que ele
  // existe — senão qualquer cliente escolhe o próprio IP na trilha. E o valor
  // é conferido com isIP porque a coluna é `inet`: header forjado com lixo não
  // pode derrubar a gravação da auditoria.
  if (env.rede.trustCloudflare) {
    const bruto = req.headers['cf-connecting-ip'];
    const valor = (Array.isArray(bruto) ? bruto[0] : bruto)?.trim();
    if (valor && isIP(valor)) return valor;
  }
  const ip = req.ip?.trim();
  return ip && isIP(ip) ? ip : undefined;
}

function metaDoRequest(req: Request): MetaRequisicao {
  const ua = req.headers['user-agent'];
  return {
    ip: ipDoRequest(req),
    userAgent: typeof ua === 'string' ? ua.slice(0, 300) : undefined,
  };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Publico()
  // Aperta de verdade em relação ao teto global de 120/min: 8 tentativas por
  // minuto por IP é confortável para quem digitou errado e inviável para quem
  // está varrendo senha.
  @Throttle({ default: { ttl: 60_000, limit: 8 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  @ApiOperation({ summary: 'Entrar com e-mail e senha' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RespostaSessao> {
    const { token, resposta } = await this.auth.login(dto, metaDoRequest(req));
    gravarCookieSessao(res, token);
    return resposta;
  }

  @HttpCode(HttpStatus.OK)
  @Post('sair')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Encerrar a sessão (invalida o token em todos os dispositivos)' })
  async sair(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ mensagem: string }> {
    // Limpar o cookie primeiro: se a invalidação no banco falhar, quem está no
    // navegador ainda sai, em vez de continuar logado com um 500 na tela. Quem
    // copiou o token é derrubado no passo seguinte, pelo token_versao.
    limparCookieSessao(res);
    return this.auth.sair(usuario, metaDoRequest(req));
  }

  @Get('eu')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Usuário e conta da sessão atual' })
  async eu(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<RespostaEu> {
    return this.auth.eu(usuario);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @Post('senha')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Trocar a própria senha (encerra todas as sessões)' })
  async trocarSenha(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() dto: TrocarSenhaDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ mensagem: string }> {
    const resposta = await this.auth.trocarSenha(usuario, dto, metaDoRequest(req));
    // A troca incrementa token_versao, então o cookie que chegou neste request
    // já não vale mais: limpar evita um 401 confuso no próximo clique.
    limparCookieSessao(res);
    return resposta;
  }

  @Publico()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Get('convite/:token')
  @ApiOperation({ summary: 'Dados do convite, para preencher a tela de cadastro' })
  async previaConvite(@Param('token') token: string): Promise<PreviaConvite> {
    return this.auth.previaConvite(token);
  }

  @Publico()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('convite/aceitar')
  @ApiOperation({ summary: 'Aceitar o convite e criar a conta (já autenticado)' })
  async aceitarConvite(
    @Body() dto: AceitarConviteDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RespostaSessao> {
    const { token, resposta } = await this.auth.aceitarConvite(dto, metaDoRequest(req));
    gravarCookieSessao(res, token);
    return resposta;
  }
}
