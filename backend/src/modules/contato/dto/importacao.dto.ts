import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { TETO_IMPORTACAO } from '../contato.service';

/** Os quatro formatos aceitos. O nome do arquivo decide qual é. */
export const FORMATOS = ['vcard', 'csv', 'xlsx', 'texto'] as const;
export type Formato = (typeof FORMATOS)[number];

export class PreviaImportacaoDto {
  @ApiProperty({ enum: FORMATOS, description: 'Formato do conteúdo enviado.' })
  @IsIn(FORMATOS, { message: 'Formato não reconhecido.' })
  formato!: Formato;
}

/** Números colados na tela, sem arquivo. */
export class PreviaTextoDto {
  @ApiProperty({ description: 'Números separados por vírgula, ponto e vírgula ou quebra de linha.' })
  @IsString({ message: 'Cole os números.' })
  @MinLength(3, { message: 'Cole ao menos um número.' })
  @MaxLength(500_000, { message: 'O texto é grande demais. Envie um arquivo.' })
  texto!: string;
}

export class ContatoParaImportarDto {
  @ApiProperty({ description: 'Telefone com DDD; o país é assumido como Brasil se faltar.' })
  @IsString({ message: 'Informe o telefone.' })
  @MaxLength(32)
  telefone!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nome?: string;
}

export class ConfirmarImportacaoDto {
  @ApiProperty({ enum: FORMATOS })
  @IsIn(FORMATOS, { message: 'Formato não reconhecido.' })
  formato!: Formato;

  @ApiProperty({ required: false, description: 'Nome do arquivo, guardado como evidência.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  arquivoNome?: string;

  @ApiProperty({ required: false, description: 'Lista em que os contatos entram.' })
  @IsOptional()
  @IsUUID('4', { message: 'Lista inválida.' })
  listaId?: string;

  /**
   * Não é caixinha de termo de uso: é a condição que a Meta exige para disparo
   * iniciado pela empresa, e a que declaramos no App Review. Sem ela o contato
   * não entra.
   */
  @ApiProperty({ description: 'A empresa declara que estes contatos autorizaram receber mensagens.' })
  @IsBoolean({ message: 'Confirme a autorização dos contatos.' })
  consentimento!: boolean;

  @ApiProperty({ required: false, description: 'Como o aceite foi obtido — fica gravado no contato.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  evidencia?: string;

  @ApiProperty({ type: [ContatoParaImportarDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Nenhum contato para importar.' })
  @ArrayMaxSize(TETO_IMPORTACAO, {
    message: `Cada importação aceita até ${TETO_IMPORTACAO} contatos. Divida o arquivo em partes.`,
  })
  @ValidateNested({ each: true })
  @Type(() => ContatoParaImportarDto)
  contatos!: ContatoParaImportarDto[];
}

export class CriarListaDto {
  @ApiProperty({ description: 'Nome do público, para você encontrá-lo depois.' })
  @IsString({ message: 'Dê um nome à lista.' })
  @MinLength(2, { message: 'O nome precisa ter ao menos 2 caracteres.' })
  @MaxLength(120)
  nome!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  descricao?: string;
}
