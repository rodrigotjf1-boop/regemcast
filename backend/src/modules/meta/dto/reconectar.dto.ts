import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * O que o Embedded Signup devolve quando o dono REFAZ a autorização de uma
 * conta que já está conectada.
 *
 * Só o `code` e a conta: reconectar renova a autorização e mais nada. O número,
 * a cópia dos contatos e das conversas e a resposta sobre eles não entram — e
 * por isso não há `phoneNumberId`, `coexistencia` nem `integrar` aqui.
 */
export class ReconectarDto {
  @ApiProperty({ description: 'Código de autorização do Embedded Signup. Expira em 30 segundos.' })
  @IsString({ message: 'Informe o código de autorização.' })
  @MinLength(10, { message: 'O código de autorização parece incompleto.' })
  @MaxLength(512, { message: 'O código de autorização é longo demais.' })
  code!: string;

  @ApiProperty({ description: 'ID da WhatsApp Business Account escolhida na janela da Meta.' })
  @IsString({ message: 'Informe o identificador da conta de WhatsApp.' })
  @Matches(/^\d{5,30}$/, { message: 'O identificador da conta de WhatsApp é inválido.' })
  wabaId!: string;

  @ApiProperty({ required: false, description: 'ID do portfólio de negócios do cliente na Meta.' })
  @IsOptional()
  @IsString({ message: 'Informe o identificador do negócio.' })
  @Matches(/^\d{5,30}$/, { message: 'O identificador do negócio é inválido.' })
  businessId?: string;
}
