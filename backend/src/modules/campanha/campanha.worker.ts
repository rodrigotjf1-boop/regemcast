/**
 * O worker das campanhas: quem de fato envia.
 *
 * A cada poucos segundos ele olha as campanhas `agendada` e `enviando` e dá uma
 * rodada em cada — enviando só o que a janela, a pausa e os tetos permitem.
 *
 * ## Por que não é Redis/BullMQ (ainda)
 *
 * A fila completa entra depois. Este worker resolve o que é urgente com o que já
 * existe, e o ponto que tornaria isso perigoso — duas réplicas enviando para a
 * mesma pessoa — está coberto no banco: a reivindicação usa `FOR UPDATE SKIP
 * LOCKED`, e a segunda réplica pula o que a primeira já pegou.
 *
 * O que o Redis traria a mais é distribuição fina entre réplicas e
 * reprocessamento com recuo. Útil em volume; não é o que impede envio duplicado.
 *
 * ## Por que uma campanha de cada vez
 *
 * As rodadas são SEQUENCIAIS entre campanhas. Em paralelo, dez contas
 * disparando ao mesmo tempo multiplicariam as chamadas à Meta por dez — e o
 * limite de chamadas é do APP, compartilhado por todos os clientes. Uma conta
 * grande derrubaria o envio das outras.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { CampanhaService } from './campanha.service';

/** Frequência das rodadas. A pausa mínima útil entre envios é da ordem disto. */
const INTERVALO_MS = 5_000;

/** A limpeza de presos não precisa de precisão de segundos. */
const INTERVALO_PRESOS_MS = 60_000;

@Injectable()
export class CampanhaWorker {
  private readonly log = new Logger('CampanhaWorker');

  /**
   * Trava de reentrância. Uma rodada que demora mais que o intervalo não pode
   * encavalar na seguinte — a de baixo ainda não terminou de gravar, e a de cima
   * contaria errado o que já saiu.
   */
  private rodando = false;
  private limpando = false;

  constructor(private readonly campanhas: CampanhaService) {}

  @Interval(INTERVALO_MS)
  async rodada(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;

    try {
      const ativas = await this.campanhas.campanhasAtivas();

      for (const id of ativas) {
        try {
          await this.campanhas.processarRodada(id);
        } catch (erro) {
          // Uma campanha com defeito não pode parar a fila das outras contas.
          this.log.error(`Rodada da campanha ${id} falhou: ${(erro as Error)?.message ?? erro}`);
        }
      }
    } catch (erro) {
      this.log.error(`Não consegui listar as campanhas ativas: ${(erro as Error)?.message ?? erro}`);
    } finally {
      this.rodando = false;
    }
  }

  @Interval(INTERVALO_PRESOS_MS)
  async limparPresos(): Promise<void> {
    if (this.limpando) return;
    this.limpando = true;

    try {
      const quantos = await this.campanhas.recuperarPresos();
      if (quantos > 0) {
        this.log.warn(
          `${quantos} destinatário(s) presos em "enviando" marcados como falha, sem reenvio — não dá para saber se a Meta recebeu.`,
        );
      }
    } catch (erro) {
      this.log.error(`Limpeza de presos falhou: ${(erro as Error)?.message ?? erro}`);
    } finally {
      this.limpando = false;
    }
  }
}
