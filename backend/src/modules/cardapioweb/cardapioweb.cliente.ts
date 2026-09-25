/**
 * Cliente HTTP da API aberta do Cardápio Web.
 *
 * Só leitura: a loja, os clientes e os pedidos. Nenhum método aqui altera nada
 * na loja do cliente.
 *
 * Autenticação:
 * - `chave` (legado): `X-API-KEY` gerada pela loja no Portal. Testado em
 *   produção em 19/09/2026: a lista de clientes responde só com ela.
 * - `oauth`: `Authorization: Bearer`, quando o app "Regemcast" estiver
 *   aprovado na CW App Store (escopos `customers`, `orders` e `store`).
 *
 * Limites da API, por loja: `GET /merchant` e `GET /orders/history` 5/min;
 * demais 300 a cada 3 min.
 */
import { Injectable } from '@nestjs/common';

import { env } from '../../config/env';
import type { PaginaPedidos, PedidoDetalhe, PedidoResumo } from './cardapioweb.pedidos.regras';
import type { ClienteCardapioWeb, PaginaClientes } from './cardapioweb.regras';

export interface Credencial {
  modo: 'chave' | 'oauth';
  valor: string;
}

export interface LojaCardapioWeb {
  id: string;
  nome: string;
}

/** Erro da API já com a frase que vai para a tela. */
export class ErroCardapioWeb extends Error {
  constructor(
    mensagem: string,
    readonly status: number | null,
    /** Vale tentar de novo depois de esperar (429, 5xx, rede). */
    readonly passageiro: boolean,
  ) {
    super(mensagem);
  }
}

const TEMPO_LIMITE = 20_000;

@Injectable()
export class CardapiowebCliente {
  private get base(): string {
    return `${env.integracoes.cardapiowebUrl.replace(/\/+$/, '')}/api/partner/v1`;
  }

  /**
   * @param recurso  o que a tela diz quando a conexão não tem acesso (403)
   * @param nulo404  404 devolve `null` (pedido ou cliente que sumiu) em vez de erro
   */
  private async get<T>(
    credencial: Credencial,
    caminho: string,
    opcoes: { recurso?: 'clientes' | 'pedidos'; nulo404?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (credencial.modo === 'chave') headers['X-API-KEY'] = credencial.valor;
    else headers.Authorization = `Bearer ${credencial.valor}`;

    let r: Response;
    try {
      r = await fetch(this.base + caminho, { headers, signal: AbortSignal.timeout(TEMPO_LIMITE) });
    } catch {
      throw new ErroCardapioWeb('O Cardápio Web não respondeu. Tentamos de novo em instantes.', null, true);
    }

    if (r.ok) return (await r.json()) as T;
    if (r.status === 404 && opcoes.nulo404) return null as T;
    if (r.status === 401) {
      throw new ErroCardapioWeb(
        credencial.modo === 'chave'
          ? 'O Cardápio Web recusou a chave da loja. Gere uma nova em Configurações → Integrações → API e conecte de novo.'
          : 'A autorização do Cardápio Web venceu ou foi revogada. Conecte de novo.',
        401,
        false,
      );
    }
    if (r.status === 403) {
      throw new ErroCardapioWeb(
        opcoes.recurso === 'pedidos'
          ? 'O Cardápio Web não liberou os pedidos para esta conexão.'
          : 'O Cardápio Web não liberou a lista de clientes para esta conexão.',
        403,
        false,
      );
    }
    if (r.status === 429) {
      throw new ErroCardapioWeb('Limite de consultas do Cardápio Web atingido. Continuamos em instantes.', 429, true);
    }
    if (r.status >= 500) {
      throw new ErroCardapioWeb(`O Cardápio Web respondeu com erro (${r.status}). Tentamos de novo em instantes.`, r.status, true);
    }
    throw new ErroCardapioWeb(
      `O Cardápio Web recusou a consulta (erro ${r.status}). Fale com o suporte do Regemcast.`,
      r.status,
      false,
    );
  }

  /** Confere a credencial e devolve qual loja ela abre. */
  async loja(credencial: Credencial): Promise<LojaCardapioWeb> {
    const j = await this.get<{ id?: number | string; name?: string }>(credencial, '/merchant');
    if (j?.id == null) throw new ErroCardapioWeb('O Cardápio Web não informou a loja.', null, false);
    return { id: String(j.id), nome: String(j.name ?? '').trim() || 'Loja do Cardápio Web' };
  }

  async clientes(credencial: Credencial, pagina: number): Promise<PaginaClientes> {
    const j = await this.get<PaginaClientes>(credencial, `/merchant/customers?page=${pagina}&per_page=50`);
    return {
      customers: Array.isArray(j?.customers) ? j.customers : [],
      pagination: j?.pagination ?? { current_page: pagina, total_pages: pagina, total_customers: 0 },
    };
  }

  /** Um cliente pelo id — o do pedido que chegou antes da lista. `null` se sumiu. */
  async cliente(credencial: Credencial, id: string): Promise<ClienteCardapioWeb | null> {
    return this.get<ClienteCardapioWeb | null>(credencial, `/merchant/customers/${encodeURIComponent(id)}`, {
      nulo404: true,
    });
  }

  /**
   * Histórico de pedidos fechados e cancelados criados entre `de` e `ate` (até
   * 6 meses), 100 por página. 5 consultas por minuto por loja. Os cancelados
   * vêm para desfazer a compra de pedido cancelado depois de fechado.
   */
  async historicoDePedidos(credencial: Credencial, de: Date, ate: Date, pagina: number): Promise<PaginaPedidos> {
    const q = new URLSearchParams({
      start_date: de.toISOString(),
      end_date: ate.toISOString(),
      page: String(pagina),
      per_page: '100',
    });
    q.append('status[]', 'closed');
    q.append('status[]', 'canceled');
    const j = await this.get<PaginaPedidos>(credencial, `/orders/history?${q}`, { recurso: 'pedidos' });
    return {
      orders: Array.isArray(j?.orders) ? j.orders : [],
      pagination: j?.pagination ?? { current_page: pagina, total_pages: pagina, total_orders: 0 },
    };
  }

  /** O pedido inteiro. `null` se não existe mais. */
  async pedido(credencial: Credencial, id: string): Promise<PedidoDetalhe | null> {
    return this.get<PedidoDetalhe | null>(credencial, `/orders/${encodeURIComponent(id)}`, {
      recurso: 'pedidos',
      nulo404: true,
    });
  }

  /**
   * Pedidos fechados e cancelados alterados desde `desde`. A API aceita até 24 h
   * para trás, mas só devolve os alterados nas ÚLTIMAS 8 H — tudo de uma vez.
   */
  async pedidosAlterados(credencial: Credencial, desde: Date): Promise<PedidoResumo[]> {
    const q = new URLSearchParams({ updated_since: desde.toISOString() });
    q.append('status[]', 'closed');
    q.append('status[]', 'canceled');
    const j = await this.get<PedidoResumo[] | { orders?: PedidoResumo[] }>(credencial, `/orders?${q}`, {
      recurso: 'pedidos',
    });
    // A documentação mostra um array; aceita também o formato com envelope.
    return Array.isArray(j) ? j : Array.isArray(j?.orders) ? j.orders : [];
  }
}
