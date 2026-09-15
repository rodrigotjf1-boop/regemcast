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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { env } from '../config/env';
import { ContextoDb } from './contexto';
import * as schema from './schema';
import { DRIZZLE, PG_POOL } from './tokens';

// Re-export para quem já importa daqui; a definição vive em ./tokens para
// não fechar ciclo com ./contexto.
export { DRIZZLE, PG_POOL } from './tokens';

/**
 * TLS da conexão com o banco.
 *
 * `DATABASE_SSL` aceita:
 *   disable    — sem TLS. Só dev-local.
 *   require    — TLS com verificação pelas CAs do sistema.
 *   supabase   — TLS com verificação pela CA raiz do Supabase (embutida em
 *                `certs/`). É o valor certo para Supabase, direto ou pelo
 *                pooler: a raiz deles é auto-assinada e não está no bundle do
 *                Node, então `require` puro falha com
 *                `SELF_SIGNED_CERT_IN_CHAIN`.
 *   no-verify  — TLS SEM verificar quem está do outro lado. Escape de
 *                emergência; grita no log toda vez que sobe.
 *
 * `DATABASE_CA_CERT` sobrepõe tudo: aceita o PEM inteiro ou o PEM em base64
 * (variável de ambiente multi-linha é problema em painel de deploy).
 *
 * Por que não `rejectUnauthorized: false` e pronto, que é o que a maioria dos
 * tutoriais manda: aquilo mantém a criptografia e joga fora a autenticação —
 * continua interceptável, porque nada garante que do outro lado está mesmo o
 * banco. Com a raiz em mãos, a verificação é real e custa um arquivo de 1 KB.
 */
function sslDoAmbiente(): false | { rejectUnauthorized: boolean; ca?: string } {
  const modo = env.banco.ssl;
  if (modo === 'disable' || modo === 'false' || modo === '') return false;

  if (env.banco.caCert) {
    return { rejectUnauthorized: true, ca: env.banco.caCert };
  }

  if (modo === 'no-verify') {
    new Logger('PgPool').warn(
      'DATABASE_SSL=no-verify: a identidade do banco NÃO está sendo verificada. ' +
        'A conexão é criptografada, mas interceptável. Use DATABASE_SSL=supabase ' +
        '(ou informe DATABASE_CA_CERT) assim que possível.',
    );
    return { rejectUnauthorized: false };
  }

  if (modo === 'supabase') {
    const caminho = resolve(__dirname, '..', '..', 'certs', 'supabase-root-2021.crt');
    try {
      return { rejectUnauthorized: true, ca: readFileSync(caminho, 'utf8') };
    } catch (erro) {
      throw new Error(
        `DATABASE_SSL=supabase, mas não consegui ler a CA em ${caminho}: ` +
          `${(erro as Error).message}. O arquivo vem no repositório em backend/certs/.`,
      );
    }
  }

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
