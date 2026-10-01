/**
 * Cliente HTTP da API de integração do Regem (`/api/v1/integracao/…`).
 *
 * Só leitura: a empresa do token, os clientes e as vendas. Nenhum método aqui
 * altera nada no Regem.
 *
 * Autenticação: `Authorization: Bearer rgm_it_…` — o token que a distribuição
 * emite no console do Regem e liga aqui pelo console do RegemCast (a loja não
 * copia nada). O Regem aceita 60 consultas por minuto por token e responde os
 * erros em problem+json (RFC 9457): a frase de lá (`detail`) vai para a tela.
 */
import { Injectable } from '@nestjs/common';

import { env } from '../../config/env';
import {
  LIMITE_POR_PAGINA,
  lojaDaResposta,
  type ClienteRegem,
  type LojaDoRegem,
  type PaginaRegem,
  type VendaRegem,
} from './regem.regras';

/** Erro da API já com a frase que vai para a tela. */
export class ErroRegem extends Error {
  constructor(
    mensagem: string,
    readonly status: number | null,
    /** Vale tentar de novo depois de esperar (429, 5xx, rede). */
    readonly passageiro: boolean,
    /** Quanto o Regem pediu para esperar (Retry-After), em segundos. */
    readonly esperarSeg: number | null = null,
  ) {
    super(mensagem);
  }
}

const TEMPO_LIMITE = 20_000;

type Recurso = 'loja' | 'clientes' | 'pedidos';

@Injectable()
export class RegemCliente {
  private get base(): string {
    return env.integracoes.regemUrl.replace(/\/+$/, '');
  }

  private async get<T>(token: string, caminho: string, recurso: Recurso): Promise<T> {
    let r: Response;
    try {
      r = await fetch(this.base + caminho, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TEMPO_LIMITE),
      });
    } catch {
      throw new ErroRegem('O Regem não respondeu. Tentamos de novo em instantes.', null, true);
    }

    if (r.ok) return (await r.json()) as T;

    // A frase do Regem (problem+json), quando vier — curta e sem HTML.
    let detalhe = '';
    try {
      const corpo = (await r.json()) as { detail?: unknown; title?: unknown };
      detalhe = String(corpo?.detail ?? corpo?.title ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
    } catch {
      detalhe = '';
    }

    if (r.status === 401) {
      throw new ErroRegem(
        'O Regem recusou a conexão: o acesso foi revogado ou trocado. Fale com o suporte do RegemCast para ligar de novo.',
        401,
        false,
      );
    }
    if (r.status === 403) {
      const oQue = recurso === 'clientes' ? 'os clientes' : recurso === 'pedidos' ? 'as vendas' : 'a empresa';
      throw new ErroRegem(`O Regem não liberou ${oQue} para esta conexão.${detalhe ? ` (${detalhe})` : ''}`, 403, false);
    }
    if (r.status === 429) {
      const espera = Number(r.headers.get('retry-after'));
      throw new ErroRegem(
        'Limite de consultas do Regem atingido. Continuamos em instantes.',
        429,
        true,
        Number.isFinite(espera) && espera > 0 ? Math.min(espera, 600) : 60,
      );
    }
    if (r.status >= 500) {
      throw new ErroRegem(`O Regem respondeu com erro (${r.status}). Tentamos de novo em instantes.`, r.status, true);
    }
    throw new ErroRegem(
      `O Regem recusou a consulta (erro ${r.status})${detalhe ? `: ${detalhe}` : ''}. Fale com o suporte do RegemCast.`,
      r.status,
      false,
    );
  }

  /** Confere o token e devolve a empresa, as lojas e os escopos que ele abre. */
  async loja(token: string): Promise<LojaDoRegem> {
    return lojaDaResposta(await this.get<Record<string, unknown>>(token, '/integracao/loja', 'loja'));
  }

  async clientes(token: string, cursor: string | null): Promise<PaginaRegem<ClienteRegem>> {
    return this.pagina<ClienteRegem>(token, '/integracao/clientes', cursor, 'clientes');
  }

  async pedidos(token: string, cursor: string | null): Promise<PaginaRegem<VendaRegem>> {
    return this.pagina<VendaRegem>(token, '/integracao/pedidos', cursor, 'pedidos');
  }

  private async pagina<T>(token: string, caminho: string, cursor: string | null, recurso: Recurso): Promise<PaginaRegem<T>> {
    const q = new URLSearchParams({ limite: String(LIMITE_POR_PAGINA) });
    if (cursor) q.set('cursor', cursor);
    const j = await this.get<Partial<PaginaRegem<T>>>(token, `${caminho}?${q}`, recurso);
    const itens = Array.isArray(j?.itens) ? j.itens : [];
    return {
      itens,
      // O cursor volta sempre (é de onde a próxima leitura continua); sem ele,
      // fica o que já estava — nunca voltamos para o começo por engano.
      proximo_cursor: typeof j?.proximo_cursor === 'string' && j.proximo_cursor ? j.proximo_cursor : cursor,
      tem_mais: j?.tem_mais === true && itens.length > 0,
    };
  }
}
