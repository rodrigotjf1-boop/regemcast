import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { EhTelefoneE164 } from './telefone';
import { Aparar, AparaMinusculo } from './texto';

/**
 * Cadastro público na fila de entrada.
 *
 * Só estes cinco campos entram. O ValidationPipe global roda com
 * `forbidNonWhitelisted`, então mandar `status` ou `conta_id` aqui é 400 — e
 * não uma escalada silenciosa como seria se o corpo fosse aproveitado inteiro.
 */
export class CriarListaEsperaDto {
  @ApiProperty({ example: 'Maria Souza', description: 'Nome de quem pediu a vaga.' })
  @Aparar()
  @IsString({ message: 'Informe seu nome.' })
  @IsNotEmpty({ message: 'Informe seu nome.' })
  @MaxLength(120, { message: 'O nome pode ter no máximo 120 caracteres.' })
  nome!: string;

  @ApiProperty({ example: 'maria@empresa.com.br', description: 'E-mail de contato.' })
  @AparaMinusculo()
  @IsEmail({}, { message: 'Informe um e-mail válido, como maria@empresa.com.br.' })
  @MaxLength(254, { message: 'O e-mail pode ter no máximo 254 caracteres.' })
  email!: string;

  @ApiPropertyOptional({ example: 'Padaria Bom Dia', description: 'Nome da empresa.' })
  @Aparar()
  @IsOptional()
  @IsString({ message: 'Informe o nome da empresa em texto.' })
  @MaxLength(160, { message: 'O nome da empresa pode ter no máximo 160 caracteres.' })
  empresa?: string;

  @ApiPropertyOptional({
    example: '11987654321',
    description: 'Telefone com DDD. Guardamos sempre em E.164, com o "+".',
  })
  @Aparar()
  @IsOptional()
  @EhTelefoneE164()
  telefone?: string;

  @ApiPropertyOptional({
    example: 'site',
    description: 'De onde veio o cadastro (campanha, indicação, site).',
  })
  @Aparar()
  @IsOptional()
  @IsString({ message: 'Informe a origem em texto.' })
  @MaxLength(60, { message: 'A origem pode ter no máximo 60 caracteres.' })
  origem?: string;
}
