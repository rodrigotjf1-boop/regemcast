import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { MetaModule } from '../meta/meta.module';
import { MidiaController } from './midia.controller';
import { MidiaService } from './midia.service';

/** Exporta o serviço porque o módulo de modelos troca a referência por handle. */
@Module({
  imports: [DrizzleModule, AuditoriaModule, MetaModule],
  controllers: [MidiaController],
  providers: [MidiaService],
  exports: [MidiaService],
})
export class MidiaModule {}
