import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { CoexistenciaJob } from './coexistencia.job';
import { GraphService } from './graph.service';
import { MetaController } from './meta.controller';
import { MetaService } from './meta.service';
import { WebhookController } from './webhook.controller';
import { WebhookRetomada } from './webhook.retomada';
import { WebhookService } from './webhook.service';

@Module({
  imports: [DrizzleModule],
  controllers: [MetaController, WebhookController],
  providers: [MetaService, GraphService, WebhookService, WebhookRetomada, CoexistenciaJob],
  exports: [MetaService, GraphService],
})
export class MetaModule {}
