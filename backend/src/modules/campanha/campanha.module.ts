import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { MetaModule } from '../meta/meta.module';
import { MidiaModule } from '../midia/midia.module';
import { CampanhaController } from './campanha.controller';
import { CampanhaService } from './campanha.service';
import { CampanhaWorker } from './campanha.worker';

/**
 * `MetaModule` entra pelo token do cliente e pelo cliente da Graph — os dois
 * exportados de lá. O disparo não decifra token nem fala com a Meta por conta
 * própria: quem manuseia credencial é um lugar só.
 *
 * `MidiaModule` entra pela mídia do modelo: o disparo de um modelo com imagem
 * entrega o arquivo à Meta (uma vez por rodada) antes de enviar.
 */
@Module({
  imports: [DrizzleModule, MetaModule, MidiaModule],
  controllers: [CampanhaController],
  providers: [CampanhaService, CampanhaWorker],
  exports: [CampanhaService],
})
export class CampanhaModule {}
