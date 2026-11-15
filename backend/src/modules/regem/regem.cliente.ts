/**
 * Cliente HTTP da API de integração do Regem (`/api/v1/integracao/…`).
 *
 * Só leitura: a empresa do token, os clientes e as vendas. Nenhum método aqui
 * altera nada no Regem.
 *
 * Autenticação, pela credencial guardada:
 * - o token `rgm_it_…` que a distribuição emite no console do Regem e liga
 *   aqui pelo console do RegemCast: `Authorization: Bearer rgm_it_…`;
 * - a LIGAÇÃO do "Conectar pelo Regem" (`dms_lg_regem_…`, migration 050):
 *   `Authorization: Bearer <token do DMS ID do Regemcast>` + `DMS-Ligacao`.
 *   O Regem vale "o que a empresa autorizou E o que o token do DMS ID tem";
 *   no 401, o próximo token é pedido de novo ao DMS ID, uma vez.
 * O Regem aceita 60 consultas por minuto por acesso e responde os erros em
 * problem+json (RFC 9457): a frase de lá (`detail`) vai para a tela.
 *
 * A única escrita é a da própria autorização (o pedido, a troca do código e
 * revogar a própria ligação): nenhum dado da loja muda no Regem.
 */
import { Injectable, Logger } from '@nestjs/common';

import { env } from '../../config/env';
import { ClienteDmsId } from '../../dms/integracao-dms';
import { LEITURAS_DO_REGEM, ehLigacao, lerConfigDoClique, type ConfigDoClique } from './regem-clique.regras';
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

type ConfigLigada = Extract<ConfigDoClique, { ligado: true }>;

@Injectable()
export class RegemCliente {
  private readonly log = new Logger('RegemCliente');
  private lida: { chave: string; config: ConfigDoClique; dmsId: ClienteDmsId | null } | null = null;

  private get base(): string {
    return env.integracoes.regemUrl.replace(/\/+$/, '');
  }

  /** A configuração do "Conectar pelo Regem", relida só quando o ambiente muda. A torta vai ao log uma vez. */
  get clique(): { config: ConfigDoClique; dmsId: ClienteDmsId | null } {
    const e = process.env;
    const chave = [e.REGEM_CLIQUE, e.REGEM_API_URL, e.REGEM_APP_URL, e.APP_URL, e.DMS_ID_EMISSOR, e.HUB_APLICATIVO, e.HUB_SEGREDO].join('\n');
    if (this.lida?.chave !== chave) {
      const config = lerConfigDoClique(e);
      if (!config.ligado && config.motivo) this.log.error(`"Conectar pelo Regem" desligado: ${config.motivo}`);
      const dmsId = config.ligado
        ? new ClienteDmsId({ emissor: config.emissorDmsId, aplicativo: config.aplicativo, segredo: config.segredo, buscar: (...a) => fetch(...a) })
        : null;
      this.lida = { chave, config, dmsId };
    }
    return this.lida;
  }

  private ligado(): { c: ConfigLigada; dmsId: ClienteDmsId } {
    const { config, dmsId } = this.clique;
    if (!config.ligado || !dmsId) {
      throw new ErroRegem('A conexão pelo Regem não está ligada neste servidor. Fale com o suporte do RegemCast.', null, false);
    }
    return { c: config, dmsId };
  }

  /** O token do DMS ID para o Regem (guardado até perto de vencer pelo `ClienteDmsId`). */
  private async tokenDoDmsId(): Promise<string> {
    const { c, dmsId } = this.ligado();
    try {
      return await dmsId.token(c.recurso, LEITURAS_DO_REGEM);
    } catch (e) {
      this.log.error(`o DMS ID não deu o token para o Regem: ${(e as Error)?.message ?? e}`);
      throw new ErroRegem('O Regemcast ainda não está liberado no DMS ID para ler o Regem. Fale com o suporte do RegemCast.', null, true);
    }
  }

  /** O Regem respondeu 401 a uma ligação: o próximo token é pedido de novo ao DMS ID. */
  private esquecerToken(): void {
    const { config, dmsId } = this.clique;
    if (config.ligado) dmsId?.esquecer(config.recurso, LEITURAS_DO_REGEM);
  }

  private async cabecalhos(credencial: string): Promise<Record<string, string>> {
    if (!ehLigacao(credencial)) return { Accept: 'application/json', Authorization: `Bearer ${credencial}` };
    return { Accept: 'application/json', Authorization: `Bearer ${await this.tokenDoDmsId()}`, 'DMS-Ligacao': credencial };
  }

  private async get<T>(token: string, caminho: string, recurso: Recurso): Promise<T> {
    let r: Response;
    for (let vez = 0; ; vez++) {
      const headers = await this.cabecalhos(token);
      try {
        r = await fetch(this.base + caminho, { headers, signal: AbortSignal.timeout(TEMPO_LIMITE) });
      } catch {
        throw new ErroRegem('O Regem não respondeu. Tentamos de novo em instantes.', null, true);
      }
      // A ligação com o token do DMS ID vencido ou trocado: pede outro e tenta uma vez mais.
      if (r.status === 401 && ehLigacao(token) && vez === 0) {
        this.esquecerToken();
        continue;
      }
      break;
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
        ehLigacao(token)
          ? 'O Regem recusou a conexão: a autorização foi revogada ou trocada no Regem. O dono da conta conecta de novo em Integrações › Regem.'
          : 'O Regem recusou a conexão: o acesso foi revogado ou trocado. Fale com o suporte do RegemCast para ligar de novo.',
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

  /**
   * POST na porta de autorização do Regem (o pedido e a troca do código), com o token do DMS ID. No 401,
   * pede outro token e tenta uma vez mais. Devolve o status e o corpo: quem chama decide (as recusas são
   * para a distribuição, não para a conta).
   */
  async postarNaPorta(caminho: '/integracao/autorizacao/pedido' | '/integracao/autorizacao/token', corpo: Record<string, string>): Promise<{ status: number; corpo: unknown }> {
    this.ligado();
    for (let vez = 0; ; vez++) {
      const token = await this.tokenDoDmsId();
      let r: Response;
      try {
        r = await fetch(this.base + caminho, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(corpo),
          redirect: 'manual',
          signal: AbortSignal.timeout(TEMPO_LIMITE),
        });
      } catch {
        throw new ErroRegem('O Regem não respondeu agora. Tente de novo em instantes.', null, true);
      }
      if (r.status === 401 && vez === 0) {
        this.esquecerToken();
        continue;
      }
      return { status: r.status, corpo: await r.json().catch(() => null) };
    }
  }

  /**
   * Desliga a ligação do clique no Regem (`POST /integracao/autorizacao/revogar`): a chamada seguinte com
   * ela volta 401. Melhor esforço — quem chama não depende disto para desligar aqui; devolve se o Regem
   * confirmou (200, ou 401 de ligação que já não valia).
   */
  async revogarLigacao(ligacao: string): Promise<boolean> {
    if (!ehLigacao(ligacao)) return false;
    try {
      const headers = await this.cabecalhos(ligacao);
      const r = await fetch(`${this.base}/integracao/autorizacao/revogar`, {
        method: 'POST',
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(TEMPO_LIMITE),
      });
      return r.status === 200 || r.status === 401;
    } catch (e) {
      this.log.warn(`revogar a ligação no Regem falhou: ${(e as Error)?.message ?? e}`);
      return false;
    }
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
