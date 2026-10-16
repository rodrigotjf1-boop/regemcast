/**
 * O portão da porta MCP: só passa quem traz uma credencial válida.
 *
 * Duas vias:
 * - **o token de integração** (`rct_it_`), a de sempre, com as respostas de
 *   sempre;
 * - **o DMS ID** (Hub DMS, F2), só com `DMS_ID_LIGADO`: o token do DMS ID no
 *   `Authorization` e o segredo da ligação no `DMS-Ligacao`. As recusas saem no
 *   formato do Padrão (`ErroProblema` → `ProblemaFilter`), com o
 *   `WWW-Authenticate` que aponta os metadados do recurso (RFC 9728).
 *
 * O `rct_it_` tem a vez: com ele no cabeçalho, nada muda, ligado ou não.
 *
 * A rota também leva `@Publico()` (para escapar do guard de cliente, que
 * recusaria por falta de sessão) e `@SkipThrottle()` (o teto global é por IP,
 * e um produto da DMS chega de UM endereço para todas as contas: o teto de IP
 * viraria teto do produto inteiro). O limite daqui é por TOKEN (ou ligação,
 * que herda o id do token), no mesmo armazenamento do limite global — Redis em
 * produção, para valer entre réplicas e sobreviver a deploy.
 */
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectThrottlerStorage, type ThrottlerStorage } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { ErroProblema } from '../../dms/integracao-dms';
import { DmsIdService } from './dms-id.service';
import { tokenDoCabecalho } from './integracao.regras';
import { IntegracaoService, type IntegracaoAutenticada } from './integracao.service';
import { bearerDoCabecalho, CABECALHO_LIGACAO_NO_NODE, desafioDaRecusa, ligacaoDoCabecalho } from './ligacao.regras';

/** Chamadas por minuto, por token. */
export const LIMITE_POR_MINUTO = 120;
const JANELA_MS = 60_000;

export interface RequestDeIntegracao extends Request {
  integracao?: IntegracaoAutenticada;
}

@Injectable()
export class IntegracaoGuard implements CanActivate {
  constructor(
    private readonly integracoes: IntegracaoService,
    private readonly dmsId: DmsIdService,
    @InjectThrottlerStorage() private readonly limites: ThrottlerStorage,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const http = contexto.switchToHttp();
    const req = http.getRequest<RequestDeIntegracao>();
    const res = http.getResponse<Response>();

    const token = tokenDoCabecalho(req.headers.authorization);
    if (!token && this.dmsId.ligado) {
      req.integracao = await this.pelaViaDoDmsId(req, res);
      return true;
    }
    if (!token) {
      // O cabeçalho que a especificação pede na recusa: diz ao cliente que a porta quer um Bearer.
      res.setHeader('WWW-Authenticate', 'Bearer');
      throw new UnauthorizedException('Informe o token de integração no cabeçalho Authorization.');
    }

    let quem: IntegracaoAutenticada;
    try {
      quem = await this.integracoes.autenticar(token);
    } catch (erro) {
      if (erro instanceof UnauthorizedException) res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      throw erro;
    }

    const uso = await this.contar(quem.tokenId);
    if (uso.bloqueado) {
      res.setHeader('Retry-After', String(uso.retryAfterSeg));
      throw new HttpException(
        `Limite de ${LIMITE_POR_MINUTO} chamadas por minuto atingido para este token. Tente de novo em instantes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    req.integracao = quem;
    return true;
  }

  /**
   * O token do DMS ID primeiro (sem ele, ou com ele torto, nem se procura a
   * ligação), depois a ligação, depois o limite. O desafio de cada recusa sai de
   * `desafioDaRecusa`.
   */
  private async pelaViaDoDmsId(req: Request, res: Response): Promise<IntegracaoAutenticada> {
    const bearer = bearerDoCabecalho(req.headers.authorization);
    try {
      const doToken = await this.dmsId.conferir(bearer);
      const quem = await this.integracoes.autenticarLigacao(ligacaoDoCabecalho(req.headers[CABECALHO_LIGACAO_NO_NODE]), doToken, this.dmsId.aplicativos);
      const uso = await this.contar(quem.tokenId);
      if (uso.bloqueado) {
        throw new ErroProblema(
          'limite-de-chamadas',
          `Limite de ${LIMITE_POR_MINUTO} chamadas por minuto atingido para esta ligação. Tente de novo depois do tempo do Retry-After.`,
          { retryAfterSeg: uso.retryAfterSeg },
        );
      }
      return quem;
    } catch (erro) {
      const desafio = desafioDaRecusa(erro, bearer !== null, this.dmsId.enderecoDosMetadados());
      if (desafio) res.setHeader('WWW-Authenticate', desafio);
      throw erro;
    }
  }

  private async contar(chave: string): Promise<{ bloqueado: boolean; retryAfterSeg: number }> {
    const uso = await this.limites.increment(`integracao:${chave}`, JANELA_MS, LIMITE_POR_MINUTO, JANELA_MS, 'integracao');
    return { bloqueado: uso.isBlocked, retryAfterSeg: Math.max(1, uso.timeToBlockExpire || uso.timeToExpire) };
  }
}
