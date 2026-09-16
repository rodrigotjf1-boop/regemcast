import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { DistribuicaoAuthController } from './distribuicao-auth.controller';
import { DistribuicaoAuthService } from './distribuicao-auth.service';
import { DistribuicaoLeituraController } from './distribuicao-leitura.controller';
import { DistribuicaoLeituraService } from './distribuicao-leitura.service';
import { DistribuicaoGuard } from './distribuicao.guard';

/**
 * O console de distribuição.
 *
 * O `JwtModule` já é registrado no AppModule; os tokens daqui NÃO usam o segredo
 * dele — cada assinatura passa `segredoDaDistribuicao()` explicitamente. É o que
 * impede um token de cliente de valer como token de operador.
 */
@Module({
  imports: [DrizzleModule],
  controllers: [DistribuicaoAuthController, DistribuicaoLeituraController],
  providers: [DistribuicaoAuthService, DistribuicaoGuard, DistribuicaoLeituraService],
  exports: [DistribuicaoAuthService, DistribuicaoGuard],
})
export class DistribuicaoModule {}
