/**
 * O que é uma ferramenta do MCP do RegemCast, e o que ela recebe.
 *
 * Fica num arquivo só seu para os catálogos (`mcp.leitura.ts` e os próximos) e
 * o servidor (`mcp.servidor.ts`) dependerem dele, e não um do outro.
 */
import type { McpServer } from '@modelcontextprotocol/server';

import type { ContextoDb } from '../../db/contexto';
import type { CampanhaService } from '../campanha/campanha.service';
import type { ContaService } from '../conta/conta.service';
import type { ContatoService } from '../contato/contato.service';
import type { PublicosService } from '../contato/publicos.service';
import type { SegmentacaoService } from '../contato/segmentacao.service';
import type { MetaService } from '../meta/meta.service';
import type { SaudeService } from '../meta/saude.service';
import type { OrcamentoService } from '../orcamento/orcamento.service';
import type { IntegracaoAutenticada } from './integracao.service';

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
