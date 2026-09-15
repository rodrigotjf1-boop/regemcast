import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Corpo da conexão manual — rota da distribuição, não do cliente.
 *
 * O `contaId` vem no corpo porque esta rota não tem sessão: quem chama é o
 * operador, e precisa dizer QUAL conta está conectando.
 */
export class ConectarManualDto {
  @ApiProperty({ description: 'Conta do Regemcast que vai receber a conexão.' })
  @IsUUID('4', { message: 'Informe o identificador da conta.' })
  contaId!: string;

  @ApiProperty({ description: 'ID da WhatsApp Business Account.' })
  @IsString({ message: 'Informe o identificador da conta de WhatsApp.' })
  @Matches(/^\d{5,30}$/, { message: 'O identificador da conta de WhatsApp é inválido.' })
  wabaId!: string;

  @ApiProperty({
    required: false,
    description: 'ID do número. Sem ele, descobrimos consultando a WABA.',
  })
  @IsOptional()
  @IsString({ message: 'Informe o identificador do número.' })
  @Matches(/^\d{5,30}$/, { message: 'O identificador do número é inválido.' })
  phoneNumberId?: string;

  /**
   * Nunca volta em resposta nenhuma: é cifrado antes de tocar o banco e só sai
   * decifrado para falar com a Meta.
   */
  @ApiProperty({ description: 'Token de acesso com permissão sobre esta WABA.' })
  @IsString({ message: 'Informe o token de acesso.' })
  @MinLength(20, { message: 'O token parece incompleto.' })
  @MaxLength(1024, { message: 'O token é longo demais.' })
  token!: string;
}
