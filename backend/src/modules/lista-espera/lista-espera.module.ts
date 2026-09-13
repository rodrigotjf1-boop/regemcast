import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { DistTokenGuard } from './dist-token.guard';
import { ListaEsperaController } from './lista-espera.controller';
import { ListaEsperaService } from './lista-espera.service';

/**
 * `DrizzleModule` é @Global, mas entra aqui declarado mesmo assim: é o que
 * permite mover este módulo para outro projeto (ou montá-lo sozinho num teste
 * de integração) sem descobrir a dependência por erro de injeção.
 *
 * `AuditoriaService` vem do `AuditoriaModule`, que é @Global — por isso não
 * aparece nos imports, mas é dependência real deste módulo.
 */
@Module({
  imports: [DrizzleModule],
  controllers: [ListaEsperaController],
  providers: [ListaEsperaService, DistTokenGuard],
  exports: [ListaEsperaService],
})
export class ListaEsperaModule {}
