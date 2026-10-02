import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

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

  /**
   * O portfólio de negócios do cliente, que o Embedded Signup devolve junto da
   * conta. Serve para montar o endereço da página de pagamento da conta na
   * Meta. Opcional: sem ele, o servidor pergunta à Meta.
   */
  @ApiProperty({ required: false, description: 'ID do portfólio de negócios do cliente na Meta.' })
  @IsOptional()
  @IsString({ message: 'Informe o identificador do negócio.' })
  @Matches(/^\d{5,30}$/, { message: 'O identificador do negócio é inválido.' })
  businessId?: string;

  /**
   * Opcional de propósito: no fluxo de coexistência a Meta nem sempre devolve
   * o `phone_number_id` no `sessionInfo`. Quando faltar, o servidor descobre o
   * número consultando a WABA — o cliente não digita nada.
   */
  @ApiProperty({ required: false, description: 'ID do número comercial.' })
  @IsOptional()
  @IsString({ message: 'Informe o identificador do número.' })
  @Matches(/^\d{5,30}$/, { message: 'O identificador do número é inválido.' })
  phoneNumberId?: string;

  /**
   * O cliente escolheu manter o WhatsApp Business no celular (coexistência).
   * Muda o onboarding: pula o /register e dispara a sincronização de 24h.
   */
  @ApiProperty({
    required: false,
    description: 'O cliente mantém o WhatsApp Business no celular.',
  })
  @IsOptional()
  @IsBoolean({ message: 'Informe se o número é de coexistência.' })
  coexistencia?: boolean;

  /**
   * Na coexistência: trazer os contatos e as conversas do WhatsApp Business?
   *
   * Opcional porque só existe na coexistência. Ausente NÃO vira "não": fica
   * sem resposta, e o cartão do número pergunta depois.
   */
  @ApiProperty({
    required: false,
    description: 'Coexistência: guardar os contatos e as conversas do WhatsApp Business.',
  })
  @IsOptional()
  @IsBoolean({ message: 'Responda se quer trazer os contatos e as conversas.' })
  integrar?: boolean;
}
