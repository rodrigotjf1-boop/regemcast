import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';

/** O pedido que a página está mostrando: o aplicativo e o número do pedido (RFC 9126), como vieram no endereço. */
export class PedidoNaTelaDto {
  @ApiProperty({ description: 'O client_id do aplicativo no DMS ID.' })
  @IsString({ message: 'O pedido chegou incompleto. Volte ao aplicativo e comece de novo.' })
  @MaxLength(200)
  clientId!: string;

  @ApiProperty({ description: 'O número do pedido (request_uri).' })
  @IsString({ message: 'O pedido chegou incompleto. Volte ao aplicativo e comece de novo.' })
  @MaxLength(200)
  requestUri!: string;
}

/**
 * A decisão do dono. Cada opcional que ele ligou vai na lista; a confirmação de
 * outra empresa vai sempre, explícita (V15: ausente não vira "não").
 */
export class AutorizarDto extends PedidoNaTelaDto {
  @ApiProperty()
  @IsString({ message: 'Digite a sua senha do Regemcast para autorizar.' })
  @MinLength(1, { message: 'Digite a sua senha do Regemcast para autorizar.' })
  @MaxLength(200)
  senha!: string;

  @ApiProperty({ type: [String], description: 'As permissões opcionais que o dono ligou.' })
  @IsArray({ message: 'Recarregue a página e decida de novo.' })
  @ArrayMaxSize(20)
  @IsString({ each: true, message: 'Recarregue a página e decida de novo.' })
  opcionais!: string[];

  @ApiProperty({ description: 'Confirmou ligar a conta de outra empresa (vale só quando a tela pede).' })
  @IsBoolean({ message: 'Recarregue a página e decida de novo.' })
  confirmoOutraEmpresa!: boolean;
}
