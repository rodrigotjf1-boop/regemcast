import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { OrcamentoController } from './orcamento.controller';
import { OrcamentoJob } from './orcamento.job';
import { OrcamentoService } from './orcamento.service';

/**
 * O orçamento de disparos: as rotas da conta e o job que devolve à fila, na
 * virada do período, as campanhas que ele pausou.
 *
 * A rodada do envio não depende deste módulo: usa as funções de
 * `orcamento.consulta.ts` dentro da transação dela. `AuditoriaModule` é global.
 */
@Module({
  imports: [DrizzleModule],
  controllers: [OrcamentoController],
  providers: [OrcamentoService, OrcamentoJob],
  exports: [OrcamentoService],
})
export class OrcamentoModule {}
