import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Os quatro números da classificação da base (migration 022). */
export class ParametrosSegmentacaoDto {
  @ApiProperty({ example: 30, description: 'Comprou recentemente: última compra até N dias.' })
  @IsInt({ message: 'Informe os dias de "recente" em número inteiro.' })
  @Min(1)
  @Max(365)
  recenteDias!: number;

  @ApiProperty({ example: 90, description: 'Ainda ativo: até N dias.' })
  @IsInt({ message: 'Informe os dias de "ativo" em número inteiro.' })
  @Min(2)
  @Max(730)
  ativoDias!: number;

  @ApiProperty({ example: 180, description: 'Em risco: até N dias. Depois disso, perdido.' })
  @IsInt({ message: 'Informe os dias de "em risco" em número inteiro.' })
  @Min(3)
  @Max(1095)
  riscoDias!: number;

  @ApiProperty({ example: 5, description: 'Compra com frequência: N pedidos ou mais.' })
  @IsInt({ message: 'Informe a quantidade de pedidos em número inteiro.' })
  @Min(2)
  @Max(1000)
  fielPedidos!: number;
}

export class CriarListaDoPerfilDto {
  @ApiProperty({ required: false, description: 'Nome da lista. Padrão: "<perfil> — <data>".' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nome?: string;
}
