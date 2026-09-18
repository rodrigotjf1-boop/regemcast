/**
 * Cliente do Firebase Cloud Messaging (API HTTP v1), sem SDK.
 *
 * O SDK `firebase-admin` traz dezenas de dependências (Firestore, Storage,
 * gRPC) para usar uma chamada só. Aqui são duas requisições: trocar a conta de
 * serviço por um token OAuth (JWT assinado com RS256, validade de 1 hora) e
 * mandar a mensagem. O token é guardado em memória até perto de vencer.
 *
 * Nada aqui lança para quem chama: push é aviso, não parte do fluxo. Uma falha
 * do Firebase não pode derrubar o worker de campanha nem o webhook.
 */
import { createSign } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';

import { env } from '../../config/env';

interface ContaServico {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface MensagemPush {
  titulo: string;
  corpo: string;
  /** Vai para o app decidir que tela abrir. Só strings — regra do FCM. */
  dados?: Record<string, string>;
}

/** O que aconteceu com um token: entregue ao FCM, token morto ou falha passageira. */
export type ResultadoPush = 'enviado' | 'invalido' | 'falhou';

const ESCOPO = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';

/** Lê o JSON da conta de serviço, em texto puro ou base64. Nulo = push desligado. */
export function lerContaServico(bruto: string): ContaServico | null {
  const texto = bruto.trim();
  if (!texto) return null;
  const json = texto.startsWith('{') ? texto : Buffer.from(texto, 'base64').toString('utf8');
  try {
    const c = JSON.parse(json) as Partial<ContaServico>;
    if (!c.project_id || !c.client_email || !c.private_key) return null;
    return c as ContaServico;
  } catch {
    return null;
  }
}

const b64url = (v: string | Buffer) =>
  Buffer.from(v).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

@Injectable()
export class FcmService {
  private readonly log = new Logger('Push');
  private readonly conta = lerContaServico(env.push.contaServico);
  private acesso: { token: string; venceEm: number } | null = null;

  constructor() {
    if (env.push.contaServico && !this.conta) {
      this.log.error('FIREBASE_CONTA_SERVICO está preenchida, mas não é o JSON de uma conta de serviço. Push desligado.');
    }
  }

  get ligado(): boolean {
    return this.conta !== null;
  }

  async enviar(tokenFcm: string, m: MensagemPush): Promise<ResultadoPush> {
    if (!this.conta) return 'falhou';
    let acesso: string;
    try {
      acesso = await this.tokenDeAcesso();
    } catch (erro) {
      this.log.error(`Não consegui autenticar no Firebase: ${String(erro)}`);
      return 'falhou';
    }

    let resposta: Response;
    try {
      resposta = await fetch(
        `https://fcm.googleapis.com/v1/projects/${this.conta.project_id}/messages:send`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${acesso}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: tokenFcm,
              notification: { title: m.titulo, body: m.corpo },
              data: m.dados ?? {},
              android: {
                priority: 'high',
                notification: { channel_id: 'avisos', icon: 'ic_notificacao', color: '#A3E635' },
              },
            },
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch (erro) {
      this.log.warn(`Push não saiu (rede): ${String(erro)}`);
      return 'falhou';
    }

    if (resposta.ok) return 'enviado';

    const corpo = (await resposta.json().catch(() => null)) as {
      error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
    } | null;
    const codigo = corpo?.error?.details?.find((d) => d.errorCode)?.errorCode ?? corpo?.error?.status;

    // Token que não existe mais: app desinstalado, dados apagados, token trocado.
    // INVALID_ARGUMENT só conta quando a Google diz que é o TOKEN: o mesmo
    // código vem para mensagem mal montada, e aí apagar o aparelho seria
    // punir o cliente por um defeito nosso.
    const tokenRuim =
      codigo === 'INVALID_ARGUMENT' && /registration token/i.test(corpo?.error?.message ?? '');
    if (resposta.status === 404 || codigo === 'UNREGISTERED' || tokenRuim) {
      return 'invalido';
    }
    if (resposta.status === 401) this.acesso = null;
    this.log.warn(`Push recusado pelo FCM: ${resposta.status} ${codigo ?? ''}`);
    return 'falhou';
  }

  /** Token OAuth da conta de serviço, reaproveitado até 5 minutos antes de vencer. */
  private async tokenDeAcesso(): Promise<string> {
    if (this.acesso && this.acesso.venceEm - 5 * 60_000 > Date.now()) return this.acesso.token;

    const c = this.conta!;
    const agora = Math.floor(Date.now() / 1000);
    const cabecalho = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const carga = b64url(
      JSON.stringify({
        iss: c.client_email,
        scope: ESCOPO,
        aud: c.token_uri ?? TOKEN_URI,
        iat: agora,
        exp: agora + 3600,
      }),
    );
    const assinatura = b64url(createSign('RSA-SHA256').update(`${cabecalho}.${carga}`).sign(c.private_key));

    const resposta = await fetch(c.token_uri ?? TOKEN_URI, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${cabecalho}.${carga}.${assinatura}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resposta.ok) throw new Error(`OAuth respondeu ${resposta.status}`);
    const r = (await resposta.json()) as { access_token: string; expires_in: number };
    this.acesso = { token: r.access_token, venceEm: Date.now() + r.expires_in * 1000 };
    return r.access_token;
  }
}
