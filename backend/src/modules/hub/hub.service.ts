/**
 * O hub da DMS no RegemCast (Hub DMS, F2, etapa 2 da A4): o cliente do pacote comum (`ClienteHub`, seção 9), um por
 * processo.
 *
 * - **Registro central:** cada chamada da porta MCP (quem chamou, a ferramenta, o resultado e a duração; nunca o
 *   conteúdo) vai ao hub em lote, a cada 5 s. Quem anota é o middleware da porta (`RegistroDaPorta`).
 * - **Erros:** o que a telemetria grava (fora as falhas de envio de cada mensagem à Meta) vai também à lista de erros
 *   do hub, limpo de dado pessoal pelo pacote.
 * - **Lista de parada:** lida a cada 15 s, só quando muda; o portão da porta recusa a chamada parada (503
 *   `integracao-parada`). Se o hub cair, vale a última lista lida.
 * - **Batida:** a cada minuto, com a versão no ar e a chave própria.
 *
 * Nasce DESLIGADO (`HUB_LIGADO`): sem ele, nada sai daqui e nada é parado pelo hub. A chave própria
 * (`ACEITAR_INTEGRACOES`) vale com ou sem o hub. Nada aqui espera o hub nem falha a chamada de quem usa o RegemCast: o
 * hub fora do ar só vira aviso no log.
 *
 * A fila fica na memória do processo (até 5.000 chamadas; acima disso sai a mais velha, contada): um reinício perde o
 * que ainda não saiu, e a lista de parada é lida de novo na subida.
 */
import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';

import { env } from '../../config/env';
import {
  ClienteDmsId,
  ClienteHub,
  type ChamadaAtendida,
  type ChamadaRegistrada,
  type ErroDoProduto,
  type ItemDeParada,
} from '../../dms/integracao-dms';
import { versaoDoApp } from '../saude/saude.service';

/** O mesmo motivo de falha só volta ao log depois deste tempo: o hub fora não pode afogar o log a cada 5 s. */
const SILENCIO_DO_MESMO_AVISO_MS = 5 * 60_000;

@Injectable()
export class HubService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('Hub');
  private cliente: ClienteHub | null = null;
  private ultimoAviso: { motivo: string; em: number } | null = null;

  /** Mandando ao hub e lendo a lista de parada (`HUB_LIGADO`). */
  get ligado(): boolean {
    return this.cliente !== null;
  }

  /** A chave própria do Padrão (§10): falsa = a porta recusa toda chamada de integração, com ou sem o hub. */
  get aceitaIntegracoes(): boolean {
    return env.hub?.aceitaIntegracoes ?? true;
  }

  /** A fila, os erros guardados, a versão da lista e a última falha (para o diagnóstico). Nulo: desligado. */
  get estado(): ClienteHub['estado'] | null {
    return this.cliente ? this.cliente.estado : null;
  }

  onModuleInit(): void {
    const c = env.hub;
    if (!c?.ligado) return;
    this.cliente = new ClienteHub({
      url: c.url,
      recurso: c.recurso,
      dmsId: new ClienteDmsId({ emissor: c.emissor, aplicativo: c.aplicativo, segredo: c.segredo }),
      produto: 'regemcast',
      versao: versaoDoApp(),
      aceitaIntegracoes: () => this.aceitaIntegracoes,
      aoFalhar: (motivo) => this.avisar(motivo),
    });
    this.cliente.iniciar();
    this.log.log(`Hub ligado (${c.url}): registro da porta MCP, erros e lista de parada.`);
  }

  /** No desligamento: para os relógios e manda o que falta, uma vez. */
  async onApplicationShutdown(): Promise<void> {
    const cliente = this.cliente;
    this.cliente = null;
    if (cliente) await cliente.parar();
  }

  /** A parada que vale para esta chamada, pela última lista lida (nula: pode atender). Desligado: nunca para. */
  parado(chamada: ChamadaAtendida): ItemDeParada | null {
    return this.cliente ? this.cliente.parado(chamada) : null;
  }

  /** Anota uma chamada da porta para o registro central. Desligado: nada. */
  registrar(chamada: ChamadaRegistrada): void {
    if (this.cliente) this.cliente.registrar(chamada);
  }

  /** Anota um erro para a lista de erros do hub (o pacote limpa a mensagem). Desligado: nada. */
  erro(erro: ErroDoProduto): void {
    if (this.cliente) this.cliente.erro(erro);
  }

  /** Falha de envio ou de leitura (hub fora, rede, recusa): aviso no log, sem repetir o mesmo motivo a cada volta. */
  private avisar(motivo: string): void {
    const agora = Date.now();
    if (this.ultimoAviso && this.ultimoAviso.motivo === motivo && agora - this.ultimoAviso.em < SILENCIO_DO_MESMO_AVISO_MS) return;
    this.ultimoAviso = { motivo, em: agora };
    this.log.warn(`Hub: ${motivo}`);
  }
}
