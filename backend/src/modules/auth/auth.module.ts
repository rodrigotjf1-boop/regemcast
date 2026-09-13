import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * DrizzleModule é @Global, mas está importado aqui de propósito: a dependência
 * fica declarada, e mover este módulo para outro projeto quebra no import — que
 * é um erro legível — em vez de quebrar na injeção sem explicação.
 *
 * O JwtService vem do JwtModule registrado com `global: true` no AppModule; é
 * registro único para não existirem duas configurações de assinatura no mesmo
 * processo.
 */
@Module({
  imports: [DrizzleModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
