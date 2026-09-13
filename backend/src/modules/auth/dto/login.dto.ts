import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'ana@empresa.com.br', maxLength: 254 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(254, { message: 'O e-mail pode ter no máximo 254 caracteres.' })
  email!: string;

  @ApiProperty({ example: 'minha senha 2026', maxLength: 200 })
  @IsString({ message: 'Informe a senha.' })
  @MinLength(1, { message: 'Informe a senha.' })
  @MaxLength(200, { message: 'A senha pode ter no máximo 200 caracteres.' })
  senha!: string;
}
