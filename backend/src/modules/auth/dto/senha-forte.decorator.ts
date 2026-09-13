import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Regra única de senha do produto.
 *
 * Existe como decorator composto para não haver duas regras diferentes de
 * senha no mesmo backend: o cadastro pelo convite e a troca de senha usam
 * exatamente esta.
 *
 * O teto de 200 caracteres não é frescura: argon2 lê a senha inteira, e senha
 * gigante enviada em rajada vira custo de CPU nosso.
 */
export function SenhaForte(rotulo = 'A senha') {
  return applyDecorators(
    IsString({ message: `${rotulo} é obrigatória.` }),
    MinLength(10, { message: `${rotulo} precisa ter pelo menos 10 caracteres.` }),
    MaxLength(200, { message: `${rotulo} pode ter no máximo 200 caracteres.` }),
    Matches(/\p{L}/u, { message: `${rotulo} precisa ter pelo menos uma letra.` }),
    Matches(/\d/, { message: `${rotulo} precisa ter pelo menos um número.` }),
  );
}
