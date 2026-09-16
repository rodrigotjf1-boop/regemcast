/**
 * Filtro global de exceções.
 *
 * Três regras que vêm de cicatriz do Regem:
 *
 * 1. O MOTIVO REAL vai para o log, sempre — código, título e detalhe. Lá, todo
 *    `fetch` de envio termina em `.catch(() => null)`, o objeto de erro é
 *    descartado e a mensagem final vira "Falha ao enviar (sem resposta): ",
 *    vazia depois dos dois-pontos. Diagnosticar isso custa horas.
 *
 * 2. Erro nosso é 5xx, erro do cliente é 4xx. No Regem, token ausente na
 *    configuração do servidor vira `BadRequestException` — o cliente lê "sua
 *    requisição está errada" quando o problema é de configuração nossa, e
 *    qualquer camada de retry acima desiste, porque 400 significa "não
 *    retente".
 *
 * 3. O QUE O USUÁRIO LÊ É NOSSO, não da biblioteca. O @nestjs/throttler v6
 *    lança uma exceção cuja mensagem é literalmente
 *    "ThrottlerException: Too Many Requests" — e era isso que aparecia na tela
 *    de login de quem errou a senha nove vezes. O mesmo vale para "Not Found",
 *    "Payload Too Large" e para o "property X should not exist" que o
 *    ValidationPipe gera com `forbidNonWhitelisted`: texto de dev, em inglês,
 *    na cara do cliente. Aqui esses textos viram frase em pt-BR que diz o que
 *    fazer, e o original fica no log.
 *
 *    A troca é conservadora de propósito: só acontece quando a mensagem É uma
 *    das frases que o framework gera sozinho. Mensagem escrita por nós
 *    ("Não encontramos este usuário na sua conta.") passa intacta — senão o
 *    filtro apagaria justamente o texto bom.
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

import { TelemetriaService } from '../modules/telemetria/telemetria.service';

interface CorpoErro {
  mensagem: string;
  codigo?: string;
  referencia?: string;
  detalhes?: unknown;
}

/** O que respondemos quando o texto que sobrou é de biblioteca. */
const FRASE_POR_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Confira os campos enviados e tente de novo.',
  [HttpStatus.UNAUTHORIZED]: 'Faça login para continuar.',
  [HttpStatus.FORBIDDEN]: 'Você não tem permissão para esta ação.',
  [HttpStatus.NOT_FOUND]: 'Não encontramos este endereço. Confira o link e tente de novo.',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'O conteúdo enviado é grande demais. Envie um arquivo menor.',
  [HttpStatus.TOO_MANY_REQUESTS]:
    'Muitas tentativas em pouco tempo. Espere um minuto e tente de novo.',
};

/**
 * Textos que o Nest e o throttler geram sozinhos. Comparação em minúsculas,
 * porque a mesma exceção aparece com capitalização diferente entre versões.
 */
const TEXTO_DE_BIBLIOTECA = new Set([
  'bad request',
  'unauthorized',
  'forbidden',
  'forbidden resource',
  'not found',
  'payload too large',
  'request entity too large',
  'too many requests',
  'throttlerexception: too many requests',
  'internal server error',
  'service unavailable',
]);

/** 404 de rota inexistente: "Cannot POST /api/v1/nada". */
const ROTA_INEXISTENTE = /^cannot (get|post|put|patch|delete|head|options) /i;

/**
 * `forbidNonWhitelisted` responde "property senha2 should not exist" — nome de
 * campo e inglês, útil para quem escreve o cliente e inútil para quem usa a
 * tela. Vai para o log; o usuário lê a frase de baixo.
 */
const RUIDO_DE_WHITELIST = /should not exist/i;
const CAMPO_NAO_PREVISTO =
  'A requisição trouxe campos que este formulário não aceita. Recarregue a página e envie de novo.';

interface Traduzido {
  mensagem: string;
  detalhes?: string[];
  /** Texto original, quando foi trocado. Só para o log. */
  interno?: string;
}

@Catch()
export class ErroFilter implements ExceptionFilter {
  private readonly log = new Logger('Erro');

  /**
   * Opcional porque o filtro é registrado duas vezes: pela injeção (APP_FILTER)
   * e à mão no `main.ts`. As duas instâncias recebem a telemetria — senão o
   * erro seria gravado ou não dependendo de qual delas o tratou.
   */
  constructor(@Optional() private readonly telemetria?: TelemetriaService) {}

