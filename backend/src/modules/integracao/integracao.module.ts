import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';

import { DrizzleModule } from '../../db/drizzle.module';
import { CampanhaModule } from '../campanha/campanha.module';
import { ContaModule } from '../conta/conta.module';
import { ContatoModule } from '../contato/contato.module';
import { DistribuicaoModule } from '../distribuicao/distribuicao.module';
import { MetaModule } from '../meta/meta.module';
import { ModeloModule } from '../modelo/modelo.module';
import { OrcamentoModule } from '../orcamento/orcamento.module';
import { AutorizacaoPortaController } from './autorizacao-porta.controller';
import { AutorizacaoController } from './autorizacao.controller';
import { AutorizacaoService } from './autorizacao.service';
import { AvisoDeLigacao } from './aviso-de-ligacao.service';
import { DmsIdController } from './dms-id.controller';
import { DmsIdService } from './dms-id.service';
import { IdempotenciaJob } from './idempotencia.job';
import { IntegracaoDistribuicaoController } from './integracao-distribuicao.controller';
import { IntegracaoController } from './integracao.controller';
import { IntegracaoGuard } from './integracao.guard';
import { IntegracaoService } from './integracao.service';
import { ManifestoController } from './manifesto.controller';
import { McpController } from './mcp.controller';
import { McpServidor } from './mcp.servidor';
import { RegistroDaPorta } from './registro-da-porta.middleware';

/**
 * A porta para outros produtos da DMS: o token de integração (emissão no
 * console, "Aplicativos conectados" na conta), o servidor MCP (`/mcp`) e a via
 * do DMS ID do Hub DMS (a ligação, desligada por padrão: `DMS_ID_LIGADO`).
 * Desenho e decisões em `docs/mcp.md`.
 *
 * `DistribuicaoModule` entra pelo portão e pelo livro de acessos do console.
 * Os módulos de campanha, conta, contato, Meta, modelo e orçamento entram pelos
 * serviços que as ferramentas reaproveitam — os mesmos das telas.
 * `AuditoriaModule` e `HubModule` são globais.
 *
 * Cada chamada da porta MCP e das duas rotas da autorização por clique do lado
 * do aplicativo (o pedido e a troca do código) passa pelo `RegistroDaPorta` (o
 * código do pedido e o registro central do hub, desligado por padrão:
 * `HUB_LIGADO`). A autorização por clique nasce desligada (`AUTORIZACAO_POR_CLIQUE`).
 * `EmailModule` e `AvisoModule` são globais (o aviso ao dono a cada ligação).
 *
 * O manifesto da porta (Padrão DMS §13; Hub DMS, F4 parte A) fica em `/.well-known/dms-manifesto`, sem credencial e fora
 * do `RegistroDaPorta` (`manifesto.ts`; o arquivo do repositório é `docs/dms-manifesto.json`).
 */
@Module({
  imports: [DrizzleModule, DistribuicaoModule, CampanhaModule, ContaModule, ContatoModule, MetaModule, ModeloModule, OrcamentoModule],
  controllers: [
    McpController,
    DmsIdController,
    ManifestoController,
    IntegracaoController,
    IntegracaoDistribuicaoController,
    AutorizacaoController,
    AutorizacaoPortaController,
  ],
  providers: [IntegracaoService, IntegracaoGuard, DmsIdService, McpServidor, IdempotenciaJob, AutorizacaoService, AvisoDeLigacao],
})
export class IntegracaoModule implements NestModule {
  configure(consumidor: MiddlewareConsumer): void {
    consumidor.apply(RegistroDaPorta).forRoutes(McpController, DmsIdController, AutorizacaoPortaController);
  }
}
