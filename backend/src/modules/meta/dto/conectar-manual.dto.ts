import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

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
  /**
   * Declara que o número JÁ está registrado na Cloud API — é o caso do número
   * de teste da Meta, que ela mesma registra.
   *
   * Existe como declaração do operador, e não como dedução nossa, de propósito:
   * a Meta expõe um campo `platform_type` que parece dizer isso, mas a
   * documentação não define os valores dele. Basear o estado do número numa
   * suposição sobre campo alheio é exatamente o tipo de coisa que funciona até
   * o dia em que não funciona, e aí ninguém lembra por quê. Quem conecta à mão
   * sabe a resposta; que ela venha declarada e auditada.
   */
  @ApiProperty({
    required: false,
    description: 'O número já está registrado na Cloud API (número de teste da Meta, por exemplo).',
  })
  @IsOptional()
  @IsBoolean({ message: 'Informe se o número já está registrado.' })
  jaRegistrado?: boolean;

  @ApiProperty({ description: 'Token de acesso com permissão sobre esta WABA.' })
  @IsString({ message: 'Informe o token de acesso.' })
  @MinLength(20, { message: 'O token parece incompleto.' })
  @MaxLength(1024, { message: 'O token é longo demais.' })
  token!: string;
}
