/**
 * A recusa do pedido de aprovação (Hub DMS, F5 parte B) com o nome do problema
 * do pacote (`tipo`) e, quando há, o que quem pediu precisa para seguir
 * (`dados`: o id do pedido aberto da campanha). É `HttpException`: a tela trata
 * como recusa de regra (4xx, ou o 503 da parada), com a frase comum do pacote;
 * a porta MCP responde `isError` com `structuredContent` `{ problema, mensagem,
 * ...dados }` (o envelope que o `ClienteMcp` do pacote lê em `ErroMcp.dados`).
 */
import { HttpException } from '@nestjs/common';

import type { ErroProblema, TipoProblema } from '../../dms/integracao-dms';

export class ErroDoPedido extends HttpException {
  readonly tipo: TipoProblema;
  readonly dados?: Record<string, unknown>;

  constructor(problema: ErroProblema, dados?: Record<string, unknown>) {
    super({ message: problema.message, problema: problema.tipo, ...(dados ? { dados } : {}) }, problema.status);
    this.tipo = problema.tipo;
    this.dados = dados;
  }
}
