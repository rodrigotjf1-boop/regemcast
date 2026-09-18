import { Global, Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { AvisoController } from './aviso.controller';
import { AvisoService } from './aviso.service';
import { FcmService } from './fcm.service';

/**
 * Global pelo mesmo motivo da telemetria: quem avisa é o worker de campanha, o
 * webhook da Meta e a cobrança — três módulos que não deveriam depender uns
 * dos outros só para mandar um push.
 */
@Global()
@Module({
  imports: [DrizzleModule],
  controllers: [AvisoController],
  providers: [AvisoService, FcmService],
  exports: [AvisoService],
})
export class AvisoModule {}
