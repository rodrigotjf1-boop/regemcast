import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { DestinatarioDto, TETO_DESTINATARIOS, VariavelDeListaDto } from './criar-campanha.dto';
import { PublicoDaCampanhaDto } from './publico-da-campanha.dto';

const HORA = new RegExp('^([01][0-9]|2[0-3]):[0-5][0-9]$');

/**
 * O que dá para mudar numa campanha já montada.
 *
 * Tudo aqui é opcional: a tela manda só o que mexeu. O que pode ser mudado
 * depende da situação da campanha, e quem decide isso é o serviço — em
 * rascunho muda tudo; depois de disparada, só a janela, o ritmo e os limites.
 * Modelo e público de campanha que já saiu são história, não configuração:
 * trocá-los faria a tela mentir sobre o que foi enviado.
 */
export class EditarCampanhaDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'O nome precisa ter ao menos 2 caracteres.' })
  @MaxLength(120, { message: 'O nome precisa ter até 120 caracteres.' })
  nome?: string;

  // ---- só em rascunho

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  modeloNome?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  modeloIdioma?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  modeloId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  modeloCategoria?: string;

  @ApiProperty({ required: false, type: [DestinatarioDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Escolha ao menos um destinatário.' })
  @ArrayMaxSize(TETO_DESTINATARIOS, {
    message: `Digitando, cada campanha aceita até ${TETO_DESTINATARIOS} números. Para mais, importe em Contatos e escolha a lista.`,
  })
  @ValidateNested({ each: true })
  @Type(() => DestinatarioDto)
  destinatarios?: DestinatarioDto[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID('4', { message: 'Lista inválida.' })
  listaId?: string;

  @ApiProperty({ required: false, type: PublicoDaCampanhaDto, description: 'Um público da base, em vez de lista.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PublicoDaCampanhaDto)
  daBase?: PublicoDaCampanhaDto;

  @ApiProperty({ required: false, type: [VariavelDeListaDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => VariavelDeListaDto)
  variaveisLista?: VariavelDeListaDto[];

  // ---- janela e ritmo: valem em qualquer situação editável

  @ApiProperty({ required: false, type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true, message: 'Dia da semana inválido.' })
  @Max(6, { each: true, message: 'Dia da semana inválido.' })
  janelaDias?: number[];

  @ApiProperty({ required: false })
  @IsOptional()
  @Matches(HORA, { message: 'Horário de início inválido. Use HH:MM.' })
  janelaInicio?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @Matches(HORA, { message: 'Horário de fim inválido. Use HH:MM.' })
  janelaFim?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600, { message: 'A pausa entre envios pode ser de até 1 hora.' })
  pausaSegundos?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxPorDia?: number | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxPorSemana?: number | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxPorMes?: number | null;
}
