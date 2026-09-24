import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Uma resposta de texto na conversa. 4.096 caracteres é o teto da Meta para texto. */
export class ResponderDto {
  @ApiProperty({ description: 'O texto da resposta.' })
  @IsString({ message: 'Escreva a mensagem.' })
  @MinLength(1, { message: 'Escreva a mensagem.' })
  @MaxLength(4096, { message: 'A mensagem passou de 4.096 caracteres, o limite do WhatsApp.' })
  texto!: string;
}
