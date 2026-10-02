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
import { SaudeJob } from './saude.job';
import { SaudeService } from './saude.service';
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
    SaudeService,
    SaudeJob,
    DistTokenGuard,
  ],
  exports: [MetaService, GraphService, SaudeService],
})
export class MetaModule {}
