/**
 * A tela da aprovação de disparos (Hub DMS, F5 parte B): Campanhas › Para
 * aprovar. Qualquer pessoa da conta vê; quem aprova ou recusa é o dono, ou quem
 * ele autorizou — conferido no SERVIÇO, não aqui (a tela só esconde).
 *
 * Aprovar encadeia os dois passos do serviço na transação do pedido: aprova e
 * executa. O registro no hub sai depois de a resposta ir (a transação já
 * confirmou), e não lança.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { pedidoPublico, type SituacaoDoPedido } from '../../dms/integracao-dms';
import { AprovacaoService } from './aprovacao.service';
import { AprovarDto, RecusarDto } from './dto/aprovacao.dto';
import { ErroDoPedido } from './erro-do-pedido';

@ApiTags('Aprovações')
@Controller('aprovacoes')
export class AprovacaoController {
  constructor(private readonly servico: AprovacaoService) {}

  @Get()
  listar(@UsuarioAtual() u: UsuarioAutenticado) {
    return this.servico.listarParaTela(u);
  }

  @Get(':id')
  detalhe(@UsuarioAtual() u: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.servico.detalheParaTela(u, id);
  }

  @Post(':id/aprovar')
  @HttpCode(HttpStatus.OK)
  async aprovar(
    @UsuarioAtual() u: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AprovarDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const aprovado = await this.servico.aprovar(u, id, dto);
    const agora = this.servico.agora();
    const tela = this.servico.enderecoDaTela(id);
    if (aprovado.situacao !== 'aprovado') {
      // Encerrado na hora de aprovar (o plano mudou, o aplicativo foi desligado): a tela mostra o porquê.
      depois(res, () => this.servico.depoisDaDecisao(u.contaId, id, [aprovado.situacao]));
      return { pedido: pedidoPublico(aprovado, agora, tela), resultado: 'encerrado' as const, aviso: null, campanhaId: null };
    }
    try {
      const r = await this.servico.executar(u.contaId, id);
      const passou: SituacaoDoPedido[] = r.resultado === 'executado' ? ['aprovado', 'executando', 'executado'] : r.resultado === 'encerrado' ? ['aprovado', 'cancelado'] : ['aprovado'];
      depois(res, () => this.servico.depoisDaDecisao(u.contaId, id, passou));
      return {
        pedido: pedidoPublico(r.pedido, this.servico.agora(), tela),
        resultado: r.resultado,
        aviso: r.resultado === 'adiado' ? r.aviso : r.resultado === 'encerrado' ? r.recusa.message : null,
        campanhaId: r.resultado === 'executado' ? r.campanha.id : null,
      };
    } catch (erro) {
      // A execução recusou depois da aprovação (não deveria: o pedido acabou de ser aprovado nesta transação). A
      // aprovação fica, e a rotina tenta de novo.
      if (!(erro instanceof ErroDoPedido)) throw erro;
      depois(res, () => this.servico.depoisDaDecisao(u.contaId, id, ['aprovado']));
      return { pedido: pedidoPublico(aprovado, agora, tela), resultado: 'adiado' as const, aviso: erro.message, campanhaId: null };
    }
  }

  @Post(':id/recusar')
  @HttpCode(HttpStatus.OK)
  async recusar(
    @UsuarioAtual() u: UsuarioAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecusarDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const recusado = await this.servico.recusar(u, id, dto.motivo);
    depois(res, () => this.servico.depoisDaDecisao(u.contaId, id, ['recusado']));
    return { pedido: pedidoPublico(recusado, this.servico.agora(), this.servico.enderecoDaTela(id)) };
  }
}

/** Depois de a resposta sair (a transação do pedido já confirmou): o efeito para fora, que não lança. */
function depois(res: Response, fn: () => Promise<void>): void {
  res.once('finish', () => {
    void fn().catch(() => undefined);
  });
}
