/**
 * Retomada dos eventos que ficaram para trás.
 *
 * Sem isto, `processarPendentes()` só roda quando chega um webhook novo — e um
 * evento que falhou fica parado até a Meta mandar outro. Numa conta com pouco
 * movimento, "outro evento" pode ser amanhã; num incidente que derrube o banco
 * por um minuto, o lote inteiro daquele minuto congela.
 *
 * O intervalo é folgado de propósito: o caminho normal é o próprio webhook
 * disparar o processamento. Este laço é a rede de segurança, não o motor.
 *
 * `disabled: false` e o lock em memória bastam por enquanto porque o serviço
 * roda em uma instância. Quando houver mais de uma, isto vira job de fila com
 * lock no Redis — o mesmo caminho que o disparo vai tomar na Fase 4. Está
 * anotado aqui para não virar surpresa: hoje, com N réplicas, N instâncias
 * processam o mesmo lote, e o que segura a duplicação é o `processado_em` na
 * própria linha, não a exclusão mútua.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { AgendaService } from './agenda.service';
import { WebhookService } from './webhook.service';

const INTERVALO_MS = 60_000;

@Injectable()
export class WebhookRetomada {
  private readonly log = new Logger('MetaWebhook');
  private rodando = false;

  constructor(
    private readonly servico: WebhookService,
    private readonly agenda: AgendaService,
  ) {}

  @Interval(INTERVALO_MS)
  async retomar(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      // Antes de processar: a agenda que chegou antes da resposta do dono volta
      // para a fila agora que a resposta existe (ver `AgendaService.reenfileirar`).
      // Falhar aqui não pode impedir o processamento dos pendentes logo abaixo.
      const devolvidos = await this.agenda.reenfileirar().catch((erro: unknown) => {
        this.log.error(`Retomada da agenda falhou: ${(erro as Error)?.message ?? String(erro)}`);
        return 0;
      });
      if (devolvidos > 0) {
        this.log.log(`Retomada: ${devolvidos} evento(s) da agenda do celular voltaram para a fila.`);
      }
      const tratados = await this.servico.processarPendentes();
      if (tratados > 0) {
        this.log.log(`Retomada: ${tratados} evento(s) que estavam pendentes foram processados.`);
      }
    } catch (erro) {
      // Nunca deixa a exceção subir: um erro aqui não pode derrubar o
      // agendador e levar junto a rede de segurança.
      this.log.error(
        `Retomada de eventos falhou: ${(erro as Error)?.message ?? String(erro)}`,
        (erro as Error)?.stack,
      );
    } finally {
      this.rodando = false;
    }
  }
}
