/**
 * @Global porque praticamente todo módulo registra auditoria — obrigar cada um
 * a importar este módulo só produziria import repetido sem ganho nenhum.
 *
 * O DrizzleModule (também global) já exporta o ContextoDb de que o service
 * depende; a importação explícita aqui mantém o grafo legível e faz o módulo
 * continuar de pé se um dia o DrizzleModule deixar de ser global.
 */
import { Global, Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { AuditoriaController } from './auditoria.controller';
import { AuditoriaService } from './auditoria.service';

@Global()
@Module({
  imports: [DrizzleModule],
  controllers: [AuditoriaController],
  providers: [AuditoriaService],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
