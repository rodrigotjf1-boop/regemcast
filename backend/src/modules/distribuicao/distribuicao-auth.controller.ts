/**
 * Rotas de login dos operadores.
 *
 * Todas são `@Publico()` para escapar do guard de CLIENTE — o operador não tem
 * sessão de cliente, e não deve ter. Quem protege cada passo é o próprio
 * serviço (senha, pré-sessão, código) ou o `DistribuicaoGuard`.
 *
 * Throttle apertado nas rotas de senha e código: somado à trava de 5 tentativas
 * por operador, impede um robô de testar e-mails diferentes para escapar da
 * trava individual.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { Publico } from '../../common/publico.decorator';
import { DistTokenGuard } from '../lista-espera/dist-token.guard';
import { gravarPre, gravarSessao, limparTudo, nomeCookiePre } from './cookie-distribuicao';
import { DistribuicaoAuthService, type MetaRequisicao } from './distribuicao-auth.service';
import { DistribuicaoGuard, type RequestDeOperador } from './distribuicao.guard';
import { CodigoDto, CriarOperadorDto, EntrarOperadorDto } from './dto/entrar.dto';
import { ipDoCliente } from '../../common/ip-cliente';

function meta(req: Request): MetaRequisicao {
  return { ip: ipDoCliente(req), userAgent: req.headers['user-agent'] };
}

function preDoRequest(req: Request): string {
  return (req.cookies as Record<string, string> | undefined)?.[nomeCookiePre()] ?? '';
}

@ApiTags('Distribuição')
@Controller('distribuicao')
export class DistribuicaoAuthController {
  constructor(private readonly auth: DistribuicaoAuthService) {}

  /**
   * Cria um operador — protegida pela chave-mestra (`x-dist-token`).
   *
   * É a única coisa que a chave-mestra ainda faz no console: fazer nascer os
   * operadores. Dali em diante cada um entra com o próprio login.
   */
  @Post('operadores')
  @Publico()
  @UseGuards(DistTokenGuard)
  criarOperador(@Body() dto: CriarOperadorDto) {
    return this.auth.criarOperador(dto.nome, dto.email, dto.senha);
  }

  @Post('entrar')
  @Publico()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async entrar(
    @Body() dto: EntrarOperadorDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { etapa, preToken } = await this.auth.entrar(dto.email, dto.senha, meta(req));
    gravarPre(res, preToken);
    // Só a etapa volta no corpo. O token vive no cookie httpOnly.
    return { etapa };
  }

  @Post('entrar/codigo')
  @Publico()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async confirmarCodigo(
    @Body() dto: CodigoDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sessao = await this.auth.confirmarCodigo(preDoRequest(req), dto.codigo, meta(req));
    gravarSessao(res, sessao);
    return { ok: true };
  }

  /** Primeiro login: o endereço para escanear no aplicativo. */
  @Post('codigo/iniciar')
  @Publico()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  iniciarCodigo(@Req() req: Request) {
    return this.auth.iniciarCadastroDoCodigo(preDoRequest(req));
  }

  @Post('codigo/confirmar')
  @Publico()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async confirmarCadastro(
    @Body() dto: CodigoDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sessao = await this.auth.confirmarCadastroDoCodigo(preDoRequest(req), dto.codigo, meta(req));
    gravarSessao(res, sessao);
    return { ok: true };
  }

  @Post('sair')
  @Publico()
  @HttpCode(HttpStatus.OK)
  sair(@Res({ passthrough: true }) res: Response) {
    limparTudo(res);
    return { ok: true };
  }

  /** Quem está logado. É o que a tela do console usa para saber se está dentro. */
  @Get('eu')
  @Publico()
  @UseGuards(DistribuicaoGuard)
  eu(@Req() req: RequestDeOperador) {
    return req.operador;
  }
}
