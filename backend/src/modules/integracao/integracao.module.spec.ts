/**
 * O módulo de verdade põe o registro do hub em toda chamada da porta MCP (os testes da porta montam um módulo igual,
 * e este confere que o de produção não ficou para trás).
 */
jest.mock('../../config/env', () => ({ env: {} }));

import type { MiddlewareConsumer } from '@nestjs/common';

import { IntegracaoModule } from './integracao.module';
import { McpController } from './mcp.controller';
import { RegistroDaPorta } from './registro-da-porta.middleware';

it('o IntegracaoModule aplica o RegistroDaPorta às rotas do McpController', () => {
  const forRoutes = jest.fn();
  const apply = jest.fn(() => ({ forRoutes, exclude: jest.fn() }));
  new IntegracaoModule().configure({ apply } as unknown as MiddlewareConsumer);
  expect(apply).toHaveBeenCalledWith(RegistroDaPorta);
  expect(forRoutes).toHaveBeenCalledWith(McpController);
});
