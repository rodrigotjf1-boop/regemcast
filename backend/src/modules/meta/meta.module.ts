import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { GraphService } from './graph.service';
import { MetaController } from './meta.controller';
import { MetaService } from './meta.service';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

@Module({
  imports: [DrizzleModule],
  controllers: [MetaController, WebhookController],
  providers: [MetaService, GraphService, WebhookService],
  exports: [MetaService, GraphService],
})
export class MetaModule {}
