import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { CardapiowebCliente } from './cardapioweb.cliente';
import { CardapiowebController } from './cardapioweb.controller';
import { CardapiowebJob } from './cardapioweb.job';
import { CardapiowebPedidosJob } from './cardapioweb.pedidos.job';
import { PedidosCardapiowebService } from './cardapioweb.pedidos.service';
import { CardapiowebSaldosJob } from './cardapioweb.saldos.job';
import { SaldosCardapiowebService } from './cardapioweb.saldos.service';
import { CardapiowebService } from './cardapioweb.service';

/** Conexão com a loja do Cardápio Web: a base de clientes, as compras (pedidos) e o cashback. */
@Module({
  imports: [DrizzleModule, AuditoriaModule],
  controllers: [CardapiowebController],
  providers: [
    CardapiowebCliente,
    CardapiowebService,
    CardapiowebJob,
    PedidosCardapiowebService,
    CardapiowebPedidosJob,
    SaldosCardapiowebService,
    CardapiowebSaldosJob,
  ],
})
export class CardapiowebModule {}
