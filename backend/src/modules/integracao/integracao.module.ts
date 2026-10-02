import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { DistribuicaoModule } from '../distribuicao/distribuicao.module';
import { IntegracaoDistribuicaoController } from './integracao-distribuicao.controller';
import { IntegracaoController } from './integracao.controller';
import { IntegracaoGuard } from './integracao.guard';
import { IntegracaoService } from './integracao.service';
import { McpController } from './mcp.controller';
import { McpServidor } from './mcp.servidor';

/**
 * A porta para outros produtos da DMS: o token de integração (emissão no
 * console, "Aplicativos conectados" na conta) e o servidor MCP (`/mcp`).
 * Desenho e decisões em `docs/mcp.md`.
 *
 * `DistribuicaoModule` entra pelo portão e pelo livro de acessos do console.
 * `AuditoriaModule` é global.
 */
@Module({
  imports: [DrizzleModule, DistribuicaoModule],
  controllers: [McpController, IntegracaoController, IntegracaoDistribuicaoController],
  providers: [IntegracaoService, IntegracaoGuard, McpServidor],
})
export class IntegracaoModule {}
