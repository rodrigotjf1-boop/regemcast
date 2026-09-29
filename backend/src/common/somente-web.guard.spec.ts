import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { ExecutionContext } from '@nestjs/common';

// Os controllers puxam serviços que leem env na importação; aqui só importam
// os decoradores das rotas.
jest.mock('../config/env', () => ({ env: { meta: { graphVersao: 'v21.0' } } }));

import { CampanhaController } from '../modules/campanha/campanha.controller';
import { ModeloController } from '../modules/modelo/modelo.controller';
import { SomenteWebGuard } from './somente-web.guard';

/** Os guards declarados na rota, como o Nest os lê. */
function guardsDe(metodo: (...args: never[]) => unknown): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, metodo) as unknown[] | undefined) ?? [];
}

function contextoCom(escopo?: 'web' | 'app'): ExecutionContext {
  const req = { usuario: escopo ? { escopo } : undefined };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('SomenteWebGuard', () => {
  const guard = new SomenteWebGuard();

  it('recusa a sessão do aplicativo e deixa passar a do navegador (e a antiga, sem escopo)', () => {
    expect(() => guard.canActivate(contextoCom('app'))).toThrow('pelo navegador');
    expect(guard.canActivate(contextoCom('web'))).toBe(true);
    expect(guard.canActivate(contextoCom())).toBe(true);
  });

  it('criar modelo é liberado para o aplicativo (decisão do dono, 29/09/2026)', () => {
    expect(guardsDe(ModeloController.prototype.criar)).not.toContain(SomenteWebGuard);
  });

  it('montar campanha continua só no navegador', () => {
    expect(guardsDe(CampanhaController.prototype.criar)).toContain(SomenteWebGuard);
  });
});
