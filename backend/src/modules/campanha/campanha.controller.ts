import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { CampanhaService } from './campanha.service';
import { CriarCampanhaDto } from './dto/criar-campanha.dto';

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

  /** Monta a campanha. Nenhuma mensagem sai aqui. */
  @Post()
  criar(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: CriarCampanhaDto) {
    return this.servico.criar(usuario.contaId, usuario.id, dto);
  }

  /** Dispara. Só funciona uma vez: disparar de novo reenviaria para quem já recebeu. */
  @Post(':id/disparar')
  disparar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.servico.disparar(usuario.contaId, usuario.id, id);
  }
}
