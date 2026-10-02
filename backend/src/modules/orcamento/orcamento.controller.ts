import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { DonoGuard } from '../../common/dono.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { DefinirOrcamentoDto } from './dto/definir-orcamento.dto';
import { OrcamentoService } from './orcamento.service';

/**
 * O orçamento de disparos: quanto a conta aceita gastar na Meta por dia, por
 * semana e por mês. Ler é de qualquer pessoa da conta; definir é só do dono.
 */
@ApiTags('Orçamento de disparos')
@Controller('orcamento')
export class OrcamentoController {
  constructor(private readonly servico: OrcamentoService) {}

  @Get()
  @ApiOperation({ summary: 'Os tetos de gasto na Meta e quanto já saiu em cada período' })
  ler(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.servico.ler(usuario.contaId, usuario.papel);
  }

  @Put()
  @UseGuards(DonoGuard)
  @ApiOperation({ summary: 'Define os tetos por dia, semana e mês (campo vazio tira o teto)' })
  definir(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: DefinirOrcamentoDto) {
    return this.servico.definir(usuario.contaId, usuario.id, dto);
  }
}
