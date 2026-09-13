import { Transform } from 'class-transformer';

/**
 * Tira espaço das pontas antes de validar.
 *
 * Sem isto, `"  "` passa em `@IsNotEmpty()` e um nome só de espaços entra na
 * fila; e `" fulano@x.com "` vira uma segunda linha para a mesma pessoa,
 * porque o índice único não normaliza espaço.
 */
export const Aparar = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

/** Apara e põe em minúsculas — para e-mail, que é citext no banco. */
export const AparaMinusculo = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
