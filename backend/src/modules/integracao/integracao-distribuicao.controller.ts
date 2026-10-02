/**
 * Tokens de integração no console de distribuição: emitir, listar e revogar.
 *
 * No piloto, é a distribuição que emite o token de um produto da DMS e o grava
 * direto no cofre dele — o usuário não manuseia segredo. O token em claro sai
 * só na resposta da emissão. Cada passo entra no livro de acessos.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { ipDoCliente } from '../../common/ip-cliente';
import { Publico } from '../../common/publico.decorator';
import { DistribuicaoAuthService } from '../distribuicao/distribuicao-auth.service';
import { DistribuicaoGuard, type RequestDeOperador } from '../distribuicao/distribuicao.guard';
import { ESCOPOS } from './integracao.regras';
import { IntegracaoService } from './integracao.service';

/** O conteúdo é conferido em `conferirEmissao`, com a frase do que consertar. */
class EmissaoDto {
  @IsUUID('4', { message: 'Escolha a conta.' }) contaId!: string;
  @IsOptional() @IsString() @MaxLength(40) produto?: string;
  @IsOptional() @IsString() @MaxLength(10) classe?: string;
  @IsOptional() @IsString() @MaxLength(80) nome?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) escopos?: string[];
}

@ApiTags('Distribuição')
@Controller('distribuicao/integracoes')
@Publico()
@UseGuards(DistribuicaoGuard)
export class IntegracaoDistribuicaoController {
  constructor(
    private readonly integracoes: IntegracaoService,
    private readonly auth: DistribuicaoAuthService,
  ) {}

  private async anotar(req: RequestDeOperador, acao: string, detalhe: Record<string, unknown>) {
    const ua = req.headers['user-agent'];
    await this.auth.registrar(
      req.operador!.id,
      req.operador!.nome,
      acao,
      { ip: ipDoCliente(req), userAgent: typeof ua === 'string' ? ua : undefined },
      detalhe,
    );
  }

  /** Os tokens de todas as contas e o catálogo de permissões, para o formulário. */
  @Get()
  async listar(@Req() req: RequestDeOperador) {
    await this.anotar(req, 'integracoes.lidas', {});
    return { tokens: await this.integracoes.listarTodos(), escopos: ESCOPOS };
  }

  @Post()
  async emitir(@Req() req: RequestDeOperador, @Body() dto: EmissaoDto) {
    const { contaId, ...dados } = dto;
    const r = await this.integracoes.emitir(contaId, dados, req.operador!.nome);
    // O livro guarda o que foi emitido — nunca o token.
    await this.anotar(req, 'integracao.token_emitido', {
      id: r.emitido.id,
      contaId,
      produto: r.emitido.produto,
      classe: r.emitido.classe,
      escopos: r.emitido.escopos.map((e) => e.id),
    });
    return r;
  }

  @Post(':id/revogar')
  @HttpCode(HttpStatus.OK)
  async revogar(@Req() req: RequestDeOperador, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.integracoes.revogarPeloConsole(id, req.operador!.nome);
    await this.anotar(req, 'integracao.token_revogado', { id, contaId: r.contaId });
    return { ok: true };
  }
}
