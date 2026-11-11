/**
 * As ferramentas do PEDIDO DE APROVAÇÃO do disparo (Hub DMS, F5 parte B):
 * pedir, ler e cancelar.
 *
 * O disparo pedido por outro produto da DMS espera uma pessoa da conta: o dono
 * (ou quem ele autorizou) aprova na tela do Regemcast, com o código do
 * aplicativo autenticador, e fixa o teto de gasto. O pedido fica preso ao plano
 * (o texto, as variáveis, quem recebe, o custo e o cupom), vence em 24 horas e
 * executa uma vez. Quem pediu acompanha por `acao_pedido_ler` (e, depois, pelo
 * aviso assinado). Só para produto da DMS (`campanhas.disparar`) e só na
 * campanha que o mesmo aplicativo montou. Detalhe em
 * `docs/aprovacao-de-disparos.md`.
 */
import { ForbiddenException } from '@nestjs/common';
import * as z from 'zod/v4';

import { ErroProblema, pedidoPublico, type PedidoDeAcao } from '../../dms/integracao-dms';
import { CUPOM_INVALIDO, cupomDoPedido, LIMITE_CUPOM_CODIGO, LIMITE_CUPOM_DESCRICAO, type PlanoDoDisparo } from '../aprovacao/aprovacao.regras';
import type { QuemPedePelaPorta } from '../aprovacao/aprovacao.service';
import { ErroDoPedido } from '../aprovacao/erro-do-pedido';
import { chamadaAtual } from '../hub/chamada-atual';
import { SO_DMS } from './disparo.regras';
import { FORMATO_DA_CHAVE } from './idempotencia.regras';
import { conferirPlanoDoDisparo } from './mcp.disparo';
import { LEITURA, naConta, type ContextoDaFerramenta, type Ferramenta } from './mcp.ferramenta';

type PedidoNovo = { quem: QuemPedePelaPorta; pedido: PedidoDeAcao; plano: PlanoDoDisparo | null };

const esquemaDoPedido = z.object({
  id: z.string(),
  acao: z.string(),
  risco: z.enum(['R2', 'R3']),
  situacao: z.enum(['aguardando', 'aprovado', 'executando', 'executado', 'recusado', 'vencido', 'cancelado', 'falhou']),
  resumo_do_plano: z.string(),
  criado_em: z.string(),
  vence_em: z.string(),
  decidido_em: z.string().optional(),
  teto_de_gasto_centavos: z.number().optional(),
  motivo: z.string().optional(),
  motivo_da_recusa: z.string().optional(),
  tela: z.string().optional(),
});

function quemPede(c: ContextoDaFerramenta): QuemPedePelaPorta {
  if (c.quem.classe !== 'dms') throw new ForbiddenException(SO_DMS);
  return {
    contaId: c.quem.contaId,
    contaNome: c.quem.contaNome,
    produto: c.quem.produto,
    classe: c.quem.classe,
    tokenId: c.quem.tokenId,
    ligacaoPrefixo: chamadaAtual()?.ligacaoPrefixo ?? null,
  };
}

function paraFora(c: ContextoDaFerramenta, p: PedidoDeAcao) {
  return pedidoPublico(p, c.servicos.aprovacoes.agora(), c.servicos.aprovacoes.enderecoDaTela(p.id));
}

const PROXIMO_PASSO: Record<string, string> = {
  aguardando:
    'O pedido espera uma pessoa da conta aprovar no Regemcast, com o segundo fator (até vence_em). Mostre a situação e o link da tela; acompanhe com acao_pedido_ler.',
  aprovado: 'Aprovado: o disparo está saindo (ou sai assim que puder, até vence_em). Acompanhe com acao_pedido_ler e campanha_detalhar.',
  executando: 'O disparo está começando. Acompanhe com acao_pedido_ler e campanha_detalhar.',
  executado: 'Disparado: a campanha está na fila de envio, dentro do teto de gasto aprovado. Acompanhe com campanha_detalhar.',
  recusado: 'Recusado por quem aprova (o motivo está em motivo_da_recusa). Nada saiu. Para tentar de novo, faça um pedido novo.',
  vencido: 'Venceu sem resposta. Nada saiu. Para tentar de novo, faça um pedido novo.',
  cancelado: 'Encerrado sem disparar (o motivo, quando há, está em motivo). Para tentar de novo, faça um pedido novo.',
  falhou: 'O disparo não saiu. Nada foi enviado. Para tentar de novo, faça um pedido novo.',
};

