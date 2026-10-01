/**
 * Rotas de modelo.
 *
 * `POST /modelos/conferir` existe para que a tela possa perguntar "isto passa
 * nas regras da Meta?" sem gravar nem enviar nada. É a única forma de ter UMA
 * implementação das regras: se o frontend validasse por conta própria, as duas
 * divergiriam — foi assim que um telefone sem o código do país passou na tela e
 * foi recusado pela Meta.
 */
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { SalvarModeloDto } from './dto/salvar-modelo.dto';
import { ValidadeDaOfertaDto } from './dto/validade-da-oferta.dto';
import { ModeloService } from './modelo.service';

@ApiTags('Modelos')
@Controller('modelos')
export class ModeloController {
  constructor(private readonly servico: ModeloService) {}

  @Get()
  listar(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.servico.listar(usuario.contaId);
  }

  /**
   * Confere contra as regras da Meta e contra os modelos que já existem. Não
   * grava, não envia. `id`: o modelo sendo editado.
   */
  @Post('conferir')
  async conferir(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() dto: SalvarModeloDto,
    @Query('id', new ParseUUIDPipe({ optional: true })) id?: string,
  ) {
    return { problemas: await this.servico.conferir(usuario.contaId, dto, id) };
  }

  /**
   * Grava o rascunho — do navegador ou do aplicativo. Até 29/09/2026 era só do
   * navegador; o dono decidiu que o app tem os mesmos recursos do site. As
   * regras da Meta continuam num lugar só: o `conferir` acima, que as duas
   * telas chamam antes de enviar.
   */
  @Post()
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

  /**
   * Muda só a validade da oferta por tempo limitado. Fica aqui: a Meta recebe
   * o vencimento a cada mensagem, não no modelo — então não gasta a edição do
   * dia de modelo aprovado nem o devolve à análise, como o `PUT` faria.
   */
  @Patch(':id/oferta')
  validadeDaOferta(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ValidadeDaOfertaDto,
  ) {
    return this.servico.mudarValidadeDaOferta(usuario.contaId, usuario.id, id, dto.horas ?? null);
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
