/**
 * O limite de tentativas contado pelo IP REAL de quem acessa (ver
 * `ip-cliente.ts`), e não pelo do proxy que entregou o pedido.
 */
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

import { ipDoCliente } from './ip-cliente';

@Injectable()
export class LimitePorIpGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    return ipDoCliente(req as unknown as Request) ?? String(req.ip ?? 'desconhecido');
  }
}
