import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { DistTokenGuard } from '../lista-espera/dist-token.guard';
import { SaudeController } from './saude.controller';
import { SaudeService } from './saude.service';

/**
 * `DrizzleModule` entra pelo `PG_POOL`, usado no `select 1` do readiness.
 *
 * `DistTokenGuard` está declarado porque `/saude/pronto/detalhe` — a rota que
 * devolve o motivo real da falha — é do console de distribuição, não do
 * cliente. O guard não tem dependência injetada, então o Nest o instanciaria
 * sozinho; declarar deixa a dependência visível a quem lê o módulo.
 */
@Module({
  imports: [DrizzleModule],
  controllers: [SaudeController],
  providers: [SaudeService, DistTokenGuard],
})
export class SaudeModule {}
