/**
 * Envio de e-mail, pelo Resend.
 *
 * Um lugar só para mandar e-mail, pelo mesmo motivo de sempre: código de
 * verificação e convite precisam sair do mesmo jeito, com o mesmo remetente e o
 * mesmo tratamento de falha.
 *
 * ## Nunca finge que mandou
 *
 * - Sem `RESEND_API_KEY` em produção, recusa com 503 dizendo qual variável
 *   falta. Responder "enviamos o código" sem ter enviado deixa a pessoa
 *   esperando um e-mail que não existe.
 * - Fora de produção, sem a chave, o e-mail vai para o LOG. É o que permite
 *   testar convite e duas etapas na máquina sem conta no Resend.
 * - Se o Resend recusar, o motivo dele vai para o log e para a telemetria — sem
 *   o destinatário inteiro e sem o conteúdo (que pode ter o código).
 *
 * Chamada direta à API HTTP, sem SDK: é um POST. Uma dependência a mais para
 * isso seria superfície a mais para auditar.
 */
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { env } from '../../config/env';
import { TelemetriaService } from '../telemetria/telemetria.service';

export interface EmailParaEnviar {
  para: string;
  assunto: string;
  html: string;
  texto: string;
}

const ENDERECO_RESEND = 'https://api.resend.com/emails';

/** `maria@empresa.com` vira `ma***@empresa.com` — o log não precisa do resto. */
export function mascararEmail(email: string): string {
  const corte = email.indexOf('@');
  if (corte <= 0) return '***';
  return `${email.slice(0, Math.min(2, corte))}***${email.slice(corte)}`;
}

@Injectable()
export class EmailService {
  private readonly log = new Logger('Email');

  constructor(private readonly telemetria: TelemetriaService) {}

  async enviar(email: EmailParaEnviar): Promise<void> {
    const chave = env.email.resendChave;

    if (!chave) {
      if (env.producao) {
        throw new ServiceUnavailableException(
          'O envio de e-mail não está configurado: falta a variável RESEND_API_KEY no servidor.',
        );
      }
      // Só fora de produção: o texto pode ter o código, e aqui ele é o que
      // permite testar o fluxo sem provedor.
      this.log.warn(
        `[e-mail NÃO enviado — sem RESEND_API_KEY] para ${email.para} · ${email.assunto}\n${email.texto}`,
      );
      return;
    }

    let resposta: Response;
    try {
      resposta = await fetch(ENDERECO_RESEND, {
        method: 'POST',
        headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: env.email.remetente,
          to: [email.para],
          subject: email.assunto,
          html: email.html,
          text: email.texto,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (erro) {
      this.falhou(email, `sem resposta do Resend: ${(erro as Error)?.message ?? erro}`, null);
    }

    if (!resposta.ok) {
      // O corpo de erro do Resend diz o motivo (domínio não verificado, chave
      // inválida…). Não tem dado do destinatário nem do conteúdo.
      const corpo = await resposta.text().catch(() => '');
      this.falhou(email, `Resend respondeu ${resposta.status}: ${corpo.slice(0, 300)}`, resposta.status);
    }
  }

  private falhou(email: EmailParaEnviar, motivo: string, status: number | null): never {
    this.log.error(`Não consegui enviar "${email.assunto}" para ${mascararEmail(email.para)} — ${motivo}`);
    void this.telemetria.registrar({
      origem: 'api',
      classe: 'email',
      status: status ?? undefined,
      mensagem: motivo,
      detalhe: { assunto: email.assunto },
    });
    throw new ServiceUnavailableException(
      'Não conseguimos enviar o e-mail agora. Tente de novo em alguns minutos.',
    );
  }
}
