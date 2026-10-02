import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Corpo do `PUT /orcamento`: os três tetos, em reais, como a pessoa digita
 * ("50", "50,00", "1.250,50"). Vazio, nulo ou ausente = sem teto no período.
 * O formato e a ordem (dia ≤ semana ≤ mês) são conferidos em `orcamento.regras.ts`,
 * que devolve a frase do que está errado.
 */
export class DefinirOrcamentoDto {
  @ApiPropertyOptional({ example: '50,00', description: 'Teto por dia, na moeda da conta. Vazio tira o teto.' })
  @IsOptional()
  @IsString({ message: 'Informe o teto do dia em texto, por exemplo "50,00".' })
  @MaxLength(20, { message: 'O teto do dia é longo demais.' })
  dia?: string | null;

  @ApiPropertyOptional({ example: '300,00', description: 'Teto por semana (segunda a domingo). Vazio tira o teto.' })
  @IsOptional()
  @IsString({ message: 'Informe o teto da semana em texto, por exemplo "300,00".' })
  @MaxLength(20, { message: 'O teto da semana é longo demais.' })
  semana?: string | null;

  @ApiPropertyOptional({ example: '1.000,00', description: 'Teto por mês. Vazio tira o teto.' })
  @IsOptional()
  @IsString({ message: 'Informe o teto do mês em texto, por exemplo "1.000,00".' })
  @MaxLength(20, { message: 'O teto do mês é longo demais.' })
  mes?: string | null;
}
