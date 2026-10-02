/**
 * A chave de idempotência das ferramentas de escrita — as regras, sem banco.
 *
 * Quem integra repete o pedido quando a resposta se perde. A chave é o que
 * permite repetir sem criar duas vezes: a mesma chave com o MESMO pedido
 * devolve a resposta guardada; com outro pedido, é recusada (a chave não
 * identificaria mais uma ação só).
 */
import { createHash } from 'node:crypto';

/** Por quanto tempo a chave vale. Depois disto ela é apagada e fica livre. */
export const PRAZO_HORAS = 24;

/** De 8 a 100 caracteres: letras, números, ponto, dois-pontos, hífen e sublinhado. */
export const FORMATO_DA_CHAVE = /^[A-Za-z0-9_.:-]{8,100}$/;

/** O pedido em JSON com as chaves em ordem: o mesmo pedido dá o mesmo texto, venha na ordem que vier. */
export function emOrdem(valor: unknown): string {
  if (valor === undefined) return 'null';
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(emOrdem).join(',')}]`;
  const objeto = valor as Record<string, unknown>;
  const pares = Object.keys(objeto)
    .filter((k) => objeto[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${emOrdem(objeto[k])}`);
  return `{${pares.join(',')}}`;
}

/** A impressão digital do pedido (sem a própria chave). */
export function hashDoPedido(pedido: unknown): string {
  return createHash('sha256').update(emOrdem(pedido), 'utf8').digest('hex');
}
