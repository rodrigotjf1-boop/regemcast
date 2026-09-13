import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

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
}
