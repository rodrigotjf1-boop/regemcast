import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { DistTokenGuard } from '../lista-espera/dist-token.guard';
import { AgendaService } from './agenda.service';
import { CoexistenciaJob } from './coexistencia.job';
import { ConversasService } from './conversas.service';
import { GraphService } from './graph.service';
import { LimiteJob } from './limite.job';
import { MetaController } from './meta.controller';
import { MetaService } from './meta.service';
import { WebhookController } from './webhook.controller';
import { WebhookRetomada } from './webhook.retomada';
import { WebhookService } from './webhook.service';

@Module({
  imports: [DrizzleModule],
  controllers: [MetaController, WebhookController],
  providers: [
    MetaService,
    GraphService,
    AgendaService,
    ConversasService,
    WebhookService,
    WebhookRetomada,
    CoexistenciaJob,
    LimiteJob,
    DistTokenGuard,
  ],
  exports: [MetaService, GraphService],
})
export class MetaModule {}
