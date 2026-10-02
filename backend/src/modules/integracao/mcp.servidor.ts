/**
 * O servidor MCP do RegemCast: as ferramentas que outro produto da DMS usa.
 *
 * Sem estado (especificação 2026-07-28, SDK oficial v2): cada pedido HTTP
 * monta um servidor novo com a lista de ferramentas de QUEM pediu — a que o
 * escopo do token libera e, nas de disparo, só para a classe `dms`. Ferramenta
 * que o token não pode usar nem aparece em `tools/list`; chamada direta a ela
 * responde "não encontrada". Clientes da geração 2025 (com `initialize`) são
 * atendidos pelo mesmo servidor, também sem estado.
 *
 * Regras de toda ferramenta (Liame, ADR-008):
 * - nome em snake_case, até 64 caracteres, sem ponto;
 * - curada: uma tarefa, não um espelho do banco;
 * - roda DENTRO da conta do token (`comConta`): a RLS vale como numa tela;
 * - não devolve telefone nem conteúdo de conversa, salvo a ferramenta cujo
 *   escopo diz isso por extenso.
 */
import { Injectable, Logger } from '@nestjs/common';
import { createMcpHandler, McpServer, type AuthInfo, type McpHttpHandler } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { ContextoDb } from '../../db/contexto';
import { LIMITE_POR_MINUTO } from './integracao.guard';
import { descreverEscopos } from './integracao.regras';
import type { IntegracaoAutenticada } from './integracao.service';

/** O que cada ferramenta recebe: quem chamou e a porta para a conta dele. */
export interface ContextoDaFerramenta {
  quem: IntegracaoAutenticada;
  ctx: ContextoDb;
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

/**
 * Quem sou eu: a primeira chamada de quem integra. Confere a porta, a conta e
 * as permissões sem ler nada da conta além do nome.
 */
const situacaoDaIntegracao: Ferramenta = {
  nome: 'integracao_situacao',
  escopo: null,
  registrar(servidor, { quem }) {
    servidor.registerTool(
      'integracao_situacao',
      {
        title: 'Situação da integração',
        description:
          'Diz para qual conta do RegemCast este token vale, qual produto ele identifica e o que pode fazer. Use para conferir a conexão antes de qualquer outra ferramenta.',
        inputSchema: z.object({}),
        outputSchema: z.object({
          conta: z.string(),
          produto: z.string(),
          classe: z.enum(['dms', 'externo']),
          token: z.string(),
          permissoes: z.array(z.object({ id: z.string(), rotulo: z.string(), descricao: z.string() })),
          limitePorMinuto: z.number(),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      },
      async () =>
        resposta({
          conta: quem.contaNome,
          produto: quem.produto,
          classe: quem.classe,
          token: quem.nome,
          permissoes: descreverEscopos(quem.escopos),
          limitePorMinuto: LIMITE_POR_MINUTO,
        }),
    );
  },
};

/** O catálogo de ferramentas. Ferramenta nova entra aqui, com o escopo dela no catálogo de escopos. */
export const FERRAMENTAS: readonly Ferramenta[] = [situacaoDaIntegracao];

/** As ferramentas que um token pode ver e usar. */
export function ferramentasDe(quem: Pick<IntegracaoAutenticada, 'escopos'>): Ferramenta[] {
  return FERRAMENTAS.filter((f) => f.escopo === null || quem.escopos.includes(f.escopo));
}

@Injectable()
export class McpServidor {
  private readonly log = new Logger('Mcp');
  readonly handler: McpHttpHandler;

  constructor(private readonly ctx: ContextoDb) {
    this.handler = createMcpHandler(
      ({ authInfo }) => {
        const servidor = new McpServer(
          { name: 'regemcast', version: '1.0.0' },
          {
            instructions:
              'Ferramentas do RegemCast, a plataforma de disparo de campanhas pelo WhatsApp da DMS. Cada token vale para UMA conta. Comece por integracao_situacao.',
          },
        );
        const quem = (authInfo?.extra as { integracao?: IntegracaoAutenticada } | undefined)?.integracao;
        // Sem quem (não deveria acontecer: o portão vem antes), servidor vazio.
        if (quem) for (const f of ferramentasDe(quem)) f.registrar(servidor, { quem, ctx: this.ctx });
        return servidor;
      },
      // Resposta no modo padrão do SDK: um corpo JSON, já que as ferramentas não mandam progresso.
      { onerror: (erro) => this.log.warn(`Pedido MCP recusado: ${erro.message}`) },
    );
  }

  /** O que a porta entrega ao SDK: quem é, sem o token em claro. */
  static autorizacao(quem: IntegracaoAutenticada): AuthInfo {
    return { token: 'oculto', clientId: quem.produto, scopes: quem.escopos, extra: { integracao: quem } };
  }
}
