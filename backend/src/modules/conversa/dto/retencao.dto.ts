import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsInt, Max, Min } from 'class-validator';

/** Por quantos dias guardar as mensagens. 0 = guardar tudo. */
export class RetencaoDto {
  @ApiProperty({ description: 'Dias de retenção das mensagens. 0 = guardar tudo.' })
  @IsDefined({ message: 'Informe por quantos dias guardar.' })
  @IsInt({ message: 'Informe um número inteiro de dias.' })
  @Min(0, { message: 'O prazo não pode ser negativo.' })
  @Max(3650, { message: 'O prazo máximo é de 10 anos (3.650 dias).' })
  retencaoDias!: number;
}
