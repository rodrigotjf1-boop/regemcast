/**
 * Contexto de banco por request — é o que faz a RLS funcionar de verdade.
 *
 * A policy do banco compara `conta_id` com o GUC `app.conta_id`. GUC definido
 * com `set_config(..., true)` vive só dentro da transação, então TODA consulta
 * precisa rodar dentro de uma transação que definiu o GUC antes. Este arquivo
 * é o único lugar que abre essas transações.
 *
 * Sem GUC nenhum, `current_setting('app.conta_id', true)` devolve null, a
 * policy não casa e a consulta volta vazia. Fail-closed por construção: um
 * caminho que esqueça de entrar em contexto não vaza dado de ninguém — ele
 * simplesmente não enxerga nada, e isso aparece no primeiro teste.
 *
 * O escopo 'sistema' existe para os poucos caminhos que precisam enxergar
 * antes de saber a conta:
 *   - login (achar o usuário pelo e-mail);
 *   - webhook da Meta (resolver a conta pelo phone_number_id);
 *   - jobs da fila (que carregam a conta no payload e imediatamente entram em
 *     escopo de conta).
 * São poucos, explícitos e greppáveis por `comEscopoSistema`.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE } from './tokens';
import type * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

type Escopo = 'tenant' | 'sistema';

interface Quadro {
  db: Db;
  contaId: string | null;
  escopo: Escopo;
}

const armazem = new AsyncLocalStorage<Quadro>();

@Injectable()
export class ContextoDb {
  constructor(@Inject(DRIZZLE) private readonly raiz: Db) {}

  /**
   * O handle que os services usam. Dentro de um contexto devolve a transação
   * corrente (com o GUC já definido); fora de contexto, estoura — porque uma
   * consulta fora de contexto rodaria sem isolamento e voltaria vazia, o que
   * é um bug difícil de enxergar em produção.
   */
  get db(): Db {
    const q = armazem.getStore();
    if (!q) {
      throw new Error(
        'Consulta fora de contexto de banco. Use comConta() ou comEscopoSistema().',
      );
    }
    return q.db;
  }

  get contaId(): string | null {
    return armazem.getStore()?.contaId ?? null;
  }

  /** A conta do request, exigida. Para uso em service que só roda autenticado. */
  contaObrigatoria(): string {
    const id = this.contaId;
    if (!id) throw new Error('Contexto sem conta definida.');
    return id;
  }

  /** Abre uma transação isolada na conta e roda `fn` dentro dela. */
  async comConta<T>(contaId: string, fn: (db: Db) => Promise<T>): Promise<T> {
    return this.raiz.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.conta_id', ${contaId}, true)`);
      await tx.execute(sql`select set_config('app.escopo', 'tenant', true)`);
      return armazem.run(
        { db: tx as unknown as Db, contaId, escopo: 'tenant' },
        () => fn(tx as unknown as Db),
      );
    });
  }

  /**
   * Escopo de sistema: enxerga todas as contas. Use apenas nos caminhos
   * listados no topo deste arquivo, e volte para `comConta` assim que a conta
   * for conhecida.
   */
  async comEscopoSistema<T>(motivo: string, fn: (db: Db) => Promise<T>): Promise<T> {
    return this.raiz.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.escopo', 'sistema', true)`);
      await tx.execute(sql`select set_config('app.motivo_sistema', ${motivo}, true)`);
      return armazem.run(
        { db: tx as unknown as Db, contaId: null, escopo: 'sistema' },
        () => fn(tx as unknown as Db),
      );
    });
  }
}
