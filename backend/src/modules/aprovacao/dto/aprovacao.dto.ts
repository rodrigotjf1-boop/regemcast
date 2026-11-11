import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';

import { TETO_MAXIMO_CENTAVOS, TETO_MINIMO_CENTAVOS } from '../aprovacao.regras';

/** Corpo do POST /aprovacoes/:id/aprovar: o código do aplicativo autenticador, o teto do disparo e o plano que a tela mostrou. */
export class AprovarDto {
  @ApiProperty({ example: '123456', description: 'O código de agora do aplicativo autenticador de quem aprova.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s+/g, '') : value))
  @IsString({ message: 'Digite os 6 números do código.' })
  @Matches(/^\d{6}$/, { message: 'Digite os 6 números do código.' })
  codigo!: string;

  @ApiProperty({ example: 15000, description: 'O teto de gasto deste disparo, em centavos.' })
  @IsInt({ message: 'Diga o teto de gasto deste disparo, em reais.' })
  @Min(TETO_MINIMO_CENTAVOS, { message: 'O teto de gasto é de pelo menos R$ 1,00.' })
  @Max(TETO_MAXIMO_CENTAVOS, { message: 'O teto de gasto vai até R$ 1.000.000,00.' })
  tetoCentavos!: number;

  @ApiProperty({ description: 'O resumo do plano que a tela mostrou (SHA-256 em hexadecimal).' })
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, { message: 'Abra o pedido de novo: o plano mostrado não confere.' })
  resumoVisto!: string;
}

/** Corpo do POST /aprovacoes/:id/recusar: o motivo, que volta a quem pediu. */
export class RecusarDto {
  @ApiProperty({ example: 'Desconto alto demais para a semana.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value))
  @IsString({ message: 'Escreva o motivo da recusa.' })
  @Length(1, 300, { message: 'Escreva o motivo da recusa (até 300 caracteres): ele volta para quem pediu.' })
  motivo!: string;
}
