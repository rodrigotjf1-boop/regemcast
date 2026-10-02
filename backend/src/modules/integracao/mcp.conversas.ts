/**
 * A ferramenta das conversas abertas por anúncio.
 *
 * É a única do MCP que devolve o TELEFONE de uma pessoa — e só ele: nenhum
 * nome, nenhum conteúdo de mensagem. Por isso fica num arquivo à parte das
 * leituras de contagem (`mcp.leitura.ts`), com a própria permissão
 * (`conversas.anuncio.ler`).
 *
 * O formato da resposta é o do contrato que o Liame espera
 * (`docs/integracoes/regemcast.md`, no repositório dele): nomes em snake_case,
 * cursor opaco, `tem_mais`. As regras ficam em `meta/anuncio.regras.ts`.
 */
import * as z from 'zod/v4';

import { GUARDA_DIAS, LIMITE_MAXIMO, LIMITE_PADRAO } from '../meta/anuncio.regras';
import { LEITURA, naConta, type Ferramenta } from './mcp.ferramenta';

const conversasAnuncioListar: Ferramenta = {
  nome: 'conversas_anuncio_listar',
  escopo: 'conversas.anuncio.ler',
  registrar(servidor, c) {
    servidor.registerTool(
      'conversas_anuncio_listar',
      {
        title: 'Conversas abertas por anúncio',
        description: `As conversas que começaram por um anúncio de clique para o WhatsApp: o id do anúncio, o identificador do clique (ctwa_clid, que a Meta omite em anúncio no Status), o momento, o número da loja e o telefone de quem escreveu. Sem nome e sem conteúdo de mensagem. Leitura com cursor: guarde o proximo_cursor e volte com ele para receber só o que entrou depois. Só existe o que chegou enquanto a conta tinha um aplicativo com esta permissão, e por até ${GUARDA_DIAS} dias.`,
        inputSchema: z.object({
          cursor: z.string().max(400).optional().describe('O proximo_cursor da leitura anterior. Sem ele, a leitura começa do início.'),
          limite: z.number().int().min(1).max(LIMITE_MAXIMO).optional().describe(`Quantas devolver. Padrão: ${LIMITE_PADRAO}.`),
          desde: z.string().max(40).optional().describe('Só as conversas abertas a partir deste instante (ISO 8601 com fuso, como 2026-07-01T00:00:00Z). Para a carga inicial.'),
        }),
        outputSchema: z.object({
          itens: z.array(
            z.object({
              id: z.string(),
              versao: z.number(),
              atualizado_em: z.string(),
              numero_loja: z.string().nullable(),
              telefone: z.string(),
              aberta_em: z.string(),
              anuncio_id: z.string(),
              tipo_origem: z.string(),
              ctwa_clid: z.string().nullable(),
              url_origem: z.string().nullable(),
            }),
          ),
          proximo_cursor: z.string().nullable(),
          tem_mais: z.boolean(),
        }),
        annotations: LEITURA,
      },
      async ({ cursor, limite, desde }) =>
        naConta(c, 'conversas_anuncio_listar', async () => ({
          ...(await c.servicos.anuncios.listar(c.quem.contaId, { cursor, limite, desde })),
        })),
    );
  },
};

export const FERRAMENTAS_DE_CONVERSAS: readonly Ferramenta[] = [conversasAnuncioListar];
