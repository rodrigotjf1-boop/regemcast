import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { MetaModule } from '../meta/meta.module';
import { ConversaController } from './conversa.controller';
import { ConversaRetencao } from './conversa.retencao';
import { ConversaService } from './conversa.service';

/**
 * A tela de conversas. Importa o MetaModule (Graph e credencial); o lado que
 * GRAVA o que chega do webhook mora no próprio MetaModule — assim não há ciclo.
 */
@Module({
  imports: [DrizzleModule, MetaModule],
  controllers: [ConversaController],
  providers: [ConversaService, ConversaRetencao],
  exports: [ConversaService],
})
export class ConversaModule {}
