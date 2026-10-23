/**
 * O módulo de verdade põe o registro do hub em toda chamada da porta MCP, da troca automática da ligação e das duas
 * rotas da autorização por clique do lado do aplicativo (os testes da porta montam um módulo igual, e este confere que
 * o de produção não ficou para trás).
 */
jest.mock('../../config/env', () => ({ env: {} }));

import type { MiddlewareConsumer } from '@nestjs/common';

import { AutorizacaoPortaController } from './autorizacao-porta.controller';
import { DmsIdController } from './dms-id.controller';
import { IntegracaoModule } from './integracao.module';
import { ManifestoController } from './manifesto.controller';
import { McpController } from './mcp.controller';
import { RegistroDaPorta } from './registro-da-porta.middleware';

it('o IntegracaoModule aplica o RegistroDaPorta à porta MCP, à troca automática e às rotas da autorização do aplicativo', () => {
  const forRoutes = jest.fn();
  const apply = jest.fn(() => ({ forRoutes, exclude: jest.fn() }));
  new IntegracaoModule().configure({ apply } as unknown as MiddlewareConsumer);
  expect(apply).toHaveBeenCalledWith(RegistroDaPorta);
  // o manifesto (ManifestoController) fica de fora: não é chamada da porta
  expect(forRoutes).toHaveBeenCalledWith(McpController, DmsIdController, AutorizacaoPortaController);
});

it('o IntegracaoModule serve o manifesto da porta (Padrão DMS §13)', () => {
  expect(Reflect.getMetadata('controllers', IntegracaoModule)).toContain(ManifestoController);
});
