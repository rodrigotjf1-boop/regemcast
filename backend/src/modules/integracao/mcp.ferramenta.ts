/**
 * O que é uma ferramenta do MCP do RegemCast, e o que ela recebe.
 *
 * Fica num arquivo só seu para os catálogos (`mcp.leitura.ts` e os próximos) e
 * o servidor (`mcp.servidor.ts`) dependerem dele, e não um do outro.
 */
import { HttpException, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/server';

import type { ContextoDb } from '../../db/contexto';
import { comAutorDaIntegracao } from '../auditoria/autor-integracao';
import type { AvisoService } from '../aviso/aviso.service';
import type { CampanhaService } from '../campanha/campanha.service';
import type { ContaService } from '../conta/conta.service';
import type { ContatoService } from '../contato/contato.service';
import type { PublicosService } from '../contato/publicos.service';
import type { SegmentacaoService } from '../contato/segmentacao.service';
import type { ConversaAnuncioService } from '../meta/anuncio.service';
import type { MetaService } from '../meta/meta.service';
import type { ModeloService } from '../modelo/modelo.service';
import type { SaudeService } from '../meta/saude.service';
import type { OrcamentoService } from '../orcamento/orcamento.service';
import type { IntegracaoAutenticada, IntegracaoService } from './integracao.service';

/** Os serviços das telas, que as ferramentas reaproveitam. */
export interface ServicosDoMcp {
  saude: SaudeService;
  conta: ContaService;
  campanhas: CampanhaService;
  contatos: ContatoService;
  publicos: PublicosService;
  segmentos: SegmentacaoService;
  meta: MetaService;
  orcamento: OrcamentoService;
  anuncios: ConversaAnuncioService;
  modelos: ModeloService;
  avisos: AvisoService;
  integracoes: IntegracaoService;
}

/** O que cada ferramenta recebe: quem chamou, a porta para a conta dele e os serviços. */
export interface ContextoDaFerramenta {
  quem: IntegracaoAutenticada;
  ctx: ContextoDb;
  servicos: ServicosDoMcp;
}

/** Uma ferramenta: o escopo que exige e como se registra no servidor do pedido. */
export interface Ferramenta {
  nome: string;
  /** Nulo = qualquer token válido pode usar. */
  escopo: string | null;
  registrar(servidor: McpServer, c: ContextoDaFerramenta): void;
}

/** Resposta de ferramenta com o texto e o objeto (para quem lê `structuredContent`). */
export function resposta<T extends Record<string, unknown>>(dados: T) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(dados) }], structuredContent: dados };
}

/** Resposta de erro: a frase vai para quem chamou, sem derrubar o protocolo. */
export function erroDaFerramenta(mensagem: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text: mensagem }] };
}

const log = new Logger('McpFerramenta');

/** As marcas de uma ferramenta que só lê, e só da conta do token. */
export const LEITURA = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

/**
 * Roda a ferramenta dentro da conta do token, com a integração como autora de
 * tudo que for auditado no caminho. Recusa de regra (400, 404…) vira resposta
 * de erro com a frase do serviço; o resto é registrado e sai como "erro
 * interno", sem detalhe.
 */
export async function naConta<T extends Record<string, unknown>>(c: ContextoDaFerramenta, nome: string, fn: () => Promise<T>) {
  try {
    const autor = { tokenId: c.quem.tokenId, produto: c.quem.produto, nome: c.quem.nome, classe: c.quem.classe };
    return resposta(await comAutorDaIntegracao(autor, () => c.ctx.comConta(c.quem.contaId, fn)));
  } catch (e) {
    if (e instanceof HttpException && e.getStatus() < 500) {
      const corpo = e.getResponse();
      const mensagem = typeof corpo === 'string' ? corpo : ((corpo as { message?: unknown }).message ?? e.message);
      return erroDaFerramenta(Array.isArray(mensagem) ? mensagem.join(' ') : String(mensagem));
    }
    log.error(`${nome} falhou para o token ${c.quem.tokenId}: ${(e as Error)?.message ?? String(e)}`, (e as Error)?.stack);
    return erroDaFerramenta('Erro interno. Tente de novo em instantes.');
  }
}
