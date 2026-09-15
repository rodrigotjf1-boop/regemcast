import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * Registro do número na Cloud API.
 *
 * O PIN só é informado quando o número já tem verificação em duas etapas — aí
 * a Meta recusa o PIN que geramos (erro 133005) e exige o que o cliente
 * definiu no WhatsApp Manager. Quando não vem, geramos um.
 *
 * O valor NÃO é guardado: é usado na chamada e descartado.
 */
export class RegistrarNumeroDto {
  @ApiProperty({ description: 'ID do número na Meta.' })
  @IsString({ message: 'Informe o número a registrar.' })
  @Matches(/^\d{5,30}$/, { message: 'O identificador do número é inválido.' })
  phoneNumberId!: string;

  @ApiProperty({ required: false, description: 'PIN de 6 dígitos, se o número tiver duas etapas.' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'O PIN tem exatamente 6 dígitos.' })
  pin?: string;
}
