import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AuthGuard } from './common/auth.guard';
import { ErroFilter } from './common/erro.filter';
import { env } from './config/env';
import { ContextoInterceptor } from './db/contexto.interceptor';
import { DrizzleModule } from './db/drizzle.module';
import { AuditoriaModule } from './modules/auditoria/auditoria.module';
import { AuthModule } from './modules/auth/auth.module';
import { ContaModule } from './modules/conta/conta.module';
import { ListaEsperaModule } from './modules/lista-espera/lista-espera.module';
import { SaudeModule } from './modules/saude/saude.module';

@Module({
  imports: [
    DrizzleModule,
    JwtModule.register({
      global: true,
      secret: env.sessao.segredo,
      signOptions: { expiresIn: `${env.sessao.ttlHoras}h` },
    }),
    // Teto grosseiro por IP. As rotas sensíveis (login, cadastro na lista de
    // espera) apertam isso com @Throttle próprio — no Regem o @Throttle da
    // rota pública repete exatamente os valores do teto global, então não
    // aperta nada e passa a falsa sensação de proteção.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    AuditoriaModule,
    AuthModule,
    ContaModule,
    ListaEsperaModule,
    SaudeModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Autenticação GLOBAL: rota nova nasce protegida. A exceção é explícita,
    // com @Publico().
    { provide: APP_GUARD, useClass: AuthGuard },
    // Roda depois do guard, então já conhece a conta e abre a transação com o
    // GUC que a RLS exige.
    { provide: APP_INTERCEPTOR, useClass: ContextoInterceptor },
    { provide: APP_FILTER, useClass: ErroFilter },
  ],
})
export class AppModule {}
