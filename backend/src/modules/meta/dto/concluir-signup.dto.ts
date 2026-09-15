import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * O que o Embedded Signup devolve ao navegador.
 *
 * O `code` vive 30 segundos, então este corpo vai direto do callback do SDK
 * para cá — sem passar por outra tela, sem esperar confirmação do usuário.
 */
export class ConcluirSignupDto {
  @ApiProperty({ description: 'Código de autorização do Embedded Signup. Expira em 30 segundos.' })
  @IsString({ message: 'Informe o código de autorização.' })
  @MinLength(10, { message: 'O código de autorização parece incompleto.' })
  @MaxLength(512, { message: 'O código de autorização é longo demais.' })
  code!: string;

  @ApiProperty({ description: 'ID da WhatsApp Business Account do cliente.' })
  @IsString({ message: 'Informe o identificador da conta de WhatsApp.' })
  @Matches(/^\d{5,30}$/, { message: 'O identificador da conta de WhatsApp é inválido.' })
  wabaId!: string;

  @ApiProperty({ description: 'ID do número comercial.' })
  @IsString({ message: 'Informe o identificador do número.' })
  @Matches(/^\d{5,30}$/, { message: 'O identificador do número é inválido.' })
  phoneNumberId!: string;
}
