/**
 * Leitura da trilha da própria conta.
 *
 * Não existe rota de escrita: quem grava é o backend, por dentro, via
 * AuditoriaService. Trilha que o cliente consegue escrever não prova nada.
 *
 * O isolamento vem de três camadas que concordam: o guard global exige sessão,
 * o interceptor abre a transação na conta do usuário (GUC da RLS) e a query
 * ainda filtra `conta_id` explicitamente — o filtro redundante é o que mantém o
 * predicado visível em code review e o que usa o índice por conta.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { AuditoriaService, type PaginaAuditoria } from './auditoria.service';
import { ListarAuditoriaDto } from './dto/listar-auditoria.dto';

@ApiTags('auditoria')
@Controller('auditoria')
export class AuditoriaController {
  constructor(private readonly auditoria: AuditoriaService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista a trilha de auditoria da conta, da mais recente para a mais antiga.',
  })
  @ApiOkResponse({
    description:
      'Página da trilha. `proximoCursor` vem nulo quando não há mais registros; ' +
      'repita a chamada passando `cursor=proximoCursor` para a próxima página.',
  })
  async listar(
    @Query() query: ListarAuditoriaDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<PaginaAuditoria> {
    return this.auditoria.listar({
      contaId: usuario.contaId,
      limite: query.limite,
      cursor: query.cursor,
      acao: query.acao,
    });
  }
}
