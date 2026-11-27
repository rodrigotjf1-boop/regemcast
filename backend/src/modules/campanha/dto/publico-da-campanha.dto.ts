import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { RegraDoPublicoDto } from '../../contato/dto/regra-do-publico.dto';
import { ORIGENS_DA_TELA, type OrigemDaTela } from '../../contato/origem-do-publico';
import { PUBLICOS, TAMANHO_MAXIMO_VALOR, type Publico } from '../../contato/publicos';
import { MAX_REGRAS } from '../../contato/regras-do-publico';
import { SEGMENTOS, type Segmento } from '../../contato/segmentacao';

/**
 * De onde sai o público da campanha: uma lista, ou um público da base — toda a
 * base, uma importação, um perfil, um estado (pelo DDD), um público pronto ou
 * um público montado com regras (migration 053). Os mesmos campos da divisão
 * em blocos (`origem-do-publico.ts`), mais as regras.
 */
export class PublicoDaCampanhaDto {
  @ApiProperty({ enum: ORIGENS_DA_TELA, description: 'De onde saem os contatos.' })
  @IsIn(ORIGENS_DA_TELA, { message: 'Escolha de onde sai o público.' })
  origem!: OrigemDaTela;

  @ApiProperty({
    required: false,
    type: [RegraDoPublicoDto],
    description: 'As regras, quando a origem é `regras` sem público salvo. O contato precisa cumprir todas.',
  })
  @ValidateIf((d: PublicoDaCampanhaDto) => d.origem === 'regras' && !d.publicoSalvoId)
  @IsArray({ message: 'Monte ao menos uma regra.' })
  @ArrayMinSize(1, { message: 'Monte ao menos uma regra.' })
  @ArrayMaxSize(MAX_REGRAS, { message: `São no máximo ${MAX_REGRAS} regras.` })
  @ValidateNested({ each: true })
  @Type(() => RegraDoPublicoDto)
  regras?: RegraDoPublicoDto[];

  @ApiProperty({ required: false, description: 'O público salvo. Com ele, valem as regras gravadas, não as do pedido.' })
  @IsOptional()
  @IsUUID('4', { message: 'Escolha o público salvo.' })
  publicoSalvoId?: string;

  @ApiProperty({ required: false, example: 1, description: 'Só uma parte: do contato N (a partir de 1), na ordem em que entraram na base.' })
  @IsOptional()
  @IsInt({ message: 'A parte vai de um contato a outro: números inteiros.' })
  @Min(1)
  @Max(1_000_000)
  parteDe?: number;

  @ApiProperty({ required: false, example: 500, description: 'Só uma parte: até o contato N.' })
  @IsOptional()
  @IsInt({ message: 'A parte vai de um contato a outro: números inteiros.' })
  @Min(1)
  @Max(1_000_000)
  parteAte?: number;

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

/** A prévia de "Quem recebe": o público; com variável de cashback, só quem tem cashback válido; com a categoria do modelo, o custo estimado. */
export class PreviaDoPublicoDto extends PublicoDaCampanhaDto {
  @ApiProperty({
    required: false,
    description: 'A mensagem usa variável de cashback: conta só quem tem cashback válido, como a montagem.',
  })
  @IsOptional()
  @IsBoolean({ message: 'soComCashback precisa ser verdadeiro ou falso.' })
  soComCashback?: boolean;

  @ApiProperty({
    required: false,
    example: 'marketing',
    description: 'A categoria do modelo escolhido. Com ela, a prévia traz o custo estimado na Meta. Nada é gravado.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  categoria?: string;
}
