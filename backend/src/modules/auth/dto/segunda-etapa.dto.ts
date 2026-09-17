import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** O código de 6 dígitos — do app autenticador ou do e-mail. */
export class CodigoSegundaEtapaDto {
  @ApiProperty({ example: '123456' })
  @IsString({ message: 'Informe o código.' })
  @Matches(/^[\d\s-]{6,8}$/, { message: 'O código tem 6 dígitos.' })
  codigo!: string;
}

/**
 * Ativar o aplicativo autenticador exige o código E a senha. Só o código não
 * basta: com uma sessão esquecida aberta, outra pessoa cadastraria o PRÓPRIO
 * celular e trancaria o dono fora da conta.
 */
export class AtivarAppDto extends CodigoSegundaEtapaDto {
  @ApiProperty()
  @IsString({ message: 'Informe a sua senha.' })
  @MinLength(1, { message: 'Informe a sua senha.' })
  @MaxLength(200)
  senha!: string;
}

/** Desligar as duas etapas exige a senha. */
export class SenhaConfirmacaoDto {
  @ApiProperty()
  @IsString({ message: 'Informe a sua senha.' })
  @MinLength(1, { message: 'Informe a sua senha.' })
  @MaxLength(200)
  senha!: string;
}
