/**
 * A rotina da aprovação de disparos (Hub DMS, F5 parte B), a cada minuto:
 *
 * 1. vence o que passou do prazo de 24 horas (nada sai);
 * 2. manda o lembrete a quem aprova na metade do prazo, uma vez;
 * 3. tenta de novo o aprovado que não saiu (a execução foi adiada porque o
 *    disparo recusou ou a Meta não respondeu, ou o processo caiu), até o prazo.
 *
 * Cada passo de todas as contas é uma leitura curta em escopo de sistema; a
 * execução de cada pedido roda na conta dele (`comConta`). O registro no hub e
 * os avisos saem depois do commit, e nada aqui lança (derrubaria o agendador).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import type { SituacaoDoPedido } from '../../dms/integracao-dms';
import { AprovacaoService } from './aprovacao.service';

const INTERVALO_MS = 60_000;

@Injectable()
export class AprovacaoJob {
  private readonly log = new Logger('Aprovacao');
  private rodando = false;

  constructor(private readonly aprovacoes: AprovacaoService) {}

  @Interval(INTERVALO_MS)
  async rodada(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      const vencidos = await this.aprovacoes.vencer();
      const lembrados = await this.aprovacoes.lembrar();
      await this.aprovacoes.depoisDaRotina(vencidos, lembrados);
      for (const p of await this.aprovacoes.aprovadosParados()) {
        try {
          const r = await this.aprovacoes.executarNaConta(p.contaId, p.id);
          if (!r) continue;
          const passou: SituacaoDoPedido[] = r.resultado === 'executado' ? ['executando', 'executado'] : r.resultado === 'encerrado' ? ['cancelado'] : [];
          if (passou.length) await this.aprovacoes.depoisDaDecisao(p.contaId, p.id, passou);
          if (r.resultado === 'adiado') this.log.log(`Pedido ${p.id} segue aprovado: ${r.aviso}`);
        } catch (erro) {
          // Um pedido com defeito não para os das outras contas.
          this.log.error(`Execução do pedido ${p.id} falhou: ${(erro as Error)?.message ?? String(erro)}`);
        }
      }
    } catch (erro) {
      this.log.error(`Rotina da aprovação de disparos falhou: ${(erro as Error)?.message ?? String(erro)}`);
    } finally {
      this.rodando = false;
    }
  }
}
