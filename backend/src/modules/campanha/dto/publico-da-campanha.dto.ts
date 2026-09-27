import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';

import { ORIGENS_DO_PUBLICO, type OrigemDoPublico } from '../../contato/origem-do-publico';
import { PUBLICOS, TAMANHO_MAXIMO_VALOR, type Publico } from '../../contato/publicos';
import { SEGMENTOS, type Segmento } from '../../contato/segmentacao';

/**
 * De onde sai o público da campanha: uma lista, ou um público da base — toda a
 * base, uma importação, um perfil, um estado (pelo DDD) ou um público pronto.
 * Os mesmos campos da divisão em blocos (`origem-do-publico.ts`).
 */
export class PublicoDaCampanhaDto {
  @ApiProperty({ enum: ORIGENS_DO_PUBLICO, description: 'De onde saem os contatos.' })
  @IsIn(ORIGENS_DO_PUBLICO, { message: 'Escolha de onde sai o público.' })
  origem!: OrigemDoPublico;

  @ApiProperty({ required: false, description: 'A lista ou a importação, quando a origem é uma delas.' })
  @ValidateIf((d: PublicoDaCampanhaDto) => d.origem === 'lista' || d.origem === 'importacao')
  @IsUUID('4', { message: 'Escolha a lista ou a importação.' })
  origemId?: string;

  @ApiProperty({ required: false, enum: SEGMENTOS, description: 'O perfil, quando a origem é um perfil.' })
  @ValidateIf((d: PublicoDaCampanhaDto) => d.origem === 'perfil')
  @IsIn(SEGMENTOS, { message: 'Escolha o perfil.' })
  segmento?: Segmento;

  @ApiProperty({ required: false, example: 'RJ', description: 'O estado, quando a origem é uma região.' })
  @ValidateIf((d: PublicoDaCampanhaDto) => d.origem === 'regiao')
  @Matches(/^[A-Za-z]{2}$/, { message: 'Escolha o estado.' })
  uf?: string;

  @ApiProperty({ required: false, enum: PUBLICOS, description: 'O público pronto, quando a origem é um público.' })
  @ValidateIf((d: PublicoDaCampanhaDto) => d.origem === 'publico')
  @IsIn(PUBLICOS, { message: 'Escolha o público.' })
  publico?: Publico;

  @ApiProperty({ required: false, description: 'O bairro, o mês (1 a 12) ou o produto, quando o público pede.' })
  @IsOptional()
  @IsString()
  @MaxLength(TAMANHO_MAXIMO_VALOR)
  publicoValor?: string;
}

/** A prévia de "Quem recebe": o público e, com variável de cashback, só quem tem cashback válido. */
export class PreviaDoPublicoDto extends PublicoDaCampanhaDto {
  @ApiProperty({
    required: false,
    description: 'A mensagem usa variável de cashback: conta só quem tem cashback válido, como a montagem.',
  })
  @IsOptional()
  @IsBoolean({ message: 'soComCashback precisa ser verdadeiro ou falso.' })
  soComCashback?: boolean;
}
