import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { CobrancaController, WebhookMercadoPagoController } from './cobranca.controller';
import { CobrancaJob } from './cobranca.job';
import { CobrancaService } from './cobranca.service';
import { MercadoPagoService } from './mercadopago.service';

/** Plano pago: Mercado Pago, avisos, fim do grátis e inadimplência. */
@Module({
  imports: [DrizzleModule],
  controllers: [CobrancaController, WebhookMercadoPagoController],
  providers: [CobrancaService, MercadoPagoService, CobrancaJob],
  exports: [CobrancaService],
})
export class CobrancaModule {}
