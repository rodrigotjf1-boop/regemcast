import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { CardapiowebService } from './cardapioweb.service';

/**
 * Retoma importações que ficaram órfãs.
 *
 * A importação roda em segundo plano dentro do processo da API. Se o servidor
 * reiniciar no meio (deploy, queda), a linha fica em "rodando" sem ninguém
 * cuidando dela. A cada minuto este job procura as que não gravam progresso há
 * mais de 2 minutos e continua da página seguinte à última gravada — nada é
 * importado duas vezes, porque a gravação não sobrescreve contato existente.
 */
@Injectable()
export class CardapiowebJob {
  private readonly log = new Logger('CardapioWeb');

  constructor(private readonly servico: CardapiowebService) {}

  @Interval(60_000)
  async retomar(): Promise<void> {
    try {
      const n = await this.servico.retomarOrfas();
      if (n) this.log.warn(`Cardápio Web: ${n} importação(ões) retomada(s) após interrupção.`);
    } catch (erro) {
      this.log.error(`Cardápio Web: falha ao procurar importações órfãs: ${String(erro)}`);
    }
  }
}
