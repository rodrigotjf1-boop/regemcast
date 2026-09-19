/**
 * Cliente HTTP da API aberta do Cardápio Web.
 *
 * Só leitura: consulta da loja e lista de clientes. Nenhum método aqui altera
 * nada na loja do cliente.
 *
 * Autenticação:
 * - `chave` (legado): `X-API-KEY` gerada pela loja no Portal. Testado em
 *   produção em 19/09/2026: a lista de clientes responde só com ela.
 * - `oauth`: `Authorization: Bearer`, quando o app "Regemcast" estiver
 *   aprovado na CW App Store (escopos `customers` e `store`).
 *
 * Limites da API, por loja: `GET /merchant` 5/min; demais 300 a cada 3 min.
 */
import { Injectable } from '@nestjs/common';

import { env } from '../../config/env';
import type { PaginaClientes } from './cardapioweb.regras';

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

  private async get<T>(credencial: Credencial, caminho: string): Promise<T> {
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
        'O Cardápio Web não liberou a lista de clientes para esta conexão.',
        403,
        false,
      );
    }
    if (r.status === 429) {
      throw new ErroCardapioWeb('Limite de consultas do Cardápio Web atingido. Continuamos em instantes.', 429, true);
    }
    throw new ErroCardapioWeb(
      `O Cardápio Web respondeu com erro (${r.status}). Tentamos de novo em instantes.`,
      r.status,
      r.status >= 500,
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
}
