import { Global, Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { TelemetriaService } from './telemetria.service';

/**
 * Global de propósito.
 *
 * Telemetria é consumida por quem trata erro — o filtro global, o worker de
 * campanha, o webhook — e não por uma feature. Obrigar cada módulo a importá-la
 * é o jeito mais seguro de algum caminho de erro ficar sem registro porque
 * alguém esqueceu um import.
 */
@Global()
@Module({
  imports: [DrizzleModule],
  providers: [TelemetriaService],
  exports: [TelemetriaService],
})
export class TelemetriaModule {}
