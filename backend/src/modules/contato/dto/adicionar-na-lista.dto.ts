import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Põe um contato numa lista — o "etiquetar" feito a partir da conversa. */
export class AdicionarNaListaDto {
  @ApiProperty({ description: 'A lista de destino.' })
  @IsUUID('4', { message: 'Escolha uma lista.' })
  listaId!: string;
}
