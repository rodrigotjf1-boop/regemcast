import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { CampanhaModule } from '../campanha/campanha.module';
import { MetaModule } from '../meta/meta.module';
import { AprovacaoController } from './aprovacao.controller';
import { AprovacaoJob } from './aprovacao.job';
import { AprovacaoService } from './aprovacao.service';
import { AvisoDeAprovacao } from './aviso-de-aprovacao.service';

/**
 * A aprovação de disparos (Hub DMS, F5 parte B; `docs/aprovacao-de-disparos.md`): o pedido que outro produto da DMS
 * faz pela porta MCP (as ferramentas ficam no `IntegracaoModule`, que importa este), a tela de quem aprova e a rotina
 * do prazo. `CampanhaModule` entra pelo disparo (o mesmo da tela) e `MetaModule` pelo texto do modelo que sai.
 * `AuditoriaModule`, `HubModule`, `EmailModule` e `AvisoModule` são globais.
 */
@Module({
  imports: [DrizzleModule, CampanhaModule, MetaModule],
  controllers: [AprovacaoController],
  providers: [AprovacaoService, AvisoDeAprovacao, AprovacaoJob],
  exports: [AprovacaoService],
})
export class AprovacaoModule {}
