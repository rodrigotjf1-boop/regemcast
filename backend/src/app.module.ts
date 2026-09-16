import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AuthGuard } from './common/auth.guard';
import { ErroFilter } from './common/erro.filter';
import { env } from './config/env';
import { ContextoInterceptor } from './db/contexto.interceptor';
import { DrizzleModule } from './db/drizzle.module';
import { AuditoriaModule } from './modules/auditoria/auditoria.module';
import { AuthModule } from './modules/auth/auth.module';
import { ContaModule } from './modules/conta/conta.module';
import { ContatoModule } from './modules/contato/contato.module';
import { ListaEsperaModule } from './modules/lista-espera/lista-espera.module';
import { CampanhaModule } from './modules/campanha/campanha.module';
import { MetaModule } from './modules/meta/meta.module';
import { ModeloModule } from './modules/modelo/modelo.module';
import { SaudeModule } from './modules/saude/saude.module';

@Module({
  imports: [
    DrizzleModule,
    // Agendador: hoje só a retomada de webhooks pendentes (ver
    // modules/meta/webhook.retomada.ts).
    ScheduleModule.forRoot(),
    JwtModule.register({
      global: true,
      secret: env.sessao.segredo,
      signOptions: { expiresIn: `${env.sessao.ttlHoras}h` },
    }),
    /**
     * Teto por IP. As rotas sensíveis (login, cadastro na lista de espera)
     * apertam isso com `@Throttle` próprio — no Regem o `@Throttle` da rota
     * pública repete exatamente os valores do teto global, então não aperta
     * nada e passa falsa sensação de proteção.
     *
     * O contador vive no REDIS, não na memória do processo. Medido em
     * produção com o storage padrão: 25 tentativas de login seguidas
     * produziram `401` até a 13ª, e um `401` no meio dos `429` — assinatura de
     * balde por réplica. Com mais de uma instância, o limite real vira
     * N × limite, e cada deploy zera a contagem. Para um portão de força
     * bruta, isso é o mesmo que não ter portão.
     */
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [{ ttl: 60_000, limit: 120 }],
        // Em dev-local o padrão em memória basta: é um processo só, e exigir
        // Redis para rodar a API na sua máquina é atrito sem ganho.
        ...(env.producao ? { storage: new ThrottlerStorageRedisService(env.redis.url) } : {}),
      }),
    }),
    AuditoriaModule,
    AuthModule,
    ContaModule,
    ListaEsperaModule,
    MetaModule,
    CampanhaModule,
    ContatoModule,
    ModeloModule,
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
