import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { COMPARACOES, IDS_DOS_CAMPOS, MAX_REGRAS, type Comparacao } from '../regras-do-publico';

/**
 * Uma regra do público: campo + comparação + valor. A forma é conferida aqui;
 * o valor de cada tipo (inteiro, reais, data, opção) é conferido por
 * `validarRegras`, que dá a frase "Regra N: …".
 */
export class RegraDoPublicoDto {
  @ApiProperty({ enum: IDS_DOS_CAMPOS, example: 'total_pedidos', description: 'O campo, da lista fixa (`GET /publicos-salvos/campos`).' })
  @IsIn(IDS_DOS_CAMPOS, { message: 'Escolha um campo da lista.' })
  campo!: string;

  @ApiProperty({ enum: COMPARACOES, example: '>=' })
  @IsIn(COMPARACOES, { message: 'Escolha a comparação.' })
  comparacao!: Comparacao;

  @ApiProperty({ example: '3', description: 'Inteiro, reais ("80.50"), data (AAAA-MM-DD) ou o valor da opção.' })
  @IsString({ message: 'O valor da regra é um texto.' })
  @MaxLength(80, { message: 'O valor da regra tem até 80 letras.' })
  valor!: string;
}

export class CriarPublicoSalvoDto {
  @ApiProperty({ example: 'Sumidos com 3 ou mais pedidos' })
  @IsString({ message: 'Dê um nome ao público.' })
  @MaxLength(80, { message: 'O nome tem até 80 letras.' })
  nome!: string;

  @ApiProperty({ type: [RegraDoPublicoDto] })
  @IsArray({ message: 'Monte ao menos uma regra.' })
  @ArrayMinSize(1, { message: 'Monte ao menos uma regra.' })
  @ArrayMaxSize(MAX_REGRAS, { message: `São no máximo ${MAX_REGRAS} regras.` })
  @ValidateNested({ each: true })
  @Type(() => RegraDoPublicoDto)
  regras!: RegraDoPublicoDto[];
}

/** Renomear, trocar as regras, ou os dois. Ausente = mantém. */
export class EditarPublicoSalvoDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString({ message: 'Dê um nome ao público.' })
  @MaxLength(80, { message: 'O nome tem até 80 letras.' })
  nome?: string;

  @ApiProperty({ required: false, type: [RegraDoPublicoDto] })
  @IsOptional()
  @IsArray({ message: 'Monte ao menos uma regra.' })
  @ArrayMinSize(1, { message: 'Monte ao menos uma regra.' })
  @ArrayMaxSize(MAX_REGRAS, { message: `São no máximo ${MAX_REGRAS} regras.` })
  @ValidateNested({ each: true })
  @Type(() => RegraDoPublicoDto)
  regras?: RegraDoPublicoDto[];
}
