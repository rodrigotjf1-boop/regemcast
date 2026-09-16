import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { EhTelefoneE164 } from '../../lista-espera/dto/telefone';

/** HH:MM de 00:00 a 23:59. */
const HORA = new RegExp('^([01][0-9]|2[0-3]):[0-5][0-9]$');

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
   * Telefone com DDD. O país é assumido como Brasil quando não vier.
   *
   * Validado aqui e não só no envio porque a Meta cobra a tentativa e o erro
   * dela (131026) não diz que o problema foi formato.
   *
   * O validador é o MESMO do resto do produto (`libphonenumber-js`), e é essa
   * unificação que corrige um defeito real: a regra anterior aceitava qualquer
   * coisa entre 8 e 15 dígitos, então "21989751705" — o jeito como todo
   * brasileiro escreve o próprio número — passava sem o 55 e a Meta o lia como
   * um número internacional inexistente.
   */
  @ApiProperty({ description: 'Telefone com DDD, ex.: 21 99999-8888 ou 5521999998888.' })
  @IsString({ message: 'Informe o telefone.' })
  @EhTelefoneE164({
    message: 'Informe um telefone válido com DDD, por exemplo 21 99999-8888.',
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

  // ---- janela de envio (opcional)
  //
  // Sem nada disso a campanha sai assim que disparada. Com janela, o worker só
  // envia dentro dos dias e horários marcados, no fuso da conta.

  @ApiProperty({ required: false, type: [Number], description: 'Dias: 0=domingo … 6=sábado. Vazio = qualquer dia.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true, message: 'Dia da semana inválido.' })
  @Max(6, { each: true, message: 'Dia da semana inválido.' })
  janelaDias?: number[];

  @ApiProperty({ required: false, description: 'Início da janela, HH:MM.' })
  @IsOptional()
  @Matches(HORA, { message: 'Horário de início inválido. Use HH:MM.' })
  janelaInicio?: string;

  @ApiProperty({ required: false, description: 'Fim da janela, HH:MM.' })
  @IsOptional()
  @Matches(HORA, { message: 'Horário de fim inválido. Use HH:MM.' })
  janelaFim?: string;

  // ---- ritmo (opcional)

  @ApiProperty({ required: false, description: 'Segundos entre uma mensagem e a próxima.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600, { message: 'A pausa entre envios pode ser de até 1 hora.' })
  pausaSegundos?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxPorDia?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxPorSemana?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxPorMes?: number;
}
