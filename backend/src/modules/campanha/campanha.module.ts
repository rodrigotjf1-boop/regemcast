import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { MetaModule } from '../meta/meta.module';
import { CampanhaController } from './campanha.controller';
import { CampanhaService } from './campanha.service';

/**
 * `MetaModule` entra pelo token do cliente e pelo cliente da Graph — os dois
 * exportados de lá. O disparo não decifra token nem fala com a Meta por conta
 * própria: quem manuseia credencial é um lugar só.
 */
@Module({
  imports: [DrizzleModule, MetaModule],
  controllers: [CampanhaController],
  providers: [CampanhaService],
  exports: [CampanhaService],
})
export class CampanhaModule {}
