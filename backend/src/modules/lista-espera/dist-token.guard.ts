/**
 * Portão do console de distribuição.
 *
 * As rotas de leitura e de convite da lista de espera são NOSSAS (Regem), não
 * do cliente: elas enxergam a fila inteira, de todo mundo. Como ainda não
 * existe sessão de distribuição, o portão é um token estático no header
 * `x-dist-token`.
 *
 * Três decisões que vêm de cicatriz:
 *
 * 1. FAIL-CLOSED. `DIST_TOKEN` vazio responde 503, nunca "deixa passar por
 *    omissão". A variável esquecida no deploy é o jeito mais comum de um
 *    console interno virar público.
 *
 * 2. COMPARAÇÃO EM TEMPO CONSTANTE, sobre o sha256 dos dois lados. Comparar
 *    os bytes crus estoura quando os tamanhos diferem (`timingSafeEqual` exige
 *    buffers iguais) — e tratar esse estouro como "token errado" devolve o
 *    tamanho do segredo pelo tempo de resposta. O hash iguala o tamanho.
 *
 * 3. TOKEN CURTO É ERRO DE CONFIGURAÇÃO, não porta destrancada. Um token de
 *    seis letras protegendo dado de todas as contas é o mesmo que nada — então
 *    EM PRODUÇÃO a rota fica 503 até alguém gerar um decente. Em dev, onde o
 *    dado é de mentira, vira aviso no log: travar a máquina de quem acabou de
 *    clonar o repositório só ensina a desligar a verificação.
 *
 * O token nunca aparece em log — nem o recebido, nem o esperado.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

import { env } from '../../config/env';

/** 32 bytes em hex dão 64 caracteres; 24 é o piso para não ser adivinhável. */
export const TAMANHO_MINIMO_DIST_TOKEN = 24;

export const CABECALHO_DIST_TOKEN = 'x-dist-token';

/** Escrito uma vez só: a dica aparece no 503 e no aviso de dev. */
export const COMANDO_GERAR_DIST_TOKEN = 'openssl rand -hex 32';

@Injectable()
export class DistTokenGuard implements CanActivate {
  private readonly log = new Logger('DistToken');
  /** O aviso de token curto sai uma vez, não a cada request. */
  private jaAvisou = false;

  canActivate(contexto: ExecutionContext): boolean {
    // Lido a cada request de propósito: rotacionar o token não deve exigir
    // redeploy, e o teste consegue exercitar a ausência da variável.
    const esperado = (process.env.DIST_TOKEN ?? '').trim();

    if (!esperado) {
      // A mensagem nomeia a variável de propósito: quem recebe este 503 é quem
      // opera o console, e "não configurado" sem dizer O QUÊ manda a pessoa
      // procurar no código. O nome de uma variável de ambiente não é segredo —
      // o valor é, e esse nunca sai daqui.
      throw new ServiceUnavailableException(
        'Console de distribuição não configurado: falta a variável de ambiente ' +
          `DIST_TOKEN no servidor. Gere uma com \`${COMANDO_GERAR_DIST_TOKEN}\` ` +
          `(mínimo de ${TAMANHO_MINIMO_DIST_TOKEN} caracteres), defina no ambiente ` +
          'da API e reinicie. Modelo em backend/.env.example.',
      );
    }
    if (esperado.length < TAMANHO_MINIMO_DIST_TOKEN) {
      const recado =
        `O DIST_TOKEN tem menos de ${TAMANHO_MINIMO_DIST_TOKEN} caracteres e ` +
        `protege dados de todas as contas. Gere outro com \`${COMANDO_GERAR_DIST_TOKEN}\`.`;
      if (env.producao) {
        throw new ServiceUnavailableException(
          `Console de distribuição não configurado: ${recado}`,
        );
      }
      if (!this.jaAvisou) {
        this.jaAvisou = true;
        this.log.warn(`${recado} Em produção esta rota responderia 503.`);
      }
    }

    const req = contexto.switchToHttp().getRequest<Request>();
    const bruto = req.headers[CABECALHO_DIST_TOKEN];
    // Header repetido chega como array: recusamos em vez de escolher um.
    const recebido = typeof bruto === 'string' ? bruto.trim() : '';

    if (!recebido || !this.conferem(recebido, esperado)) {
      throw new UnauthorizedException(
        'Esta rota é do console de distribuição. Envie o cabeçalho x-dist-token válido.',
      );
    }
    return true;
  }

  /** Compara o sha256 dos dois — mesmo tamanho sempre, tempo constante. */
  private conferem(recebido: string, esperado: string): boolean {
    const a = createHash('sha256').update(recebido, 'utf8').digest();
    const b = createHash('sha256').update(esperado, 'utf8').digest();
    return timingSafeEqual(a, b);
  }
}
