/**
 * Plano e pagamento: a tela do cliente e o aviso do Mercado Pago.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsOptional, IsUUID } from 'class-validator';
import type { Request, Response } from 'express';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { DonoGuard } from '../../common/dono.guard';
import { Publico } from '../../common/publico.decorator';
import { UsuarioAtual } from '../../common/usuario-atual.decorator';
import { CobrancaService, type ResultadoContratacao, type SituacaoCobranca } from './cobranca.service';

class ContratarDto {
  @IsUUID('all', { message: 'Escolha um plano.' })
  planoId!: string;

  /** E-mail da conta do Mercado Pago que vai pagar, quando for outro que o do login. */
  @IsOptional()
  @IsEmail({}, { message: 'Informe um e-mail válido para o pagamento.' })
  emailPagador?: string;
}

@ApiTags('cobranca')
@Controller('plano')
export class CobrancaController {
  constructor(private readonly cobranca: CobrancaService) {}

  @Get()
  @ApiOperation({ summary: 'Plano, assinatura, planos disponíveis e histórico de pagamentos' })
  situacao(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<SituacaoCobranca> {
    return this.cobranca.situacao(usuario.contaId);
  }

  @Post('contratar')
  @UseGuards(DonoGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Contrata ou troca o plano (devolve o link do Mercado Pago quando precisa pagar)' })
  contratar(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: ContratarDto): Promise<ResultadoContratacao> {
    return this.cobranca.contratar(usuario.contaId, usuario, dto.planoId, dto.emailPagador);
  }

  @Post('cancelar')
  @UseGuards(DonoGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancela a renovação; o plano vale até o fim do ciclo pago' })
  cancelar(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<{ vigenteAte: string | null }> {
    return this.cobranca.cancelar(usuario.contaId, usuario);
  }
}

/**
 * O endereço que o Mercado Pago chama a cada mudança de assinatura ou fatura.
 *
 * Público (quem chama é o Mercado Pago), mas nada passa sem a assinatura do
 * aviso conferida — e mesmo assim o estado é relido na API dele.
 *
 * Respostas: 200 quando processou ou ignorou; 401 quando a assinatura não
 * confere (o Mercado Pago tenta de novo — útil se o segredo estiver errado na
 * configuração); erro 5xx quando o processamento falhou e deve ser tentado de
 * novo.
 */
@ApiTags('cobranca')
@Controller('webhooks/mercadopago')
export class WebhookMercadoPagoController {
  constructor(private readonly cobranca: CobrancaService) {}

  @Publico()
  // O Mercado Pago manda poucos avisos por conta; 300/min por IP folga para
  // reenvios em massa e segura quem martela o endereço público.
  @Throttle({ default: { ttl: 60_000, limit: 300 } })
  @Post()
  @ApiOperation({ summary: 'Aviso do Mercado Pago (assinaturas e faturas)' })
  async receber(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('data.id') dataIdQuery?: string,
    @Query('type') tipoQuery?: string,
  ): Promise<{ recebido: boolean; resultado: string }> {
    const corpo = (req.body ?? {}) as { type?: string; topic?: string; data?: { id?: string | number } };
    const topico = String(tipoQuery ?? corpo.type ?? corpo.topic ?? '').trim();
    const dataId = String(dataIdQuery ?? corpo.data?.id ?? '').trim();

    if (!topico || !dataId) {
      res.status(HttpStatus.BAD_REQUEST);
      return { recebido: false, resultado: 'aviso sem tópico ou id' };
    }

    const cabecalho = (nome: string) => {
      const v = req.headers[nome];
      return Array.isArray(v) ? v[0] : v;
    };

    const resultado = await this.cobranca.processarAviso({
      topico,
      dataId,
      requestId: cabecalho('x-request-id'),
      xSignature: cabecalho('x-signature'),
    });

    if (resultado === 'rejeitado') res.status(HttpStatus.UNAUTHORIZED);
    else res.status(HttpStatus.OK);
    return { recebido: resultado !== 'rejeitado', resultado };
  }
}
