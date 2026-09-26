import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

import {
  ORDENS_DOS_BLOCOS,
  ORIGENS_DA_DIVISAO,
  TAMANHO_MAXIMO,
  TAMANHO_MINIMO,
  type OrdemDosBlocos,
  type OrigemDaDivisao,
} from '../blocos.regras';
import { PUBLICOS, TAMANHO_MAXIMO_VALOR, type Publico } from '../publicos';
import { SEGMENTOS, type Segmento } from '../segmentacao';

/** Dividir um conjunto de contatos em blocos (listas) do mesmo tamanho. */
export class DividirEmBlocosDto {
  @ApiProperty({ enum: ORIGENS_DA_DIVISAO, description: 'De onde saem os contatos.' })
  @IsIn(ORIGENS_DA_DIVISAO, { message: 'Escolha de onde saem os contatos.' })
  origem!: OrigemDaDivisao;

  @ApiProperty({ required: false, description: 'A lista ou a importação, quando a origem é uma delas.' })
  @ValidateIf((d: DividirEmBlocosDto) => d.origem === 'lista' || d.origem === 'importacao')
  @IsUUID('4', { message: 'Escolha a lista ou a importação.' })
  origemId?: string;

  @ApiProperty({ required: false, enum: SEGMENTOS, description: 'O perfil, quando a origem é um perfil.' })
  @ValidateIf((d: DividirEmBlocosDto) => d.origem === 'perfil')
  @IsIn(SEGMENTOS, { message: 'Escolha o perfil.' })
  segmento?: Segmento;

  @ApiProperty({ required: false, example: 'RJ', description: 'O estado, quando a origem é uma região.' })
  @ValidateIf((d: DividirEmBlocosDto) => d.origem === 'regiao')
  @Matches(/^[A-Za-z]{2}$/, { message: 'Escolha o estado.' })
  uf?: string;

  @ApiProperty({ required: false, enum: PUBLICOS, description: 'O público pronto, quando a origem é um público.' })
  @ValidateIf((d: DividirEmBlocosDto) => d.origem === 'publico')
  @IsIn(PUBLICOS, { message: 'Escolha o público.' })
  publico?: Publico;

  @ApiProperty({ required: false, description: 'O bairro, o mês (1 a 12) ou o produto, quando o público pede.' })
  @IsOptional()
  @IsString()
  @MaxLength(TAMANHO_MAXIMO_VALOR)
  publicoValor?: string;

  @ApiProperty({ example: 250, description: 'Contatos por bloco. Acima do limite de envio da Meta é recusado.' })
  @IsInt({ message: 'O tamanho do bloco é um número inteiro.' })
  @Min(TAMANHO_MINIMO, { message: `Cada bloco precisa de pelo menos ${TAMANHO_MINIMO} contatos.` })
  @Max(TAMANHO_MAXIMO)
  tamanho!: number;

  @ApiProperty({ enum: ORDENS_DOS_BLOCOS, description: 'Em que ordem os contatos entram nos blocos.' })
  @IsIn(ORDENS_DOS_BLOCOS, { message: 'Escolha a ordem dos blocos.' })
  ordem!: OrdemDosBlocos;

  @ApiProperty({ required: false, description: 'Só quem ainda não recebeu nenhuma campanha.' })
  @IsOptional()
  @IsBoolean()
  soNuncaReceberam?: boolean;

  @ApiProperty({ required: false, description: 'Nome dos blocos. Padrão: o nome da origem e a data.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  nome?: string;
}
