import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { PUBLICOS, TAMANHO_MAXIMO_VALOR, type Publico } from '../publicos';

/** Foto de um público pronto numa lista — é assim que ele vira público de campanha. */
export class CriarListaDoPublicoDto {
  @ApiProperty({ enum: PUBLICOS, description: 'O público pronto.' })
  @IsIn(PUBLICOS, { message: 'Escolha o público.' })
  publico!: Publico;

  @ApiProperty({
    required: false,
    example: 'Tijuca',
    description: 'O bairro (público `bairro`), o mês de 1 a 12 (público `aniversario`) ou o nome do produto (público `produto`).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(TAMANHO_MAXIMO_VALOR)
  valor?: string;

  @ApiProperty({ required: false, description: 'Nome da lista. Padrão: "<público> — <data>".' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nome?: string;
}
