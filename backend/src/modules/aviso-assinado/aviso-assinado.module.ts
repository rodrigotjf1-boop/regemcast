import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { AvisoAssinadoJob } from './aviso-assinado.job';
import { AvisoAssinadoService } from './aviso-assinado.service';

/**
 * O aviso assinado a quem pediu (Hub DMS, F5 parte B, PR 3; `docs/aprovacao-de-disparos.md`): o registro pela porta
 * MCP (as ferramentas ficam no `IntegracaoModule`, que importa este) e a rotina que entrega. `AuditoriaModule` e
 * `HubModule` são globais.
 */
@Module({
  imports: [DrizzleModule],
  providers: [AvisoAssinadoService, AvisoAssinadoJob],
  exports: [AvisoAssinadoService],
})
export class AvisoAssinadoModule {}
