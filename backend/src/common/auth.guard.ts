/**
 * Autenticação GLOBAL e fail-closed.
 *
 * O Regem faz o contrário: `JwtAuthGuard` é opt-in por controller, então rota
 * nova nasce anônima e a proteção depende de alguém lembrar do decorator —
 * hoje 11 de 76 controllers estão sem ele. Aqui o guard é global e a exceção é
 * explícita, com `@Publico()`.
 *
 * O guard revalida o usuário no banco a cada request (em escopo de sistema,
 * porque ainda não sabemos a conta). Não há cache: no Regem o cache de 30s em
 * um Map sem limite de tamanho cresce com o número de usuários distintos até o
 * processo reiniciar, e atrasa em até 30s a queda de uma sessão suspensa. Se
 * virar gargalo, a resposta é Redis com invalidação por `token_versao`, não um
 * Map em memória por réplica.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';

import { env } from '../config/env';
import { ContextoDb } from '../db/contexto';
import { usuario as tUsuario } from '../db/schema';
import { PUBLICO } from './publico.decorator';

export interface UsuarioAutenticado {
  id: string;
  contaId: string;
  nome: string;
  email: string;
  papel: 'dono' | 'operador';
  /**
   * Onde esta sessão nasceu. `app` é o aplicativo Android; `web`, o navegador.
   *
   * Não é enfeite de telemetria: o app NÃO monta campanha, e essa regra vive
   * no servidor (`SomenteWebGuard`). Deixá-la só na tela significaria que um
   * token extraído do aparelho poderia criar o que o app não mostra.
   */
  escopo: 'web' | 'app';
}

export interface RequestAutenticado extends Request {
  usuario?: UsuarioAutenticado;
}

interface Payload {
  sub: string;
  conta: string;
  ver: number;
  /** Ausente nas sessões antigas: elas são da web. */
  escopo?: 'web' | 'app';
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly ctx: ContextoDb,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const publico = this.reflector.getAllAndOverride<boolean>(PUBLICO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (publico) return true;

    const req = contexto.switchToHttp().getRequest<RequestAutenticado>();
    const token = this.tokenDoRequest(req);
    if (!token) throw new UnauthorizedException('Faça login para continuar.');

    let payload: Payload;
    try {
      payload = await this.jwt.verifyAsync<Payload>(token, {
        secret: env.sessao.segredo,
      });
    } catch {
      throw new UnauthorizedException('Sua sessão expirou. Entre de novo.');
    }

    const linha = await this.ctx.comEscopoSistema('auth.revalidar', async (db) => {
      const [u] = await db
        .select({
          id: tUsuario.id,
          contaId: tUsuario.contaId,
          nome: tUsuario.nome,
          email: tUsuario.email,
          papel: tUsuario.papel,
          status: tUsuario.status,
          tokenVersao: tUsuario.tokenVersao,
        })
        .from(tUsuario)
        .where(eq(tUsuario.id, payload.sub))
        .limit(1);
      return u;
    });

    if (!linha) throw new UnauthorizedException('Sua sessão expirou. Entre de novo.');
    if (linha.status !== 'ativo') {
      throw new UnauthorizedException('Este acesso foi suspenso.');
    }
    // Trocar senha ou suspender o usuário incrementa a versão e derruba toda
    // sessão em andamento na hora, sem tabela de sessão.
    if (linha.tokenVersao !== payload.ver) {
      throw new UnauthorizedException('Sua sessão expirou. Entre de novo.');
    }
    // O tenant do token nunca vale mais que o do banco: mover um usuário de
    // conta invalida a sessão em vez de continuar valendo por até 12 horas,
    // como acontece no Regem.
    if (linha.contaId !== payload.conta) {
      throw new UnauthorizedException('Sua sessão expirou. Entre de novo.');
    }

    req.usuario = {
      id: linha.id,
      contaId: linha.contaId,
      nome: linha.nome,
      email: linha.email,
      papel: linha.papel as 'dono' | 'operador',
      escopo: payload.escopo === 'app' ? 'app' : 'web',
    };
    return true;
  }

  private tokenDoRequest(req: Request): string | null {
    const cookie = (req as Request & { cookies?: Record<string, string> })
      .cookies?.[env.sessao.cookieNome];
    if (cookie) return cookie;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null;
    return null;
  }
}
