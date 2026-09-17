/**
 * Rotas da conta.
 *
 * Leitura é de qualquer pessoa da conta; escrita é só do dono (`DonoGuard`).
 * A autenticação é global, então não há `@Publico()` aqui — e nenhuma destas
 * rotas devolve senha_hash ou token_versao: o recorte acontece no service, não
 * num `delete objeto.senhaHash` depois de já ter carregado o campo.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { RequestAutenticado, UsuarioAutenticado } from '../../common/auth.guard';
import { DonoGuard } from '../../common/dono.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { ContaService, type OrigemRequest } from './conta.service';
import { AtualizarContaDto } from './dto/atualizar-conta.dto';
import { AtualizarUsuarioDto } from './dto/atualizar-usuario.dto';
import { CriarUsuarioDto } from './dto/criar-usuario.dto';
import { ipDoCliente } from '../../common/ip-cliente';

/**
 * O ParseUUIDPipe padrão responde "Validation failed (uuid is expected)" em
 * inglês. Sem ele, id torto vira 500 do Postgres (22P02) em vez de 400.
 */
const UuidUsuario = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException('Identificador de usuário inválido.'),
});

function origemDo(req: RequestAutenticado): OrigemRequest {
  return { ip: ipDoCliente(req), userAgent: req.headers['user-agent'] };
}

@ApiTags('Conta')
@Controller('conta')
export class ContaController {
  constructor(private readonly conta: ContaService) {}

  @Get()
  @ApiOperation({ summary: 'Dados da conta, plano e consumo do ciclo corrente' })
  resumo() {
    return this.conta.resumo();
  }

  @Patch()
  @UseGuards(DonoGuard)
  @ApiOperation({ summary: 'Altera nome, CNPJ ou fuso horário da conta' })
  atualizar(
    @Body() dto: AtualizarContaDto,
    @UsuarioAtual() atual: UsuarioAutenticado,
    @Req() req: RequestAutenticado,
  ) {
    return this.conta.atualizar(dto, atual, origemDo(req));
  }

  @Get('usuarios')
  @ApiOperation({ summary: 'Lista quem tem acesso à conta' })
  listarUsuarios() {
    return this.conta.listarUsuarios();
  }

  @Post('usuarios')
  @UseGuards(DonoGuard)
  @ApiOperation({ summary: 'Cria um operador na conta' })
  criarUsuario(
    @Body() dto: CriarUsuarioDto,
    @UsuarioAtual() atual: UsuarioAutenticado,
    @Req() req: RequestAutenticado,
  ) {
    return this.conta.criarUsuario(dto, atual, origemDo(req));
  }

  @Patch('usuarios/:id')
  @UseGuards(DonoGuard)
  @ApiOperation({ summary: 'Renomeia ou suspende/reativa um acesso' })
  atualizarUsuario(
    @Param('id', UuidUsuario) id: string,
    @Body() dto: AtualizarUsuarioDto,
    @UsuarioAtual() atual: UsuarioAutenticado,
    @Req() req: RequestAutenticado,
  ) {
    return this.conta.atualizarUsuario(id, dto, atual, origemDo(req));
  }

  @Delete('usuarios/:id')
  @UseGuards(DonoGuard)
  @ApiOperation({ summary: 'Remove um acesso da conta' })
  removerUsuario(
    @Param('id', UuidUsuario) id: string,
    @UsuarioAtual() atual: UsuarioAutenticado,
    @Req() req: RequestAutenticado,
  ) {
    return this.conta.removerUsuario(id, atual, origemDo(req));
  }
}