const disparoPedir: Ferramenta = {
  nome: 'campanha_disparo_pedir',
  escopo: 'campanhas.disparar',
  registrar(servidor, c) {
    servidor.registerTool(
      'campanha_disparo_pedir',
      {
        title: 'Pedir a aprovação do disparo de uma campanha',
        description:
          'Pede o disparo de uma campanha em rascunho que este aplicativo montou. NADA sai agora: uma pessoa da conta (o dono, ou quem ele autorizou) aprova no Regemcast, com o código do aplicativo autenticador, e fixa o teto de gasto; só então as mensagens saem, uma vez. Exige a `confirmacao` de campanha_disparo_planejar. O pedido fica preso ao plano (o texto, as variáveis, quem recebe, o custo e o cupom): se algo mudar, ele se encerra e é preciso pedir de novo. Vence em 24 horas. Um pedido aberto por campanha. Responde o pedido (situação `aguardando` e o link da tela de aprovação); acompanhe com acao_pedido_ler. Repetir com a mesma chave devolve o mesmo pedido como está agora.',
        inputSchema: z.object({
          chaveIdempotencia: z
            .string()
            .regex(FORMATO_DA_CHAVE)
            .describe('Uma chave sua, única por pedido (8 a 100 caracteres). A mesma chave com o mesmo pedido devolve o mesmo pedido, como está agora, enquanto ele existir.'),
          id: z.string().uuid().describe('O id da campanha em rascunho.'),
          confirmacao: z.string().min(16).max(64).describe('A confirmação que veio em campanha_disparo_planejar.'),
          pedidoPor: z
            .union([
              z.object({ tipo: z.literal('agente') }).strict(),
              z.object({ tipo: z.literal('pessoa'), pessoa: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
            ])
            .describe(
              'Quem pediu no seu sistema: {"tipo":"agente"} (sem pessoa) ou {"tipo":"pessoa","pessoa":"<SHA-256 hex do e-mail sem espaços e em minúsculas>"}. Nunca o e-mail: quem pediu não aprova o próprio pedido, e a conferência é pelo resumo.',
            ),
          cupom: z
            .object({
              codigo: z.string().min(1).max(LIMITE_CUPOM_CODIGO),
              descricao: z.string().max(LIMITE_CUPOM_DESCRICAO).optional(),
            })
            .strict()
            .optional()
            .describe('O cupom que a mensagem oferece, se houver: quem aprova vê o código e a descrição (a oferta enviada obriga a loja).'),
        }),
        outputSchema: z.object({ pedido: esquemaDoPedido, proximoPasso: z.string() }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      async ({ chaveIdempotencia, id, confirmacao, pedidoPor, cupom }) => {
        let feito: PedidoNovo | null = null;
        const r = await naConta(c, 'campanha_disparo_pedir', async () => {
          const quem = quemPede(c);
          const doCupom = cupomDoPedido(cupom);
          if (doCupom === 'invalido') throw new ErroDoPedido(new ErroProblema('parametro-invalido', CUPOM_INVALIDO));
          const resultado = await c.servicos.aprovacoes.pedir(
            quem,
            { chave: chaveIdempotencia, campanhaId: id, confirmacao, pedidoPor, cupom: doCupom },
            // Só para o pedido novo: a campanha é deste aplicativo, pode disparar, e a confirmação é a de agora.
            () => conferirPlanoDoDisparo(c, id, confirmacao),
          );
          if (resultado.novo) feito = { quem, pedido: resultado.pedido, plano: resultado.plano };
          return { pedido: paraFora(c, resultado.pedido), proximoPasso: PROXIMO_PASSO[resultado.pedido.situacao] ?? PROXIMO_PASSO.aguardando };
        });
        // Depois do commit: quem aprova fica sabendo, e o hub registra (só o pedido novo).
        const novo = feito as PedidoNovo | null;
        if (novo && !('isError' in r)) c.servicos.aprovacoes.depoisDoPedido(novo.quem, novo.pedido, novo.plano);
        return r;
      },
    );
  },
};

const pedidoLer: Ferramenta = {
  nome: 'acao_pedido_ler',
  escopo: 'campanhas.disparar',
  registrar(servidor, c) {
    servidor.registerTool(
      'acao_pedido_ler',
      {
        title: 'Ler um pedido de aprovação',
        description:
          'O pedido de aprovação como está agora: aguardando, aprovado, executado, recusado (com o motivo de quem recusou), vencido ou cancelado (com o motivo, como plano-mudou). O que passou do prazo aparece vencido. Só os pedidos deste aplicativo. Não muda nada.',
        inputSchema: z.object({ id: z.string().uuid().describe('O id do pedido, como veio em campanha_disparo_pedir.') }),
        outputSchema: z.object({ pedido: esquemaDoPedido, proximoPasso: z.string() }),
        annotations: LEITURA,
      },
      async ({ id }) =>
        naConta(c, 'acao_pedido_ler', async () => {
          const quem = quemPede(c);
          const p = await c.servicos.aprovacoes.lerDoAplicativo(quem.contaId, quem.produto, id);
          const fora = paraFora(c, p);
          return { pedido: fora, proximoPasso: PROXIMO_PASSO[fora.situacao] ?? '' };
        }),
    );
  },
};

const pedidoCancelar: Ferramenta = {
  nome: 'acao_pedido_cancelar',
  escopo: 'campanhas.disparar',
  registrar(servidor, c) {
    servidor.registerTool(
      'acao_pedido_cancelar',
      {
        title: 'Cancelar um pedido de aprovação',
        description:
          'Desiste de um pedido deste aplicativo que ainda espera aprovação (ou foi aprovado e ainda não saiu): ele se encerra, e nada é enviado. Cancelar de novo devolve o mesmo cancelado. O que já foi executado, recusado ou vencido não muda (a recusa diz qual).',
        inputSchema: z.object({ id: z.string().uuid().describe('O id do pedido.') }),
        outputSchema: z.object({ pedido: esquemaDoPedido, proximoPasso: z.string() }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ id }) => {
        let mudou = false;
        const r = await naConta(c, 'acao_pedido_cancelar', async () => {
          const quem = quemPede(c);
          const feito = await c.servicos.aprovacoes.cancelarPeloAplicativo(quem.contaId, quem.produto, id);
          mudou = feito.mudou;
          return { pedido: paraFora(c, feito.pedido), proximoPasso: PROXIMO_PASSO.cancelado };
        });
        if (mudou && !('isError' in r)) void c.servicos.aprovacoes.depoisDaDecisao(c.quem.contaId, id, ['cancelado']);
        return r;
      },
    );
  },
};

export const FERRAMENTAS_DE_APROVACAO: readonly Ferramenta[] = [disparoPedir, pedidoLer, pedidoCancelar];
