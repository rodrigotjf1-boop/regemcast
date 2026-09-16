/**
 * Validador de telefone da lista de espera.
 *
 * A normalização em si mora em `src/common/telefone.ts`, que é a única do
 * produto — este arquivo só embrulha aquela função num decorator de
 * `class-validator`. Quando eram duas implementações, o que o validador
 * aceitava e o que a campanha enviava divergiram, e o sintoma só apareceu na
 * hora do disparo, com a Meta recusando o número.
 *
 * Os re-exports abaixo existem para não quebrar quem já importa daqui.
 */
import { registerDecorator, type ValidationOptions } from 'class-validator';

import { normalizarTelefoneE164 } from '../../../common/telefone';

export {
  PAIS_PADRAO,
  mascararTelefone,
  normalizarTelefoneE164,
  paraCloudApi,
} from '../../../common/telefone';

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
