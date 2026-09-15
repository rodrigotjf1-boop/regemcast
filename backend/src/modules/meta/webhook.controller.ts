/**
 * Webhook da Meta.
 *
 * Um único endereço recebe os eventos de TODOS os clientes; a separação é
 * lógica, pelo `phone_number_id` que vem no payload.
 *
 * Duas diferenças em relação ao Regem, e as duas vêm de defeito observado lá:
 *
 * 1. **O evento é gravado antes de qualquer efeito colateral.** Lá o controller
 *    responde 200 e chama `processar(body)` sem `await`: um deploy no meio do
 *    processamento perde o evento em definitivo, porque a Meta já recebeu 200 e
 *    não reenvia. Aqui grava, responde 200, e processa depois — podendo repetir
 *    sem duplicar efeito.
 *
 * 2. **O roteamento lê a tabela de números.** Lá a resolução consulta uma
 *    coluna espelho que só é escrita para um dos papéis, então todo evento do
 *    número de marketing — inclusive o clique em "Sair das ofertas" — cai em
 *    "não vinculado a nenhuma loja" e é descartado com um warn.
 */
import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createHmac } from 'node:crypto';
import type { Request } from 'express';

import { Publico } from '../../common/publico.decorator';
import { env } from '../../config/env';
import { segredosIguais } from './cripto';
import { WebhookService } from './webhook.service';

/** O corpo cru, que o `rawBody: true` do main.ts preserva. */
interface RequestComRaw extends Request {
  rawBody?: Buffer;
}

@Controller('meta/webhook')
export class WebhookController {
  private readonly log = new Logger('MetaWebhook');

  constructor(private readonly servico: WebhookService) {}

  /**
   * Handshake de verificação. A Meta chama uma vez, ao configurar a URL, e
   * espera receber o `hub.challenge` de volta em texto puro.
   *
   * Fail-closed: sem `META_VERIFY_TOKEN` configurado, recusa. Um webhook que
   * aceita qualquer um é um webhook que qualquer um configura.
   */
  @Get()
  @Publico()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  verificar(
    @Query('hub.mode') modo: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') desafio: string,
  ): string {
    const esperado = env.meta.verifyToken;
    if (!esperado) {
      this.log.error('META_VERIFY_TOKEN não está definido — recusando a verificação.');
      throw new UnauthorizedException('Webhook não configurado.');
    }
    if (modo !== 'subscribe' || !segredosIguais(token ?? '', esperado)) {
      this.log.warn('Verificação do webhook recusada: token não confere.');
      throw new UnauthorizedException('Token de verificação inválido.');
    }
    return desafio ?? '';
  }

  /**
   * Recebe os eventos.
   *
   * O limite é alto de propósito: a Meta entrega em lote, e devolver 429 para
   * ela conta como falha de entrega — acumulando, ela desativa a assinatura.
   */
  @Post()
  @Publico()
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 1_200 } })
  async receber(@Req() req: RequestComRaw): Promise<{ recebido: true }> {
    const assinatura = req.headers['x-hub-signature-256'];
    const cru = req.rawBody;

    if (!cru || !cru.length) {
      // Sem rawBody, a assinatura não tem como ser conferida. É defeito de
      // configuração nosso (falta `rawBody: true` no bootstrap), e o sintoma
      // seria silencioso: a Meta simplesmente pararia de entregar.
      this.log.error(
        'Requisição sem rawBody — a assinatura não pode ser verificada. ' +
          'Confira `NestFactory.create(..., { rawBody: true })` no main.ts.',
      );
      throw new BadRequestException('Corpo da requisição ausente.');
    }

    if (!this.assinaturaConfere(cru, assinatura)) {
      this.log.warn('Evento recusado: assinatura X-Hub-Signature-256 não confere.');
      throw new UnauthorizedException('Assinatura inválida.');
    }

    let corpo: unknown;
    try {
      corpo = JSON.parse(cru.toString('utf8'));
    } catch {
      throw new BadRequestException('Corpo não é JSON válido.');
    }

    // Grava e responde. O processamento acontece depois — se cair no meio, o
    // evento continua na tabela e é retomado.
    await this.servico.registrar(corpo);

    // Não esperamos o processamento: a Meta corta a conexão e reenvia se o 200
    // demorar. `void` aqui é deliberado, e seguro porque o evento já está
    // gravado — diferente do Regem, onde o `processar()` sem await É o único
    // lugar onde o evento existe.
    void this.servico.processarPendentes().catch((erro) => {
      this.log.error(`Falha ao processar eventos pendentes: ${(erro as Error).message}`);
    });

    return { recebido: true };
  }

  /**
   * HMAC-SHA256 sobre os BYTES do corpo, com o app secret.
   *
   * Tem que ser sobre o corpo cru: reserializar o JSON muda espaços e ordem de
   * chaves, e a assinatura deixa de bater. É o motivo de o `rawBody` existir.
   */
  private assinaturaConfere(cru: Buffer, cabecalho: unknown): boolean {
    if (!env.meta.appSecret) {
      this.log.error('META_APP_SECRET não está definido — recusando todo evento.');
      return false;
    }
    const recebida = typeof cabecalho === 'string' ? cabecalho : '';
    if (!recebida.startsWith('sha256=')) return false;

    const calculada =
      'sha256=' + createHmac('sha256', env.meta.appSecret).update(cru).digest('hex');

    return segredosIguais(recebida, calculada);
  }
}
