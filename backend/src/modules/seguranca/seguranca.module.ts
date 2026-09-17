import { Global, Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { CnpjReceitaService } from './cnpj-receita.service';
import { CodigoVerificacaoService } from './codigo-verificacao.service';

/**
 * Conferências usadas por mais de um módulo: CNPJ na Receita (convite e dados da
 * conta) e códigos por e-mail (convite, login e configurações de segurança).
 */
@Global()
@Module({
  imports: [DrizzleModule],
  providers: [CnpjReceitaService, CodigoVerificacaoService],
  exports: [CnpjReceitaService, CodigoVerificacaoService],
})
export class SegurancaModule {}
