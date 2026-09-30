/**
 * O Regem no console da distribuição: ligar uma conta à empresa no Regem, com
 * o token de integração que emitimos no console do Regem, e ver o que espera
 * por nós (a 99 que o dono autorizou e o token ainda não libera).
 *
 * Atrás do `DistribuicaoGuard` (sessão de operador com duas etapas) e com cada
 * ação no livro de acessos — nunca o token. Ligar e desligar ficam também na
 * auditoria da própria conta, visível ao cliente.
 */
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

import { ipDoCliente } from '../../common/ip-cliente';
import { Publico } from '../../common/publico.decorator';
import { DistribuicaoAuthService } from '../distribuicao/distribuicao-auth.service';
import { DistribuicaoGuard, type RequestDeOperador } from '../distribuicao/distribuicao.guard';
import { RegemService } from './regem.service';

class LigarRegemDto {
  @IsString({ message: 'Cole o token de integração do Regem.' })
  @Length(20, 200, { message: 'Esse não parece um token de integração do Regem (rgm_it_…).' })
  token!: string;
}

@ApiTags('Distribuição')
@Controller('distribuicao')
@Publico()
@UseGuards(DistribuicaoGuard)
export class RegemDistribuicaoController {
  constructor(
    private readonly regem: RegemService,
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

  @Get('regem')
  async ligacoes(@Req() req: RequestDeOperador) {
    await this.anotar(req, 'regem.ligacoes_lidas');
    return this.regem.ligacoes();
  }

  @Post('contas/:id/regem')
  @HttpCode(HttpStatus.OK)
  async ligar(@Req() req: RequestDeOperador, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LigarRegemDto) {
    const loja = await this.regem.ligar(id, dto.token, req.operador!.nome);
    await this.anotar(req, 'conta.regem_ligado', { contaId: id, empresa: loja.empresaNome, escopos: loja.escopos });
    return loja;
  }

  @Delete('contas/:id/regem')
  @HttpCode(HttpStatus.NO_CONTENT)
  async desligar(@Req() req: RequestDeOperador, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.regem.desligar(id, { operador: req.operador!.nome });
    await this.anotar(req, 'conta.regem_desligado', { contaId: id });
  }
}
