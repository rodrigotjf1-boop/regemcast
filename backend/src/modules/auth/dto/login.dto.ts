import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'ana@empresa.com.br', maxLength: 254 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(254, { message: 'O e-mail pode ter no máximo 254 caracteres.' })
  email!: string;

  @ApiProperty({ example: 'minha senha 2026', maxLength: 200 })
  @IsString({ message: 'Informe a senha.' })
  @MinLength(1, { message: 'Informe a senha.' })
  @MaxLength(200, { message: 'A senha pode ter no máximo 200 caracteres.' })
  senha!: string;

  /**
   * De onde vem o login: `web` (padrão) ou `app`, o aplicativo Android.
   *
   * Muda duas coisas, e só elas: a sessão do app dura dias em vez de horas, e o
   * token volta no CORPO — o app guarda no cofre do sistema, porque cookie não
   * existe fora do navegador. No navegador o token continua só no cookie
   * httpOnly, que é o que impede um XSS de levar a sessão embora.
   */
  @ApiProperty({ required: false, enum: ['web', 'app'] })
  @IsOptional()
  @IsIn(['web', 'app'], { message: 'Origem do login inválida.' })
  dispositivo?: 'web' | 'app';
}
