import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { ContaController } from './conta.controller';
import { ContaService } from './conta.service';

/**
 * `DrizzleModule` é global, mas a dependência é declarada mesmo assim: módulo
 * que não declara o que usa quebra na injeção sem explicação quando sai do
 * contexto original. `AuditoriaModule` é global e exporta o service — não
 * precisa ser importado aqui.
 */
@Module({
  imports: [DrizzleModule],
  controllers: [ContaController],
  providers: [ContaService],
  exports: [ContaService],
})
export class ContaModule {}
