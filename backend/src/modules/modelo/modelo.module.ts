import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { MetaModule } from '../meta/meta.module';
import { ModeloController } from './modelo.controller';
import { ModeloService } from './modelo.service';

/**
 * `MetaModule` entra pelo token do cliente e pelo cliente da Graph. Quem
 * manuseia credencial é um lugar só.
 */
@Module({
  imports: [DrizzleModule, AuditoriaModule, MetaModule],
  controllers: [ModeloController],
  providers: [ModeloService],
  exports: [ModeloService],
})
export class ModeloModule {}
