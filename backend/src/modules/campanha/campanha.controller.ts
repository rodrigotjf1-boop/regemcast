import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { SomenteWebGuard } from '../../common/somente-web.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { CampanhaService } from './campanha.service';
import { CriarCampanhaDto } from './dto/criar-campanha.dto';
import { EditarCampanhaDto } from './dto/editar-campanha.dto';

/**
 * Criar e disparar são rotas separadas de propósito.
 *
 * A campanha é gravada e commitada antes de qualquer mensagem sair. Se o
 * disparo falhar no meio, o registro do que ia ser enviado já existe — dá para
 * ver, retomar e explicar. Fazer tudo num request só significa que um erro no
 * fim apaga o registro de mensagens que já saíram e já foram cobradas.
 */
@ApiTags('Campanhas')
@Controller('campanhas')
export class CampanhaController {
  constructor(private readonly servico: CampanhaService) {}

  @Get()
  listar(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.servico.listar(usuario.contaId);
  }

  /**
   * Antes de criar: quantos da lista estão em descanso hoje e vão ficar de
   * fora. Antes de `:id` — "descanso" não é uuid.
   */
  @Get('descanso')
  previaDoDescanso(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query('listaId', ParseUUIDPipe) listaId: string,
  ) {
    return this.servico.previaDoDescanso(usuario.contaId, listaId);
  }

  /**
   * Antes de criar: em que período do dia a lista costuma pedir e a janela de
   * envio sugerida. Antes de `:id` — "horario" não é uuid.
   */
  @Get('horario')
  sugestaoDeHorario(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query('listaId', ParseUUIDPipe) listaId: string,
  ) {
    return this.servico.sugestaoDeHorario(usuario.contaId, listaId);
  }

  @Get(':id')
  detalhe(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.servico.detalhe(usuario.contaId, id);
  }

  /** O que aconteceu com cada destinatário — é aqui que "enviada" vira verdade ou mentira. */
  @Get(':id/destinatarios')
  destinatarios(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.servico.destinatarios(usuario.contaId, id);
  }

  /**
   * Monta a campanha. Nenhuma mensagem sai aqui.
   *
   * Só pelo navegador: montar envolve escolher público, conferir quem fica de
   * fora e revisar o que vai ser cobrado — e o celular é onde esse erro sai caro.
   */
  @Post()
  @UseGuards(SomenteWebGuard)
  criar(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: CriarCampanhaDto) {
    return this.servico.criar(usuario.contaId, usuario.id, dto, usuario.papel);
  }

  /** Dispara. Só funciona uma vez: disparar de novo reenviaria para quem já recebeu. */
  @Post(':id/disparar')
  disparar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.servico.disparar(usuario.contaId, usuario.id, id);
  }

  /** Retoma uma campanha que pausou porque a conexão caiu. */
  @Post(':id/retomar')
  retomar(@UsuarioAtual() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.servico.retomar(usuario.contaId, usuario.id, id);
  }
  /** Pausa por decisão do cliente: só volta quando ele mandar. */
  @Post(':id/pausar')
  @HttpCode(HttpStatus.OK)
  pausar(@UsuarioAtual() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.servico.pausar(usuario.contaId, usuario.id, id);
  }

  /** Edita. Em rascunho muda tudo; depois de disparada, só janela, ritmo e limites. */
  @Patch(':id')
  editar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarCampanhaDto,
  ) {
    return this.servico.editar(usuario.contaId, usuario.id, id, dto);
  }

  /**
   * Apaga o rascunho, cancela a que ainda não terminou, arquiva a encerrada.
   * A resposta diz qual das três aconteceu.
   */
  @Delete(':id')
  excluir(@UsuarioAtual() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.servico.excluir(usuario.contaId, usuario.id, id);
  }
}
