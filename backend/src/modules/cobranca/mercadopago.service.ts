/**
 * Chamadas à API do Mercado Pago. Só HTTP — a regra de negócio mora no
 * CobrancaService.
 *
 * Chamada direta, sem SDK: são cinco endpoints, e o SDK traria dependências e
 * comportamento de retentativa que não controlamos.
 *
 * Toda falha vira uma exceção com frase para o cliente; o corpo de erro do
 * Mercado Pago (que diz o motivo real) vai para o log e para a telemetria — sem
 * token e sem dado do pagador.
 */
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { env } from '../../config/env';
import { TelemetriaService } from '../telemetria/telemetria.service';
import { paraReais } from './mercadopago';

const BASE = 'https://api.mercadopago.com';

export interface AssinaturaMp {
  id: string;
  status: 'pending' | 'authorized' | 'paused' | 'cancelled' | string;
  init_point?: string;
  external_reference?: string;
  payer_email?: string;
  auto_recurring?: { transaction_amount?: number };
  next_payment_date?: string;
}

export interface FaturaMp {
  id: number | string;
  preapproval_id?: string;
  external_reference?: string;
  status?: string;
  transaction_amount?: number;
  debit_date?: string;
  date_created?: string;
  payment_method_id?: string;
  payment?: { id?: number | string; status?: string; status_detail?: string } | null;
}

export class ErroMercadoPago extends ServiceUnavailableException {
  constructor(
    mensagem: string,
    readonly statusHttp: number | null,
  ) {
    super(mensagem);
  }
}

@Injectable()
export class MercadoPagoService {
  private readonly log = new Logger('MercadoPago');

  constructor(private readonly telemetria: TelemetriaService) {}

  configurado(): boolean {
    return Boolean(env.mercadoPago.accessToken);
  }

  /** Assinatura sem plano, pagamento pendente: devolve o link do checkout. */
  criarAssinatura(dados: {
    motivo: string;
    referencia: string;
    emailPagador: string;
    valorCentavos: number;
    urlRetorno: string;
  }): Promise<AssinaturaMp> {
    return this.chamar<AssinaturaMp>('POST', '/preapproval', {
      reason: dados.motivo,
      external_reference: dados.referencia,
      payer_email: dados.emailPagador,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: paraReais(dados.valorCentavos),
        currency_id: 'BRL',
      },
      back_url: dados.urlRetorno,
      status: 'pending',
    });
  }

  lerAssinatura(id: string): Promise<AssinaturaMp> {
    return this.chamar<AssinaturaMp>('GET', `/preapproval/${encodeURIComponent(id)}`);
  }

  alterarValor(id: string, valorCentavos: number): Promise<AssinaturaMp> {
    return this.chamar<AssinaturaMp>('PUT', `/preapproval/${encodeURIComponent(id)}`, {
      auto_recurring: { transaction_amount: paraReais(valorCentavos), currency_id: 'BRL' },
    });
  }

  cancelar(id: string): Promise<AssinaturaMp> {
    return this.chamar<AssinaturaMp>('PUT', `/preapproval/${encodeURIComponent(id)}`, { status: 'cancelled' });
  }

  lerFatura(id: string): Promise<FaturaMp> {
    return this.chamar<FaturaMp>('GET', `/authorized_payments/${encodeURIComponent(id)}`);
  }

  private async chamar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    const token = env.mercadoPago.accessToken;
    if (!token) {
      throw new ErroMercadoPago(
        'A cobrança não está configurada: falta a variável MP_ACCESS_TOKEN no servidor.',
        null,
      );
    }

    // Nova tentativa só para o que pode ser repetido sem efeito duplo: leitura
    // (GET) e alteração de estado (PUT, que grava o mesmo valor de novo). Criar
    // assinatura (POST) NUNCA é repetido — geraria duas.
    const repetivel = metodo === 'GET' || metodo === 'PUT';
    const esperas = repetivel ? [0, 1_000, 3_000] : [0];

    let resposta: Response | null = null;
    let texto = '';
    for (const espera of esperas) {
      if (espera) await new Promise((r) => setTimeout(r, espera));
      try {
        resposta = await fetch(BASE + caminho, {
          method: metodo,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: corpo === undefined ? undefined : JSON.stringify(corpo),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (erro) {
        this.registrar(metodo, caminho, null, `sem resposta: ${(erro as Error)?.message ?? erro}`);
        resposta = null;
        continue;
      }
      texto = await resposta.text().catch(() => '');
      // Limite de frequência (429) e instabilidade (5xx) passam com o tempo;
      // qualquer outra resposta é definitiva.
      if (resposta.status !== 429 && resposta.status < 500) break;
      this.registrar(metodo, caminho, resposta.status, texto.slice(0, 500));
    }

    if (!resposta) {
      throw new ErroMercadoPago('Não conseguimos falar com o Mercado Pago agora. Tente de novo em alguns minutos.', null);
    }

    if (!resposta.ok) {
      if (resposta.status !== 429 && resposta.status < 500) {
        this.registrar(metodo, caminho, resposta.status, texto.slice(0, 500));
      }
      throw new ErroMercadoPago(
        resposta.status === 429
          ? 'O Mercado Pago está limitando pedidos agora. Nada foi alterado — tente de novo em alguns minutos.'
          : resposta.status >= 500
            ? 'O Mercado Pago está instável agora. Nada foi alterado — tente de novo em alguns minutos.'
            : 'O Mercado Pago recusou a operação. Confira os dados e tente de novo — se continuar, fale com o suporte.',
        resposta.status,
      );
    }

    try {
      return JSON.parse(texto) as T;
    } catch {
      this.registrar(metodo, caminho, resposta.status, 'resposta que não é JSON');
      throw new ErroMercadoPago('O Mercado Pago respondeu de um jeito inesperado. Tente de novo.', resposta.status);
    }
  }

  private registrar(metodo: string, caminho: string, status: number | null, motivo: string): void {
    // O caminho tem só ids do Mercado Pago; e-mail do pagador nunca vai para cá.
    // "/preapproval/abc123" vira "/preapproval/:id"; "/preapproval" fica como
    // está — antes a rota de criação aparecia no log como "/:id".
    const rota = caminho.replace(/^(\/[^/]+)\/[^/]+$/, '$1/:id');
    this.log.error(`Mercado Pago ${metodo} ${rota} → ${status ?? 'sem resposta'}: ${motivo}`);
    void this.telemetria.registrar({
      origem: 'api',
      classe: 'mercadopago',
      status,
      metodo,
      rota,
      mensagem: motivo,
    });
  }
}
