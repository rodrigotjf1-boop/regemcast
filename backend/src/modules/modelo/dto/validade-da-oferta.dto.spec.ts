/**
 * O corpo de `PATCH /modelos/:id/oferta`. Os limites são os mesmos de
 * `SalvarModeloDto.ltoHoras` e da regra do banco (1 a 720): valor fora disso
 * tem de voltar com frase, e não estourar no `check` como erro 500.
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ValidadeDaOfertaDto } from './validade-da-oferta.dto';

const mensagens = async (corpo: object) => {
  const erros = await validate(plainToInstance(ValidadeDaOfertaDto, corpo));
  return erros.flatMap((e) => Object.values(e.constraints ?? {}));
};

describe('validade da oferta — o corpo do pedido', () => {
  it.each([1, 3, 48, 720])('aceita %d horas', async (horas) => {
    expect(await mensagens({ horas })).toEqual([]);
  });

  it('aceita nulo e ausente: os dois voltam ao padrão', async () => {
    expect(await mensagens({ horas: null })).toEqual([]);
    expect(await mensagens({})).toEqual([]);
  });

  it('recusa zero, negativo e acima de 30 dias, com a frase', async () => {
    expect(await mensagens({ horas: 0 })).toEqual(['A oferta precisa valer pelo menos 1 hora.']);
    expect(await mensagens({ horas: -2 })).toEqual(['A oferta precisa valer pelo menos 1 hora.']);
    expect(await mensagens({ horas: 721 })).toEqual(['A oferta pode valer no máximo 720 horas (30 dias).']);
  });

  it('recusa hora quebrada e texto', async () => {
    expect(await mensagens({ horas: 1.5 })).toContain('Informe a validade da oferta em horas inteiras.');
    expect(await mensagens({ horas: '12' })).toContain('Informe a validade da oferta em horas inteiras.');
  });
});
