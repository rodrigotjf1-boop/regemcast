import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsDefined, IsString, Matches } from 'class-validator';

/**
 * A resposta do dono, no cartão do número: trazer, ou não, os contatos e as
 * conversas do WhatsApp Business.
 *
 * `integrar` é obrigatório e booleano de verdade. Liga/desliga que aceita
 * ausente como "não" (ou `"false"` texto como sim) é como uma agenda inteira
 * entra na base sem ninguém ter respondido.
 */
export class IntegrarDto {
  @ApiProperty({ description: 'ID do número comercial, como a tela do WhatsApp mostra.' })
  @IsString({ message: 'Informe o número.' })
  @Matches(/^\d{5,30}$/, { message: 'O identificador do número é inválido.' })
  phoneNumberId!: string;

  @ApiProperty({ description: 'true = trazer contatos e conversas; false = não trazer.' })
  @IsDefined({ message: 'Responda se quer trazer os contatos e as conversas.' })
  @IsBoolean({ message: 'Responda sim ou não.' })
  integrar!: boolean;
}
