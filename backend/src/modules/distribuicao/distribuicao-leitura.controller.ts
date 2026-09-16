/**
 * Rotas de leitura do console.
 *
 * Todas atrás do `DistribuicaoGuard` (sessão de operador com duas etapas) e
 * todas registrando o acesso. O registro acontece ANTES de devolver os dados:
 * se o registro falhasse depois, o operador teria visto sem ficar anotado.
 */
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Publico } from '../../common/publico.decorator';
import { DistribuicaoAuthService } from './distribuicao-auth.service';
import { DistribuicaoLeituraService } from './distribuicao-leitura.service';
import { DistribuicaoGuard, type RequestDeOperador } from './distribuicao.guard';

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
      { ip: req.ip, userAgent: req.headers['user-agent'] },
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

  @Get('telemetria')
  async telemetria(@Req() req: RequestDeOperador, @Query('dias') dias?: string) {
    const janela = Number(dias) || 7;
    await this.anotar(req, 'telemetria.lida', { dias: janela });
    return this.leitura.telemetria(janela);
  }
}
