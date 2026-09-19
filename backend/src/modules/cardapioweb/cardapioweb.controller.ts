/**
 * Rotas da conexão com o Cardápio Web.
 *
 * Ler a situação é de qualquer pessoa da conta. Conectar, importar e
 * desconectar são do dono: envolvem uma credencial da loja e uma declaração de
 * consentimento em nome da empresa.
 */
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, MaxLength } from 'class-validator';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { DonoGuard } from '../../common/dono.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { CardapiowebService, type SituacaoCardapioWeb } from './cardapioweb.service';

class ConectarChaveDto {
  @IsString({ message: 'Cole a chave da loja.' })
  @Length(10, 500, { message: 'Essa chave não parece a do Cardápio Web. Copie de novo em Configurações → Integrações → API.' })
  chave!: string;
}

class IniciarImportacaoDto {
  @IsBoolean({ message: 'Confirme o consentimento dos clientes.' })
  consentimento!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  evidencia?: string;
}

@ApiTags('Cardápio Web')
@Controller('integracoes/cardapioweb')
export class CardapiowebController {
  constructor(private readonly servico: CardapiowebService) {}

  @Get()
  situacao(@UsuarioAtual() u: UsuarioAutenticado): Promise<SituacaoCardapioWeb> {
    return this.servico.situacao(u.contaId);
  }

  @Post('chave')
  @UseGuards(DonoGuard)
  conectar(@UsuarioAtual() u: UsuarioAutenticado, @Body() dto: ConectarChaveDto): Promise<{ lojaNome: string }> {
    return this.servico.conectarChave(u.contaId, u.id, dto.chave);
  }

  @Post('importar')
  @UseGuards(DonoGuard)
  importar(@UsuarioAtual() u: UsuarioAutenticado, @Body() dto: IniciarImportacaoDto): Promise<SituacaoCardapioWeb> {
    return this.servico.iniciar(u.contaId, u.id, dto);
  }

  @Delete()
  @UseGuards(DonoGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async desconectar(@UsuarioAtual() u: UsuarioAutenticado): Promise<void> {
    await this.servico.desconectar(u.contaId, u.id);
  }
}
