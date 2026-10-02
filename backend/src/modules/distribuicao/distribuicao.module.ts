import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { ListaEsperaModule } from '../lista-espera/lista-espera.module';
import { DistribuicaoAuthController } from './distribuicao-auth.controller';
import { DistribuicaoAuthService } from './distribuicao-auth.service';
import { DistribuicaoLeituraController } from './distribuicao-leitura.controller';
import { DistribuicaoLeituraService } from './distribuicao-leitura.service';
import { DistribuicaoListaEsperaController } from './distribuicao-lista-espera.controller';
import { DistribuicaoPlanosController } from './distribuicao-planos.controller';
import { DistribuicaoPlanosService } from './distribuicao-planos.service';
import { DistribuicaoTarifasController } from './distribuicao-tarifas.controller';
import { DistribuicaoTarifasService } from './distribuicao-tarifas.service';
import { DistribuicaoGuard } from './distribuicao.guard';

/**
 * O console de distribuição.
 *
 * O `JwtModule` já é registrado no AppModule; os tokens daqui NÃO usam o segredo
 * dele — cada assinatura passa `segredoDaDistribuicao()` explicitamente. É o que
 * impede um token de cliente de valer como token de operador.
 */
@Module({
  imports: [DrizzleModule, ListaEsperaModule],
  controllers: [DistribuicaoAuthController, DistribuicaoLeituraController, DistribuicaoListaEsperaController, DistribuicaoPlanosController, DistribuicaoTarifasController],
  providers: [DistribuicaoAuthService, DistribuicaoGuard, DistribuicaoLeituraService, DistribuicaoPlanosService, DistribuicaoTarifasService],
  exports: [DistribuicaoAuthService, DistribuicaoGuard],
})
export class DistribuicaoModule {}
