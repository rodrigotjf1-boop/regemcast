/**
 * Devolve à fila as campanhas que o orçamento de disparos pausou, quando o
 * período vira.
 *
 * A rodada do envio, ao pausar pelo orçamento, guarda em `campanha.retomar_em`
 * a hora em que o teto que encheu zera (o dia seguinte, a segunda-feira ou o
 * dia 1º, no fuso da conta). Este job só olha essa hora: um `update` para todas
 * as contas, a cada minuto. Quem volta é conferido de novo pela rodada — se
 * outro teto ainda estiver cheio, pausa outra vez, sem aviso repetido.
 *
 * Escopo de sistema: job sem conta (motivo A, `docs/rls.md`).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { ContextoDb } from '../../db/contexto';
import { retomarPausadasPeloOrcamento } from './orcamento.consulta';

const INTERVALO_MS = 60_000;

@Injectable()
export class OrcamentoJob {
  private readonly log = new Logger('OrcamentoDeDisparos');
  private rodando = false;

  constructor(private readonly ctx: ContextoDb) {}

  @Interval(INTERVALO_MS)
  async acompanhar(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      await this.retomarNaVirada();
    } catch (erro) {
      // Nunca deixa subir: exceção aqui derruba o agendador.
      this.log.error(`Retomada pelo orçamento falhou: ${(erro as Error)?.message ?? String(erro)}`, (erro as Error)?.stack);
    } finally {
      this.rodando = false;
    }
  }

  /** Devolve à fila as campanhas cuja hora de voltar chegou. Devolve quantas. */
  async retomarNaVirada(): Promise<number> {
    const retomadas = await this.ctx.comEscopoSistema('orcamento.retomar', (db) => retomarPausadasPeloOrcamento(db));
    if (retomadas) this.log.log(`${retomadas} campanha(s) voltaram para a fila: o período do orçamento virou.`);
    return retomadas;
  }
}
