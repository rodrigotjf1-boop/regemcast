import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { ContatoController } from './contato.controller';
import { ContatoService } from './contato.service';

/**
 * `AuditoriaModule` entra porque importação é evento que precisa de rastro:
 * quem importou, quantos entraram, de qual arquivo. É a resposta para "de onde
 * veio este contato?" — e a pergunta chega, mais cedo ou mais tarde.
 *
 * Exporta o serviço porque a campanha vai ler o público das listas.
 */
@Module({
  imports: [DrizzleModule, AuditoriaModule],
  controllers: [ContatoController],
  providers: [ContatoService],
  exports: [ContatoService],
})
export class ContatoModule {}
