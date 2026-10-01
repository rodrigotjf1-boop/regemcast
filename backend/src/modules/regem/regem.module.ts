import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { DistribuicaoModule } from '../distribuicao/distribuicao.module';
import { RegemCliente } from './regem.cliente';
import { RegemController } from './regem.controller';
import { RegemDistribuicaoController } from './regem-distribuicao.controller';
import { RegemJob } from './regem.job';
import { RegemService } from './regem.service';

/** A empresa no Regem como fonte de clientes e compras: cardápio próprio, Anota Aí, delivery direto e, autorizada, a 99. */
@Module({
  imports: [DrizzleModule, AuditoriaModule, DistribuicaoModule],
  controllers: [RegemController, RegemDistribuicaoController],
  providers: [RegemCliente, RegemService, RegemJob],
})
export class RegemModule {}
