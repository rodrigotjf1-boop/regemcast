/**
 * Rotas de modelo.
 *
 * `POST /modelos/conferir` existe para que a tela possa perguntar "isto passa
 * nas regras da Meta?" sem gravar nem enviar nada. É a única forma de ter UMA
 * implementação das regras: se o frontend validasse por conta própria, as duas
 * divergiriam — foi assim que um telefone sem o código do país passou na tela e
 * foi recusado pela Meta.
 */
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { SomenteWebGuard } from '../../common/somente-web.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { SalvarModeloDto } from './dto/salvar-modelo.dto';
import { ModeloService } from './modelo.service';

@ApiTags('Modelos')
@Controller('modelos')
export class ModeloController {
  constructor(private readonly servico: ModeloService) {}

  @Get()
  listar(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.servico.listar(usuario.contaId);
  }

  /** Confere contra as regras da Meta. Não grava, não envia. */
  @Post('conferir')
  conferir(@Body() dto: SalvarModeloDto) {
    return { problemas: this.servico.conferir(dto) };
  }

  /** Criar modelo é do navegador: formulário longo, prévia e regras da Meta. */
  @Post()
  @UseGuards(SomenteWebGuard)
  criar(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: SalvarModeloDto) {
    return this.servico.salvarRascunho(usuario.contaId, usuario.id, dto);
  }

  /** Salva. Rascunho fica aqui; modelo que já está na Meta vai editado até ela. */
  @Put(':id')
  atualizar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SalvarModeloDto,
  ) {
    return this.servico.salvar(usuario.contaId, usuario.id, dto, id);
  }

  /** Submete à Meta. Confere antes; se algo estiver errado, nada sai daqui. */
  @Post(':id/enviar')
  enviar(@UsuarioAtual() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.servico.enviarParaAprovacao(usuario.contaId, usuario.id, id);
  }

  @Delete(':id')
  excluir(@UsuarioAtual() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.servico.excluir(usuario.contaId, usuario.id, id);
  }
}
