import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { DonoGuard } from '../../common/dono.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { CriarPublicoSalvoDto, EditarPublicoSalvoDto } from './dto/regra-do-publico.dto';
import { PublicoSalvoService } from './publico-salvo.service';

/**
 * Públicos salvos (migration 053): as regras do "público com regras" com nome.
 * A campanha usa um deles por `publicoSalvoId` no público "Da base"
 * (`origem: 'regras'`).
 */
@ApiTags('Públicos salvos')
@Controller('publicos-salvos')
export class PublicoSalvoController {
  constructor(private readonly servico: PublicoSalvoService) {}

  /** Os campos das regras, as comparações de cada tipo e o máximo de regras. */
  @Get('campos')
  campos() {
    return this.servico.catalogo();
  }

  /** Os públicos salvos da conta, com quantos podem receber hoje e os usos em campanha. */
  @Get()
  listar(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.servico.listar(usuario.contaId);
  }

  @Post()
  criar(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: CriarPublicoSalvoDto) {
    return this.servico.criar(usuario.contaId, usuario.id, dto);
  }

  /** Renomear, trocar as regras, ou os dois. Ausente = mantém. */
  @Patch(':id')
  editar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarPublicoSalvoDto,
  ) {
    return this.servico.editar(usuario.contaId, usuario.id, id, dto);
  }

  @Post(':id/duplicar')
  duplicar(@UsuarioAtual() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.servico.duplicar(usuario.contaId, usuario.id, id);
  }

  /** Só as regras saem; a campanha que já usou continua com quem recebeu. Do dono. */
  @Delete(':id')
  @UseGuards(DonoGuard)
  excluir(@UsuarioAtual() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.servico.excluir(usuario.contaId, usuario.id, id);
  }
}
