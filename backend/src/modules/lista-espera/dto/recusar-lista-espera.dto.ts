import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { Aparar } from './texto';

export class RecusarListaEsperaDto {
  @ApiProperty({
    example: 'Fora do público-alvo: não usa WhatsApp para atendimento.',
    description: 'Motivo da recusa. Fica na linha e na auditoria.',
  })
  @Aparar()
  @IsString({ message: 'Escreva o motivo da recusa.' })
  @IsNotEmpty({ message: 'Escreva o motivo da recusa.' })
  @MaxLength(500, { message: 'O motivo pode ter no máximo 500 caracteres.' })
  observacao!: string;
}
