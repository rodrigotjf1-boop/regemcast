import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';

/**
 * Corpo do PATCH /conta/usuarios/:id.
 *
 * Não existe campo `papel` de propósito: promover ou rebaixar alguém mexe na
 * titularidade da conta e vai ter rota própria, com confirmação. Aqui só dá
 * para renomear e ligar/desligar o acesso.
 */
export class AtualizarUsuarioDto {
  @ApiPropertyOptional({ example: 'Ana Ribeiro' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Informe o nome em texto.' })
  @Length(2, 120, { message: 'O nome precisa ter de 2 a 120 caracteres.' })
  nome?: string;

  @ApiPropertyOptional({ enum: ['ativo', 'suspenso'] })
  @IsOptional()
  @IsIn(['ativo', 'suspenso'], { message: 'O status precisa ser "ativo" ou "suspenso".' })
  status?: 'ativo' | 'suspenso';

  /**
   * A permissão de aprovar disparos pedidos por outro produto da DMS (Hub DMS, F5 parte B; decisão F5-2). O dono
   * aprova sempre; aqui ele dá ou tira de outro acesso. Ausente = mantém.
   */
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean({ message: 'Informe a permissão de aprovar disparos como verdadeiro ou falso.' })
  aprovaDisparos?: boolean;
}
