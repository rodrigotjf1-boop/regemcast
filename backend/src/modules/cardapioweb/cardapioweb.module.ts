import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { CardapiowebCliente } from './cardapioweb.cliente';
import { CardapiowebController } from './cardapioweb.controller';
import { CardapiowebJob } from './cardapioweb.job';
import { CardapiowebService } from './cardapioweb.service';

/** Conexão com a loja do Cardápio Web: importar a base de clientes. */
@Module({
  imports: [DrizzleModule, AuditoriaModule],
  controllers: [CardapiowebController],
  providers: [CardapiowebCliente, CardapiowebService, CardapiowebJob],
})
export class CardapiowebModule {}
