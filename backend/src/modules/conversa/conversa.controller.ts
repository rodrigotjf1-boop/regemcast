/**
 * Rotas da tela de conversas.
 *
 * Dono e operador leem e respondem: atender cliente é trabalho de quem opera.
 * Só o dono muda o prazo de guarda das mensagens.
 *
 * As rotas fixas (`config`) vêm antes das com `:id` — senão "config" seria
 * lido como id de conversa.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { DonoGuard } from '../../common/dono.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { ConversaService } from './conversa.service';
import { ResponderDto } from './dto/responder.dto';
import { RetencaoDto } from './dto/retencao.dto';

/** Nome de arquivo seguro para o cabeçalho: sem aspas, barras nem quebra de linha. */
function nomeSeguro(nome: string | null): string {
  const limpo = (nome ?? 'arquivo').replace(/[^\w.\- ]+/g, '_').slice(0, 100).trim();
  return limpo || 'arquivo';
}

@ApiTags('Conversas')
@Controller('conversas')
export class ConversaController {
  constructor(private readonly servico: ConversaService) {}

  @Get()
  listar(@UsuarioAtual() usuario: UsuarioAutenticado, @Query('busca') busca?: string) {
    return this.servico.listar(usuario.contaId, busca);
  }

  @Get('config')
  configuracao(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.servico.configuracao(usuario.contaId);
  }

  @Patch('config')
  @UseGuards(DonoGuard)
  salvarConfiguracao(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: RetencaoDto) {
    return this.servico.salvarConfiguracao(usuario.contaId, usuario.id, dto.retencaoDias);
  }

  @Get(':id')
  detalhe(@UsuarioAtual() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.servico.detalhe(usuario.contaId, id);
  }

  @Get(':id/mensagens')
  mensagens(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('antesDe') antesDe?: string,
  ) {
    let cursor: Date | undefined;
    if (antesDe) {
      cursor = new Date(antesDe);
      if (Number.isNaN(cursor.getTime())) throw new BadRequestException('Data inválida para paginar.');
    }
    return this.servico.mensagens(usuario.contaId, id, cursor);
  }

  @Post(':id/lida')
  marcarLida(@UsuarioAtual() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.servico.marcarLida(usuario.contaId, id);
  }

  @Post(':id/mensagens')
  responder(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResponderDto,
  ) {
    return this.servico.responder(usuario.contaId, usuario.id, id, dto.texto);
  }

  /** Os bytes da mídia, buscados na Meta na hora. Sem cache público: é da conta. */
  @Get(':id/mensagens/:mensagemId/midia')
  async midia(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) _conversaId: string,
    @Param('mensagemId', ParseUUIDPipe) mensagemId: string,
    @Res() res: Response,
  ) {
    const { conteudo, tipoMime, embutir, nome } = await this.servico.midia(usuario.contaId, mensagemId);
    res.setHeader('Content-Type', tipoMime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    // O navegador não "adivinha" outro tipo, e nada servido daqui roda script.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', `${embutir ? 'inline' : 'attachment'}; filename="${nomeSeguro(nome)}"`);
    res.send(conteudo);
  }
}
