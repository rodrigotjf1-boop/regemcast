/**
 * As ferramentas do AVISO ASSINADO a quem pediu (Hub DMS, F5 parte B, PR 3; decisão F5-7): registrar, ler e remover o
 * endereço e o segredo para onde o Regemcast avisa o produto que pediu um disparo.
 *
 * O aviso é só gatilho (Padrão DMS §9): um POST assinado no padrão Standard Webhooks, com o corpo
 * `{"tipo":"acao.alterada","id":"<id do pedido>"}`, a cada mudança do pedido; quem recebe lê o pedido por
 * `acao_pedido_ler`. O endereço só vale dentro da base do produto, fixa no Regemcast (a base mais UM trecho, o id da
 * conexão do lado dele). Só produto da DMS. Detalhe em `docs/aprovacao-de-disparos.md`.
 */
import * as z from 'zod/v4';

import { LIMITE_DO_ENDERECO } from '../aviso-assinado/aviso-assinado.regras';
import type { QuemRegistra } from '../aviso-assinado/aviso-assinado.service';
import { chamadaAtual } from '../hub/chamada-atual';
import { LEITURA, naConta, type ContextoDaFerramenta, type Ferramenta } from './mcp.ferramenta';

const esquemaDaSituacao = z.object({
  registrado: z.boolean(),
  url: z.string().optional(),
  registrado_em: z.string().optional(),
  pausado: z.boolean().optional(),
  pausa_motivo: z.string().optional(),
  ultimo_envio_em: z.string().optional(),
  ultimo_status: z.number().optional(),
  na_fila: z.number().optional(),
  tipos: z.array(z.string()),
});

function quemRegistra(c: ContextoDaFerramenta): QuemRegistra {
  return { contaId: c.quem.contaId, produto: c.quem.produto, classe: c.quem.classe, prefixo: chamadaAtual()?.ligacaoPrefixo ?? null };
}

const avisoRegistrar: Ferramenta = {
  nome: 'aviso_registrar',
  escopo: null,
  registrar(servidor, c) {
    servidor.registerTool(
      'aviso_registrar',
      {
        title: 'Registrar o endereço de aviso',
        description:
          'Registra (ou troca) para onde o Regemcast avisa este aplicativo, e com que segredo, nesta conta. O aviso é um POST assinado no padrão Standard Webhooks (webhook-id, webhook-timestamp, webhook-signature) com o corpo {"tipo":"acao.alterada","id":"<id do pedido>"} a cada mudança de um pedido de ação deste aplicativo (aprovado, recusado, vencido, cancelado, executado, parou no teto): é só gatilho, leia o pedido por acao_pedido_ler. O endereço tem de ser a base do aplicativo cadastrada no Regemcast mais UM trecho (o id da conexão do seu lado), em https. O segredo vai no formato whsec_ (24 a 64 bytes em base64) e nunca volta. Registrar de novo religa o aviso pausado. Só produto da DMS. O aviso só sai enquanto a credencial do aplicativo na conta tiver a permissão campanhas.disparar.',
        inputSchema: z.object({
          url: z.string().min(12).max(LIMITE_DO_ENDERECO).describe('A base do aplicativo mais UM trecho (o id da conexão do seu lado), em https.'),
          segredo: z.string().min(30).max(200).describe('whsec_ seguido de 24 a 64 bytes em base64. Guarde do seu lado: ele não volta.'),
        }),
        outputSchema: esquemaDaSituacao,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ url, segredo }) => naConta(c, 'aviso_registrar', () => c.servicos.avisoAssinado.registrar(quemRegistra(c), { url, segredo })),
    );
  },
};

const avisoLer: Ferramenta = {
  nome: 'aviso_ler',
  escopo: null,
  registrar(servidor, c) {
    servidor.registerTool(
      'aviso_ler',
      {
        title: 'Ler o endereço de aviso',
        description:
          'O aviso deste aplicativo nesta conta: o endereço, quando foi registrado, se está pausado (e por quê), o último envio, o status que o destino respondeu e quantos esperam na fila. Nunca o segredo. Sem registro: registrado = false.',
        inputSchema: z.object({}),
        outputSchema: esquemaDaSituacao,
        annotations: LEITURA,
      },
      async () => naConta(c, 'aviso_ler', () => c.servicos.avisoAssinado.ler(quemRegistra(c))),
    );
  },
};

const avisoRemover: Ferramenta = {
  nome: 'aviso_remover',
  escopo: null,
  registrar(servidor, c) {
    servidor.registerTool(
      'aviso_remover',
      {
        title: 'Parar os avisos',
        description:
          'Apaga o endereço e o segredo do aviso deste aplicativo nesta conta: o que estava na fila não sai mais. Sem registro, responde removido = false. Os pedidos seguem legíveis por acao_pedido_ler.',
        inputSchema: z.object({}),
        outputSchema: z.object({ removido: z.boolean() }),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      },
      async () => naConta(c, 'aviso_remover', () => c.servicos.avisoAssinado.remover(quemRegistra(c))),
    );
  },
};

export const FERRAMENTAS_DE_AVISO: readonly Ferramenta[] = [avisoRegistrar, avisoLer, avisoRemover];
