/**
 * Query da listagem da trilha.
 *
 * O ValidationPipe global é whitelist + forbidNonWhitelisted + transform, mas
 * com `enableImplicitConversion: false` — query string chega como texto, então
 * `limite` precisa do @Type(() => Number) para virar número antes do @IsInt.
 * Sem isso, `?limite=abc` passaria batido e viraria NaN lá na frente.
 */
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class ListarAuditoriaDto {
  /** Quantos registros por página. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'O limite precisa ser um número inteiro.' })
  @Min(1, { message: 'Peça pelo menos 1 registro.' })
  @Max(100, { message: 'Peça no máximo 100 registros por página.' })
  limite: number = 50;

  /** Id da última linha da página anterior (vem de `proximoCursor`). */
  @IsOptional()
  @Matches(/^\d{1,19}$/, {
    message: 'O cursor precisa ser o id da última linha da página anterior.',
  })
  cursor?: string;

  /** Filtra por ação exata, ex.: 'usuario.login'. */
  @IsOptional()
  @Matches(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, {
    message: 'Informe uma ação válida, por exemplo usuario.login.',
  })
  acao?: string;
}
