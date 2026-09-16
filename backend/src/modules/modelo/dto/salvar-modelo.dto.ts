import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { LIMITE_BOTOES, LIMITE_CORPO, LIMITE_NOME } from '../regras-modelo';

export const CATEGORIAS = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const;
export const FORMATOS_CABECALHO = ['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'] as const;
export const TIPOS_BOTAO = ['URL', 'PHONE_NUMBER', 'QUICK_REPLY', 'COPY_CODE'] as const;

export class BotaoDto {
  @ApiProperty({ enum: TIPOS_BOTAO })
  @IsIn(TIPOS_BOTAO, { message: 'Tipo de botão não reconhecido.' })
  tipo!: (typeof TIPOS_BOTAO)[number];

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  texto!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  telefone?: string;
}

/**
 * O modelo como o cliente escreve.
 *
 * A validação aqui é só de FORMA — tipo, tamanho máximo, valor de enum. As
 * regras da Meta (variável no fim do corpo, rodapé com oferta por tempo
 * limitado, exemplo do cabeçalho) ficam em `regras-modelo.ts` e rodam no envio,
 * não no salvamento: rascunho pode estar errado, é rascunho.
 */
export class SalvarModeloDto {
  @ApiProperty({ description: 'Nome técnico: minúsculas, números e underline.' })
  @IsString({ message: 'Dê um nome técnico ao modelo.' })
  @MaxLength(LIMITE_NOME)
  nome!: string;

  @ApiProperty({ required: false, default: 'pt_BR' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  idioma?: string;

  @ApiProperty({ enum: CATEGORIAS, required: false })
  @IsOptional()
  @IsIn(CATEGORIAS, { message: 'Categoria não reconhecida.' })
  categoria?: (typeof CATEGORIAS)[number];

  @ApiProperty({ enum: FORMATOS_CABECALHO, required: false })
  @IsOptional()
  @IsIn(FORMATOS_CABECALHO, { message: 'Formato de cabeçalho não reconhecido.' })
  cabecalhoFormato?: (typeof FORMATOS_CABECALHO)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cabecalhoTexto?: string;

  @ApiProperty({ required: false, description: 'Exemplo do valor de {{1}} no cabeçalho.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cabecalhoExemplo?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cabecalhoMidia?: string;

  @ApiProperty()
  @IsString({ message: 'Escreva a mensagem.' })
  @MaxLength(LIMITE_CORPO, { message: `A mensagem precisa ter até ${LIMITE_CORPO} caracteres.` })
  corpo!: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  corpoExemplos?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  rodape?: string;

  @ApiProperty({ required: false, type: [BotaoDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(LIMITE_BOTOES, { message: `Um modelo aceita até ${LIMITE_BOTOES} botões.` })
  @ValidateNested({ each: true })
  @Type(() => BotaoDto)
  botoes?: BotaoDto[];

  @ApiProperty({ required: false, description: 'Oferta por tempo limitado (só MARKETING).' })
  @IsOptional()
  @IsBoolean()
  ltoAtivo?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ltoTexto?: string;
}
