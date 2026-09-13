/**
 * Telefone em E.164, validado e normalizado no MESMO lugar.
 *
 * A validação e a gravação usam a mesma função de propósito: quando são duas
 * implementações, o que o validador aceita e o que o banco recebe divergem — e
 * o sintoma só aparece na hora do disparo, quando a Meta recusa o número.
 *
 * Guardamos sempre com o "+". Sem ele, o mesmo assinante entra duas vezes na
 * base ("11987654321" e "+5511987654321") e recebe a campanha duas vezes.
 */
import { registerDecorator, type ValidationOptions } from 'class-validator';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * País assumido quando o número vem sem DDI. O produto nasce no Brasil; um
 * cliente de fora precisa informar o "+DDI" e o parser respeita.
 */
export const PAIS_PADRAO = 'BR' as const;

/** Devolve o número em E.164 (com "+") ou `null` se não for um telefone válido. */
export function normalizarTelefoneE164(bruto: unknown): string | null {
  if (typeof bruto !== 'string') return null;
  const limpo = bruto.trim();
  if (!limpo) return null;

  const numero = parsePhoneNumberFromString(limpo, PAIS_PADRAO);
  if (!numero || !numero.isValid()) return null;
  return String(numero.number);
}

/**
 * Esconde o miolo do número para log e auditoria: `+5511*****4321`.
 * Nunca registramos o telefone inteiro.
 */
export function mascararTelefone(e164: string | null): string | null {
  if (!e164) return null;
  if (e164.length <= 8) return '*'.repeat(e164.length);
  return `${e164.slice(0, 5)}${'*'.repeat(e164.length - 9)}${e164.slice(-4)}`;
}

/** Valida telefone aceitando formato local (com DDD) ou internacional. */
export function EhTelefoneE164(opcoes?: ValidationOptions) {
  return function (alvo: object, propriedade: string): void {
    registerDecorator({
      name: 'ehTelefoneE164',
      target: alvo.constructor,
      propertyName: propriedade,
      options: opcoes,
      validator: {
        validate: (valor: unknown) => normalizarTelefoneE164(valor) !== null,
        defaultMessage: () =>
          'Informe um telefone válido com DDD, por exemplo 11 98765-4321.',
      },
    });
  };
}
