/**
 * Pool do Postgres + Drizzle.
 *
 * @Global de propósito, mas com uma diferença em relação ao Regem: lá o módulo
 * é global e os módulos de domínio não declaram a dependência, então copiar um
 * módulo isolado para outro projeto quebra na injeção sem explicação. Aqui o
 * ContextoDb é exportado junto e os módulos importam DrizzleModule
 * explicitamente.
 */
import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { env } from '../config/env';
import { ContextoDb } from './contexto';
import * as schema from './schema';
import { DRIZZLE, PG_POOL } from './tokens';

// Re-export para quem já importa daqui; a definição vive em ./tokens para
// não fechar ciclo com ./contexto.
export { DRIZZLE, PG_POOL } from './tokens';

function sslDoAmbiente() {
  const modo = env.banco.ssl;
  if (modo === 'disable' || modo === 'false' || modo === '') return false;
  // Certificado verificado de verdade. Desligar a verificação faz do TLS
  // teatro: continua criptografado e continua interceptável.
  return { rejectUnauthorized: true };
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => {
        const pool = new Pool({
          connectionString: env.banco.url,
          ssl: sslDoAmbiente(),
          max: env.banco.poolMax,
          // Um socket pendurado não pode segurar um worker de disparo.
          connectionTimeoutMillis: 10_000,
          idleTimeoutMillis: 30_000,
          statement_timeout: 30_000,
        });
        pool.on('error', (erro) => {
          new Logger('PgPool').error(
            `Conexão ociosa caiu: ${erro.message}`,
            erro.stack,
          );
        });
        return pool;
      },
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => drizzle(pool, { schema }),
    },
    ContextoDb,
  ],
  exports: [DRIZZLE, PG_POOL, ContextoDb],
})
export class DrizzleModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown() {
    await this.pool.end().catch(() => undefined);
  }
}
