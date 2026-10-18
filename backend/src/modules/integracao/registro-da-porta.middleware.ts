/**
 * O registro de cada chamada da porta MCP para o hub da DMS (Padrão §10).
 *
 * Abre a chamada atual (`modules/hub/chamada-atual.ts`) antes do portão, com o código do pedido, que volta no
 * cabeçalho `request-id` (e no `request_id` das recusas do Padrão): é o código que liga o que o produto que chamou viu
 * ao que o hub mostra. Quando a resposta termina, monta o registro com o que o portão, o filtro e a ferramenta
 * anotaram e entrega ao `HubService`, que só anota (o envio sai em lote, depois). Com o hub desligado, só o código.
 *
 * Só POST: GET e DELETE na porta são a sonda de sessão de cliente da geração 2025, respondida com 405 sem portão.
 *
 * Uma vez por pedido: o `forRoutes(McpController)` registra o middleware para CADA rota do controlador, e o `@All()`
 * do 405 casa também com o POST — sem a marca, todo POST abriria duas chamadas e iria duas vezes ao hub.
 */
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response } from 'express';

import { comChamada, ferramentaDoRegistro, montarChamada, novoCodigo, type ChamadaAtual } from '../hub/chamada-atual';
import { HubService } from '../hub/hub.service';

const JA_ABERTA = Symbol('registro-da-porta');

@Injectable()
export class RegistroDaPorta implements NestMiddleware {
  constructor(private readonly hub: HubService) {}

  use(req: Request, res: Response, next: (erro?: unknown) => void): void {
    const marcado = req as Request & { [JA_ABERTA]?: true };
    if (marcado[JA_ABERTA]) {
      next();
      return;
    }
    marcado[JA_ABERTA] = true;
    const chamada: ChamadaAtual = { codigo: novoCodigo(), inicio: Date.now() };
    res.setHeader('request-id', chamada.codigo);
    if (req.method === 'POST') res.once('close', () => this.registrar(chamada, req, res));
    comChamada(chamada, () => next());
  }

  /** O registro nunca derruba nada: a resposta já saiu. */
  private registrar(chamada: ChamadaAtual, req: Request, res: Response): void {
    if (!this.hub.ligado) return;
    try {
      if (!chamada.ferramenta) chamada.ferramenta = ferramentaDoRegistro(req.body);
      this.hub.registrar(montarChamada(chamada, res.statusCode, res.writableFinished, Date.now()));
      if (chamada.erro) this.hub.erro({ origem: 'backend', ...chamada.erro, codigo: chamada.codigo });
    } catch {
      /* só anota na memória; se nem isso deu, a chamada fica sem registro */
    }
  }
}
