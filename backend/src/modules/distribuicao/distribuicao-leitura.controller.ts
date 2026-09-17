/**
 * Rotas de leitura do console.
 *
 * Todas atrás do `DistribuicaoGuard` (sessão de operador com duas etapas) e
 * todas registrando o acesso. O registro acontece ANTES de devolver os dados:
 * se o registro falhasse depois, o operador teria visto sem ficar anotado.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Publico } from '../../common/publico.decorator';
import { DistribuicaoAuthService } from './distribuicao-auth.service';
import { DistribuicaoLeituraService } from './distribuicao-leitura.service';
import { DistribuicaoGuard, type RequestDeOperador } from './distribuicao.guard';
import { ipDoCliente } from '../../common/ip-cliente';

@ApiTags('Distribuição')
@Controller('distribuicao')
@Publico()
@UseGuards(DistribuicaoGuard)
export class DistribuicaoLeituraController {
  constructor(
    private readonly leitura: DistribuicaoLeituraService,
    private readonly auth: DistribuicaoAuthService,
  ) {}

  private async anotar(req: RequestDeOperador, acao: string, detalhe: Record<string, unknown> = {}) {
    await this.auth.registrar(
      req.operador!.id,
      req.operador!.nome,
      acao,
      { ip: ipDoCliente(req), userAgent: req.headers['user-agent'] },
      detalhe,
    );
  }

  @Get('resumo')
  async resumo(@Req() req: RequestDeOperador) {
    await this.anotar(req, 'resumo.lido');
    return this.leitura.resumo();
  }

  @Get('contas')
  async contas(@Req() req: RequestDeOperador) {
    await this.anotar(req, 'contas.lidas');
    return this.leitura.contas();
  }

  @Post('contas/:id/estender-gratis')
  @HttpCode(HttpStatus.OK)
  async estenderGratis(
    @Req() req: RequestDeOperador,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: { dias?: number },
  ) {
    const dias = Number(corpo?.dias);
    const r = await this.leitura.estenderGratis(id, dias);
    await this.anotar(req, 'conta.gratis_estendido', { dias, gratisAte: r.gratisAte });
    return r;
  }

  @Get('contas/:id/acessos')
  async acessos(@Req() req: RequestDeOperador, @Param('id', ParseUUIDPipe) id: string) {
    await this.anotar(req, 'conta.acessos_lidos', { contaId: id });
    return this.leitura.acessosDaConta(id);
  }

  @Post('usuarios/:id/zerar-duas-etapas')
  @HttpCode(HttpStatus.OK)
  async zerarDuasEtapas(@Req() req: RequestDeOperador, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.leitura.zerarDuasEtapas(id, req.operador!.nome);
    await this.anotar(req, 'usuario.duas_etapas_zeradas', { usuarioId: id, contaId: r.contaId });
    return { ok: true };
  }

  @Get('telemetria')
  async telemetria(@Req() req: RequestDeOperador, @Query('dias') dias?: string) {
    const janela = Number(dias) || 7;
    await this.anotar(req, 'telemetria.lida', { dias: janela });
    return this.leitura.telemetria(janela);
  }
}
