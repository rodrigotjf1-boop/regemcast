import { Global, Module } from '@nestjs/common';

import { HubService } from './hub.service';
import { HUB_DOS_ERROS } from './hub.token';

/**
 * Global de propósito, como a telemetria: quem manda ao hub é quem trata erro (a telemetria, pelo `HUB_DOS_ERROS`) e
 * a porta MCP (o portão e o middleware do registro). Desligado por padrão (`HUB_LIGADO`); ver `hub.service.ts`.
 */
@Global()
@Module({
  providers: [HubService, { provide: HUB_DOS_ERROS, useExisting: HubService }],
  exports: [HubService, HUB_DOS_ERROS],
})
export class HubModule {}
