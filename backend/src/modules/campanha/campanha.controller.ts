import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { CampanhaService } from './campanha.service';
import { CriarCampanhaDto } from './dto/criar-campanha.dto';
import { EditarCampanhaDto } from './dto/editar-campanha.dto';
import { PreviaDoPublicoDto } from './dto/publico-da-campanha.dto';

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
   * Antes de montar: quantos do público (uma lista ou um público da base)
   * podem receber, quantos estão em descanso e em que período pedem. POST
   * porque o público é um objeto validado; não grava nada.
   */
  @Post('previa')
  @HttpCode(HttpStatus.OK)
  previaDoPublico(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: PreviaDoPublicoDto) {
    return this.servico.previaDoPublico(usuario.contaId, dto);
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
   * Do navegador ou do aplicativo: até 29/09/2026 era só do navegador; o dono
   * decidiu que o app tem os mesmos recursos do site. A conferência que importa
   * — quem pode receber, descanso, cashback, teto de números digitados — é
   * deste serviço, igual para as duas telas.
   */
  @Post()
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
