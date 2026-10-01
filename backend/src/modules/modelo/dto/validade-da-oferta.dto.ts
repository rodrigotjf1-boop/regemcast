import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Só a validade da oferta por tempo limitado, em horas depois do envio.
 *
 * Os limites são os de `SalvarModeloDto.ltoHoras` (e da regra do banco): 1 a
 * 720. Ausente ou nulo volta ao padrão (3 horas).
 */
export class ValidadeDaOfertaDto {
  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Validade em horas depois do envio (1 a 720). Nulo ou ausente: o padrão, 3.',
  })
  @IsOptional()
  @IsInt({ message: 'Informe a validade da oferta em horas inteiras.' })
  @Min(1, { message: 'A oferta precisa valer pelo menos 1 hora.' })
  @Max(720, { message: 'A oferta pode valer no máximo 720 horas (30 dias).' })
  horas?: number | null;
}
