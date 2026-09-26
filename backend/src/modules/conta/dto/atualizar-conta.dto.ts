import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

/** Corpo do PATCH /conta. Todo campo é opcional, mas pelo menos um é exigido. */
export class AtualizarContaDto {
  @ApiPropertyOptional({ example: 'Padaria do Zé Ltda' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Informe o nome da empresa em texto.' })
  @Length(2, 120, { message: 'O nome da empresa precisa ter de 2 a 120 caracteres.' })
  nome?: string;

  @ApiPropertyOptional({
    example: '12.345.678/0001-95',
    description: 'Com ou sem máscara. Envie vazio para limpar o campo.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Informe o CNPJ em texto.' })
  @MaxLength(20, { message: 'O CNPJ tem no máximo 14 caracteres, com ou sem máscara.' })
  cnpj?: string;

  @ApiPropertyOptional({
    example: 'America/Sao_Paulo',
    description: 'Nome IANA do fuso. Rege as janelas de envio da conta.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Informe o fuso horário em texto.' })
  @MaxLength(64, { message: 'Esse nome de fuso horário é longo demais.' })
  timezone?: string;

  @ApiPropertyOptional({
    example: 3,
    description: 'Descanso entre campanhas de marketing, em dias (0 desliga). Vale para campanhas criadas daqui em diante.',
  })
  @IsOptional()
  @IsInt({ message: 'Informe o descanso em dias, número inteiro.' })
  @Min(0, { message: 'O descanso vai de 0 (desligado) a 30 dias.' })
  @Max(30, { message: 'O descanso vai de 0 (desligado) a 30 dias.' })
  descansoMarketingDias?: number;
}
