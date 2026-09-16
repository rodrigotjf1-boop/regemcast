/**
 * Rotas de mídia.
 *
 * O `GET /midia/:id` existe para a PRÉVIA: o celular da tela de modelo precisa
 * mostrar a imagem que o cliente acabou de escolher, e ela ainda não tem
 * endereço público — está só no nosso banco. A rota passa pela autenticação e
 * pela RLS, então uma conta nunca lê o arquivo de outra.
 */
import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { MidiaService, type ArquivoRecebido } from './midia.service';

/** O maior teto entre os tipos aceitos. O teto POR TIPO é conferido no serviço. */
const TAMANHO_MAXIMO = 16 * 1024 * 1024;

@ApiTags('Mídia')
@Controller('midia')
export class MidiaController {
  constructor(private readonly servico: MidiaService) {}

  @Get()
  listar(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.servico.listar(usuario.contaId);
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: TAMANHO_MAXIMO } }))
  enviar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @UploadedFile() arquivo?: ArquivoRecebido,
  ) {
    if (!arquivo) throw new BadRequestException('Escolha um arquivo.');
    return this.servico.guardar(usuario.contaId, usuario.id, arquivo);
  }

  /** Os bytes, para a prévia. Sem cache público: o arquivo é da conta. */
  @Get(':id')
  async ler(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const { conteudo, tipoMime } = await this.servico.ler(usuario.contaId, id);
    res.setHeader('Content-Type', tipoMime);
    res.setHeader('Cache-Control', 'private, max-age=300');
    // Impede o navegador de "adivinhar" um tipo diferente do declarado — sem
    // isto, um arquivo malicioso podia ser interpretado como HTML.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(conteudo);
  }
}
