import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { DmsGraphController } from './dms-graph.controller';
import { DmsGraphService } from './dms-graph.service';

/** O DMS Graph (produto da DMS, não a Graph API da Meta): a ligação da conta e o ajuste do vídeo do cabeçalho. */
@Module({
  imports: [DrizzleModule, AuditoriaModule],
  controllers: [DmsGraphController],
  providers: [DmsGraphService],
})
export class DmsGraphModule {}
