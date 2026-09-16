import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Teto de destinatários por campanha, **enquanto o disparo for síncrono**.
 *
 * Não é limite de produto: é limite de arquitetura, e some quando a fila
 * entrar. Enquanto o envio acontece dentro do request, uma campanha grande
 * seguraria a conexão de banco e o request por minutos — e um timeout no meio
 * deixaria metade enviada sem ninguém saber qual metade.
 *
 * Melhor recusar com explicação do que aceitar e falhar no meio.
 */
export const TETO_DESTINATARIOS = 10;

export class DestinatarioDto {
  /**
   * E.164 sem o `+`: país + DDD + número, só dígitos.
   *
   * Validado aqui e não só no envio porque a Meta cobra a tentativa e o erro
   * dela (131026) não diz que o problema foi formato.
   */
  @ApiProperty({ description: 'Telefone em E.164 sem o +, ex.: 5521999998888.' })
  @IsString({ message: 'Informe o telefone.' })
  @Matches(/^[1-9]\d{7,14}$/, {
    message: 'O telefone precisa ter país + DDD + número, só dígitos. Exemplo: 5521999998888.',
  })
  telefone!: string;

  /** Valores das variáveis, em ordem: o primeiro é `{{1}}`. */
  @ApiProperty({ required: false, type: [String], description: 'Valores das variáveis, em ordem.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'Um modelo aceita no máximo 10 variáveis.' })
  @IsString({ each: true, message: 'Cada variável precisa ser um texto.' })
  @MaxLength(1024, { each: true, message: 'Cada variável precisa ter até 1024 caracteres.' })
  variaveis?: string[];
}

export class CriarCampanhaDto {
  @ApiProperty({ description: 'Nome da campanha, para você encontrá-la depois.' })
  @IsString({ message: 'Dê um nome à campanha.' })
  @MinLength(2, { message: 'O nome precisa ter ao menos 2 caracteres.' })
  @MaxLength(120, { message: 'O nome precisa ter até 120 caracteres.' })
  nome!: string;

  @ApiProperty({ description: 'Nome do modelo aprovado na Meta.' })
  @IsString({ message: 'Escolha um modelo.' })
  @MaxLength(512)
  modeloNome!: string;

  @ApiProperty({ description: 'Idioma do modelo, ex.: pt_BR.' })
  @IsString({ message: 'Informe o idioma do modelo.' })
  @MaxLength(32)
  modeloIdioma!: string;

  @ApiProperty({ required: false, description: 'Id do modelo na Meta.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  modeloId?: string;

  @ApiProperty({ required: false, description: 'Categoria do modelo.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  modeloCategoria?: string;

  @ApiProperty({ type: [DestinatarioDto], description: 'Quem vai receber.' })
  @IsArray()
  @ArrayMinSize(1, { message: 'Escolha ao menos um destinatário.' })
  @ArrayMaxSize(TETO_DESTINATARIOS, {
    message: `Por enquanto cada campanha aceita até ${TETO_DESTINATARIOS} destinatários. O envio em volume entra com a fila.`,
  })
  @ValidateNested({ each: true })
  @Type(() => DestinatarioDto)
  destinatarios!: DestinatarioDto[];
}
