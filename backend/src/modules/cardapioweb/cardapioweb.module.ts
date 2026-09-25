import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { CardapiowebCliente } from './cardapioweb.cliente';
import { CardapiowebController } from './cardapioweb.controller';
import { CardapiowebJob } from './cardapioweb.job';
import { CardapiowebPedidosJob } from './cardapioweb.pedidos.job';
import { PedidosCardapiowebService } from './cardapioweb.pedidos.service';
import { CardapiowebService } from './cardapioweb.service';

/** Conexão com a loja do Cardápio Web: a base de clientes e as compras (pedidos). */
@Module({
  imports: [DrizzleModule, AuditoriaModule],
  controllers: [CardapiowebController],
  providers: [CardapiowebCliente, CardapiowebService, CardapiowebJob, PedidosCardapiowebService, CardapiowebPedidosJob],
})
export class CardapiowebModule {}
