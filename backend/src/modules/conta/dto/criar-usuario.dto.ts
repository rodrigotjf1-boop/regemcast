import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

import { SenhaForte } from '../../auth/dto/senha-forte.decorator';

/**
 * Corpo do POST /conta/usuarios. Cria sempre um operador — nunca um segundo dono.
 *
 * A senha passa pelo MESMO `SenhaForte` do convite e da troca de senha. Com um
 * `Length(10, 200)` solto aqui, o produto tinha duas regras de senha: `1234567890`
 * era recusado na troca e aceito no cadastro de operador — e o acesso mais fácil
 * de adivinhar era justamente o que alguém cria às pressas para a equipe.
 */
export class CriarUsuarioDto {
  @ApiProperty({ example: 'Ana Ribeiro' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Informe o nome da pessoa.' })
  @Length(2, 120, { message: 'O nome precisa ter de 2 a 120 caracteres.' })
  nome!: string;

  @ApiProperty({ example: 'ana@empresa.com.br' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Confira o e-mail: ele precisa ter o formato nome@empresa.com.' })
  @MaxLength(180, { message: 'Esse e-mail é longo demais.' })
  email!: string;

  @ApiProperty({
    example: 'uma frase que só você lembra 2026',
    minLength: 10,
    description:
      'Mínimo de 10 caracteres, com pelo menos uma letra e um número. Guardada com argon2id, nunca em claro.',
  })
  @SenhaForte('A senha')
  senha!: string;
}
