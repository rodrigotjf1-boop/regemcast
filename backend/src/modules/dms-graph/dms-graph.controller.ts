/**
 * Rotas do DMS Graph para a conta (o produto da DMS, não a Graph API da Meta).
 *
 * Ler a situação e ajustar o vídeo do modelo são de qualquer pessoa da conta. Conectar e desligar são do dono: a ligação
 * vale para a empresa inteira.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { DonoGuard } from '../../common/dono.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { DURACAO_MAXIMA_S, PROPORCOES, type Proporcao } from './dms-graph.regras';
import { DmsGraphService, type AjusteDaTela, type SituacaoDmsGraph } from './dms-graph.service';

/** O que o Graph devolveu ao navegador na volta (a página de volta repassa tal como veio). */
class VoltaDoGraphDto {
  @IsOptional()
  @IsString()
  @MaxLength(400)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  iss?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  error?: string;
}

class AjustarVideoDto {
  @IsString()
  @Matches(/^midia:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, { message: 'Escolha um vídeo enviado do computador.' })
  referencia!: string;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(DURACAO_MAXIMA_S)
  inicioSegundos?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(DURACAO_MAXIMA_S)
  fimSegundos?: number;

  @IsOptional()
  @IsIn(PROPORCOES, { message: 'Escolha a proporção 16:9, 9:16 ou 1:1.' })
  proporcao?: Proporcao;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  texto?: string;
}

@ApiTags('DMS Graph')
@Controller('integracoes/dms-graph')
export class DmsGraphController {
  constructor(private readonly servico: DmsGraphService) {}

  @Get()
  situacao(@UsuarioAtual() u: UsuarioAutenticado): Promise<SituacaoDmsGraph> {
    return this.servico.situacao(u.contaId, u.papel);
  }

  /** "Conectar ao DMS Graph": abre o pedido lá e devolve a página, para onde o navegador vai. */
  @Post('clique')
  @UseGuards(DonoGuard)
  @HttpCode(HttpStatus.OK)
  conectar(@UsuarioAtual() u: UsuarioAutenticado): Promise<{ url: string }> {
    return this.servico.iniciarClique(u.contaId, { id: u.id, email: u.email });
  }

  /** A volta do Graph: troca o código pela ligação da conta (ou registra que não autorizou). */
  @Post('clique/volta')
  @UseGuards(DonoGuard)
  @HttpCode(HttpStatus.OK)
  concluir(@UsuarioAtual() u: UsuarioAutenticado, @Body() dto: VoltaDoGraphDto) {
    return this.servico.concluirClique(u.contaId, { id: u.id, nome: u.nome }, dto);
  }

  @Post('desligar')
  @UseGuards(DonoGuard)
  @HttpCode(HttpStatus.OK)
  desligar(@UsuarioAtual() u: UsuarioAutenticado): Promise<{ desligada: boolean }> {
    return this.servico.desligar(u.contaId, { id: u.id, nome: u.nome });
  }

  /** Dá para ajustar este vídeo? A tela pergunta antes de mostrar os controles. */
  @Get('midia/:id')
  midia(@UsuarioAtual() u: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.servico.mediaParaAjuste(u.contaId, id);
  }

  @Post('ajustes')
  @HttpCode(HttpStatus.OK)
  ajustar(@UsuarioAtual() u: UsuarioAutenticado, @Body() dto: AjustarVideoDto): Promise<AjusteDaTela> {
    const { referencia, ...pedido } = dto;
    return this.servico.ajustar(u.contaId, u.id, referencia.slice('midia:'.length), pedido);
  }

  @Get('ajustes/:id')
  consultar(@UsuarioAtual() u: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string): Promise<AjusteDaTela> {
    return this.servico.consultar(u.contaId, id);
  }
}
