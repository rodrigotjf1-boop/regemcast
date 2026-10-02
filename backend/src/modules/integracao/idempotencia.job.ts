/**
 * Apaga as chaves de idempotência que passaram do prazo.
 *
 * A chave existe para a repetição que vem logo depois (a rede caiu, a resposta
 * se perdeu). Passadas 24 horas ela não protege mais ninguém, e a resposta
 * guardada é uma cópia de dado da conta que não precisa ficar.
 *
 * Escopo de sistema: job sem conta (motivo A, `docs/rls.md`). Um `delete` pela
 * data, de hora em hora.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';

import { ContextoDb } from '../../db/contexto';
import { PRAZO_HORAS } from './idempotencia.regras';

const INTERVALO_MS = 60 * 60_000;

@Injectable()
export class IdempotenciaJob {
  private readonly log = new Logger('Integracao');
  private rodando = false;

  constructor(private readonly ctx: ContextoDb) {}

  @Interval(INTERVALO_MS)
  async limpar(): Promise<number> {
    if (this.rodando) return 0;
    this.rodando = true;
    try {
      return await this.ctx.comEscopoSistema('integracao.idempotencia.limpar', async (db) => {
        const r = await db.execute(sql`
          delete from integracao_idempotencia
           where criado_em < now() - make_interval(hours => ${PRAZO_HORAS})
        `);
        return r.rowCount ?? 0;
      });
    } catch (erro) {
      // Nunca deixa subir: exceção aqui derruba o agendador.
      this.log.error(`Limpeza das chaves de idempotência falhou: ${(erro as Error)?.message ?? String(erro)}`);
      return 0;
    } finally {
      this.rodando = false;
    }
  }
}
