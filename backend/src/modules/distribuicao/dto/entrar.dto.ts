import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { SenhaForte } from '../../auth/dto/senha-forte.decorator';

export class EntrarOperadorDto {
  @ApiProperty()
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @IsString({ message: 'Informe a senha.' })
  @MinLength(1, { message: 'Informe a senha.' })
  @MaxLength(200)
  senha!: string;
}

export class CodigoDto {
  @ApiProperty({ description: 'O código de 6 dígitos do aplicativo autenticador.' })
  @IsString({ message: 'Informe o código.' })
  @Matches(/^[\d\s]{6,7}$/, { message: 'O código tem 6 dígitos.' })
  codigo!: string;
}

export class CriarOperadorDto {
  @ApiProperty()
  @IsString()
  @MinLength(2, { message: 'Informe o nome.' })
  @MaxLength(120)
  nome!: string;

  @ApiProperty()
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ description: 'Mínimo de 10 caracteres, com letra e número.' })
  @SenhaForte('A senha')
  senha!: string;
}
