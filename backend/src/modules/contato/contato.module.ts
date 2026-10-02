import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { ContatoController } from './contato.controller';
import { ContatoService } from './contato.service';
import { DivisaoService } from './divisao.service';
import { PublicosService } from './publicos.service';
import { SegmentacaoService } from './segmentacao.service';

/**
 * `AuditoriaModule` entra porque importação é evento que precisa de rastro:
 * quem importou, quantos entraram, de qual arquivo. É a resposta para "de onde
 * veio este contato?" — e a pergunta chega, mais cedo ou mais tarde.
 *
 * Exporta o serviço porque a campanha vai ler o público das listas, e os de
 * públicos e perfis porque o MCP devolve as mesmas contagens das telas.
 */
@Module({
  imports: [DrizzleModule, AuditoriaModule],
  controllers: [ContatoController],
  providers: [ContatoService, SegmentacaoService, DivisaoService, PublicosService],
  exports: [ContatoService, PublicosService, SegmentacaoService],
})
export class ContatoModule {}
