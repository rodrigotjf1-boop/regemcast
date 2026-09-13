import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

import { SenhaForte } from './senha-forte.decorator';

export class TrocarSenhaDto {
  @ApiProperty({ example: 'senha atual 2026', maxLength: 200 })
  @IsString({ message: 'Informe a senha atual.' })
  @MinLength(1, { message: 'Informe a senha atual.' })
  @MaxLength(200, { message: 'A senha atual pode ter no máximo 200 caracteres.' })
  senhaAtual!: string;

  @ApiProperty({
    example: 'senha nova 2026',
    minLength: 10,
    description: 'Mínimo de 10 caracteres, com pelo menos uma letra e um número.',
  })
  @SenhaForte('A senha nova')
  senhaNova!: string;
}