  /** Grava o que é defeito NOSSO. 4xx é o cliente errando e não é incidente. */
  private registrar(req: Request, status: number, mensagem: string, referencia?: string) {
    if (!this.telemetria || status < 500) return;
    const usuario = (req as Request & { usuario?: { contaId?: string } }).usuario;
    void this.telemetria.registrar({
      contaId: usuario?.contaId ?? null,
      referencia: referencia ?? null,
      rota: req.url,
      metodo: req.method,
      status,
      origem: 'api',
      mensagem,
    });
  }

  catch(excecao: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (excecao instanceof HttpException) {
      const status = excecao.getStatus();
      const { mensagem, detalhes, interno } = this.traduzir(excecao, status);

      if (status >= 500) {
        this.log.error(
          `${req.method} ${req.url} → ${status}: ${interno ?? mensagem}`,
          excecao.stack,
        );
        this.registrar(req, status, interno ?? mensagem);
      } else if (interno) {
        // 4xx traduzido: o que a biblioteca escreveu fica aqui, não na tela.
        this.log.debug(`${req.method} ${req.url} → ${status}: ${interno}`);
      }

      const corpo: CorpoErro = { mensagem };
      if (detalhes) corpo.detalhes = detalhes;
      res.status(status).json(corpo);
      return;
    }

    // Qualquer coisa que não é HttpException é defeito nosso. A referência
    // permite casar o que o usuário viu com a linha do log, sem expor stack.
    const referencia = randomUUID().slice(0, 8);
    const erro = excecao as Error & { code?: string; detail?: string };
    this.log.error(
      `${req.method} ${req.url} → 500 [ref ${referencia}] ` +
        `${erro?.name ?? 'Erro'}: ${erro?.message ?? String(excecao)}` +
        (erro?.code ? ` (code ${erro.code})` : '') +
        (erro?.detail ? ` — ${erro.detail}` : ''),
      erro?.stack,
    );

    this.registrar(
      req,
      HttpStatus.INTERNAL_SERVER_ERROR,
      `${erro?.name ?? 'Erro'}: ${erro?.message ?? String(excecao)}` + (erro?.code ? ` (code ${erro.code})` : ''),
      referencia,
    );

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      mensagem: 'Algo deu errado do nosso lado. Tente de novo em instantes.',
      referencia,
    } satisfies CorpoErro);
  }

  /** Decide o que o cliente lê e o que fica só no log. */
  private traduzir(excecao: HttpException, status: number): Traduzido {
    const resposta = excecao.getResponse();
    const bruto =
      typeof resposta === 'string'
        ? resposta
        : (resposta as { message?: string | string[] }).message;

    // ValidationPipe: uma mensagem por regra quebrada. As nossas são pt-BR e
    // dizem o que corrigir, então vão inteiras; as de whitelist, não.
    if (Array.isArray(bruto)) {
      const original = bruto.filter((m): m is string => typeof m === 'string');
      const uteis = original.filter((m) => !RUIDO_DE_WHITELIST.test(m));

      if (uteis.length === 0) {
        return {
          mensagem: status === HttpStatus.BAD_REQUEST ? CAMPO_NAO_PREVISTO : this.frase(status),
          interno: original.join(' | ') || undefined,
        };
      }

      return {
        mensagem: uteis[0]!,
        detalhes: uteis,
        // Só loga quando algo foi escondido — senão todo 400 vira linha de log.
        interno: uteis.length === original.length ? undefined : original.join(' | '),
      };
    }

    const texto = typeof bruto === 'string' ? bruto.trim() : '';
    if (!texto || this.ehDeBiblioteca(texto)) {
      return { mensagem: this.frase(status), interno: texto || undefined };
    }
    return { mensagem: texto };
  }

  private ehDeBiblioteca(texto: string): boolean {
    return TEXTO_DE_BIBLIOTECA.has(texto.toLowerCase()) || ROTA_INEXISTENTE.test(texto);
  }

  private frase(status: number): string {
    return (
      FRASE_POR_STATUS[status] ??
      (status >= 500
        ? 'Algo deu errado do nosso lado. Tente de novo em instantes.'
        : 'Não foi possível concluir esta ação. Confira os dados e tente de novo.')
    );
  }
}
