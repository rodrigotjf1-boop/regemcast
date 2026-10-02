/**
 * Quem está agindo, quando não é uma pessoa: um aplicativo conectado pela
 * porta MCP.
 *
 * As ferramentas do MCP chamam os MESMOS serviços das telas, e esses serviços
 * auditam o que fazem como "usuário". Em vez de cada serviço aprender a
 * perguntar "foi uma pessoa ou uma integração?", a porta MCP roda a ferramenta
 * dentro de `comAutorDaIntegracao`, e a auditoria lê daqui: tudo que for
 * registrado no caminho sai com o autor `integracao` e o nome do token —
 * inclusive o que um serviço registrar sem saber de onde foi chamado. Não há
 * como uma ação de integração aparecer na trilha como se fosse de alguém da
 * conta.
 *
 * Vive só durante a chamada da ferramenta (AsyncLocalStorage): nada fica
 * guardado entre pedidos.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface AutorDaIntegracao {
  tokenId: string;
  /** O produto que usa o token: `liame`, `regem`… */
  produto: string;
  /** O nome do token, como aparece em "Aplicativos conectados". */
  nome: string;
  /** `dms` ou `externo`. */
  classe: string;
}

const armazem = new AsyncLocalStorage<AutorDaIntegracao>();

/** Roda `fn` com a integração como autora de tudo que for auditado dentro. */
export function comAutorDaIntegracao<T>(autor: AutorDaIntegracao, fn: () => Promise<T>): Promise<T> {
  return armazem.run(autor, fn);
}

/** A integração que está agindo agora, ou nulo — numa tela, num job, no webhook. */
export function autorDaIntegracao(): AutorDaIntegracao | null {
  return armazem.getStore() ?? null;
}
