import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';

import { SenhaForte } from './senha-forte.decorator';

export class EsqueciSenhaDto {
  @ApiProperty({ example: 'ana@empresa.com.br', maxLength: 254 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(254, { message: 'O e-mail pode ter no máximo 254 caracteres.' })
  email!: string;
}

export class RedefinirSenhaDto extends EsqueciSenhaDto {
  @ApiProperty({ example: '123456' })
  @IsString({ message: 'Informe o código.' })
  @Matches(/^[\d\s-]{6,8}$/, { message: 'O código tem 6 dígitos.' })
  codigo!: string;

  @ApiProperty({ example: 'senha nova 2026', minLength: 10 })
  @SenhaForte('A senha nova')
  senhaNova!: string;
}
