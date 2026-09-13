/**
 * Tokens de injeção do banco, isolados num arquivo sem dependências.
 *
 * Existem aqui por um motivo concreto: `drizzle.module.ts` precisa de
 * `ContextoDb` (para provê-lo) e `contexto.ts` precisa do token `DRIZZLE` (para
 * injetá-lo). Com os símbolos morando no módulo, os dois arquivos se importam
 * em ciclo — e o Nest recusa subir a aplicação inteira:
 *
 *     A circular dependency has been detected inside DrizzleModule.
 *
 * Um arquivo folha, que não importa ninguém, corta o ciclo sem `forwardRef`.
 */
export const DRIZZLE = Symbol('DRIZZLE');
export const PG_POOL = Symbol('PG_POOL');
