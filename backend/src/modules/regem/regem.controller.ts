/**
 * Rotas da integração com o Regem, para a conta.
 *
 * Ler a situação é de qualquer pessoa da conta. Importar, autorizar a 99,
 * consultar agora e desligar são do dono: envolvem uma declaração em nome da
 * empresa. Ligar a conta ao Regem é da distribuição
 * (`regem-distribuicao.controller.ts`) — a loja não manuseia token.
 */
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { DonoGuard } from '../../common/dono.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { RegemService, type SituacaoRegem } from './regem.service';

class IniciarImportacaoDto {
  @IsBoolean({ message: 'Confirme o consentimento dos clientes.' })
  consentimento!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  evidencia?: string;
}

class Autorizacao99Dto {
  @IsBoolean({ message: 'Diga se autoriza (true) ou desfaz a autorização (false).' })
  autorizar!: boolean;

  @IsOptional()
  @IsBoolean({ message: 'Confirme a declaração de responsabilidade.' })
  declaracao?: boolean;
}

@ApiTags('Regem')
@Controller('integracoes/regem')
export class RegemController {
  constructor(private readonly servico: RegemService) {}

  @Get()
  situacao(@UsuarioAtual() u: UsuarioAutenticado): Promise<SituacaoRegem> {
    return this.servico.situacao(u.contaId);
  }

  /** Começa (ou recomeça do zero) a leitura dos clientes e das vendas. Roda em segundo plano. */
  @Post('importar')
  @UseGuards(DonoGuard)
  importar(@UsuarioAtual() u: UsuarioAutenticado, @Body() dto: IniciarImportacaoDto): Promise<SituacaoRegem> {
    return this.servico.iniciar(u.contaId, u.id, dto);
  }

  /** Autoriza (ou desfaz) o uso dos clientes da 99Food, sob a responsabilidade do dono. */
  @Post('99')
  @UseGuards(DonoGuard)
  autorizar99(@UsuarioAtual() u: UsuarioAutenticado, @Body() dto: Autorizacao99Dto): Promise<SituacaoRegem> {
    return this.servico.autorizar99(u.contaId, u.id, dto);
  }

  /** Consulta as mudanças agora; parado por falha, retoma de onde parou. */
  @Post('atualizar')
  @UseGuards(DonoGuard)
  atualizar(@UsuarioAtual() u: UsuarioAutenticado): Promise<SituacaoRegem> {
    return this.servico.atualizar(u.contaId);
  }

  @Delete()
  @UseGuards(DonoGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async desligar(@UsuarioAtual() u: UsuarioAutenticado): Promise<void> {
    await this.servico.desligar(u.contaId, { usuarioId: u.id });
  }
}
