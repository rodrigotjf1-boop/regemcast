/**
 * A rotina do aviso assinado a quem pediu (Hub DMS, F5 parte B, PR 3), a cada 15 segundos: entrega os avisos devidos
 * (os novos e os que esperam a próxima tentativa). Nada aqui lança (derrubaria o agendador); uma rodada não começa
 * enquanto a anterior não termina.
 */
import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { AvisoAssinadoService } from './aviso-assinado.service';

const INTERVALO_MS = 15_000;

@Injectable()
export class AvisoAssinadoJob {
  private rodando = false;

  constructor(private readonly avisos: AvisoAssinadoService) {}

  @Interval(INTERVALO_MS)
  async rodada(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      await this.avisos.entregarDevidos();
    } finally {
      this.rodando = false;
    }
  }
}
