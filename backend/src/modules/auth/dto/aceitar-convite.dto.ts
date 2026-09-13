import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { SenhaForte } from './senha-forte.decorator';

/**
 * O token do convite viaja só no link do e-mail; o banco guarda o sha256 dele.
 * O formato aceito cobre hex e base64url — é o que `randomBytes(n).toString()`
 * produz nos dois casos — e barra qualquer coisa fora disso antes de virar
 * consulta.
 */
export const FORMATO_TOKEN_CONVITE = /^[A-Za-z0-9_-]{16,256}$/;

export class AceitarConviteDto {
  @ApiProperty({ description: 'Token recebido no link do convite.', maxLength: 256 })
  @IsString({ message: 'O convite não veio no link. Abra o link do e-mail de novo.' })
  @Matches(FORMATO_TOKEN_CONVITE, { message: 'Convite inválido ou expirado.' })
  token!: string;

  @ApiProperty({ example: 'Ana Prado', maxLength: 120 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Informe o seu nome.' })
  @MinLength(2, { message: 'O nome precisa ter pelo menos 2 caracteres.' })
  @MaxLength(120, { message: 'O nome pode ter no máximo 120 caracteres.' })
  nome!: string;

  @ApiProperty({ example: 'senha nova 2026', minLength: 10 })
  @SenhaForte('A senha')
  senha!: string;

  @ApiProperty({ example: 'Padaria Aurora', maxLength: 160 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Informe o nome da empresa.' })
  @MinLength(2, { message: 'O nome da empresa precisa ter pelo menos 2 caracteres.' })
  @MaxLength(160, { message: 'O nome da empresa pode ter no máximo 160 caracteres.' })
  nomeEmpresa!: string;
}
