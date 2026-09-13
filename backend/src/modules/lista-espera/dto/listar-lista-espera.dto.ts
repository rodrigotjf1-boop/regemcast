import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import { STATUS_LISTA_ESPERA, type StatusListaEspera } from '../lista-espera.status';

/**
 * Filtro e paginação do console de distribuição.
 *
 * `@Type(() => Number)` é obrigatório: o ValidationPipe global roda com
 * `enableImplicitConversion: false`, então sem ele `?limite=20` chega como a
 * string "20", `@IsInt` reprova e o operador recebe um 400 sem entender por quê.
 */
export class ListarListaEsperaDto {
  @ApiPropertyOptional({ enum: STATUS_LISTA_ESPERA })
  @IsOptional()
  @IsIn(STATUS_LISTA_ESPERA, {
    message: `Status inválido. Use um destes: ${STATUS_LISTA_ESPERA.join(', ')}.`,
  })
  status?: StatusListaEspera;

  @ApiPropertyOptional({ minimum: 1, default: 1, description: 'Página, começando em 1.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'A página precisa ser um número inteiro.' })
  @Min(1, { message: 'A página começa em 1.' })
  pagina?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'O limite precisa ser um número inteiro.' })
  @Min(1, { message: 'O limite mínimo é 1.' })
  @Max(200, { message: 'O limite máximo por página é 200.' })
  limite?: number;
}
