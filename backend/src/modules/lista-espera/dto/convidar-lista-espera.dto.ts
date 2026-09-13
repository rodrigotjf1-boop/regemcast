import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class ConvidarListaEsperaDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Emite o convite mesmo com a janela de 7 dias cheia. Use só quando o teto ' +
      'da Meta já tiver mudado — o convite forçado fica marcado na auditoria.',
  })
  @IsOptional()
  @IsBoolean({ message: 'O campo "forcar" aceita apenas true ou false.' })
  forcar?: boolean;
}
