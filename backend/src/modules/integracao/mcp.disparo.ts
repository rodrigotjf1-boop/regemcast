/**
 * As ferramentas de DISPARO do MCP: planejar, disparar e pausar.
 *
 * Só para produto da DMS (escopo `campanhas.disparar`), só em campanha que o
 * mesmo aplicativo montou e só com o orçamento de disparos da conta valendo. As
 * travas e o porquê de cada uma estão em `disparo.regras.ts`.
 *
 * O disparo em si é o da tela: `CampanhaService.disparar`, com as mesmas
 * conferências (campanha em rascunho, WhatsApp conectado, conta liberada na
 * Meta, plano com saldo). Daqui em diante vale o que já vale para toda
 * campanha: a janela, o ritmo, o teto do plano, o limite da Meta e o orçamento,
 * que pausa e retoma sozinho. O dono é avisado no aplicativo.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as z from 'zod/v4';

import type { ResumoCampanha } from '../campanha/campanha.service';
import { ORCAMENTO_SEM_MOEDA, ORCAMENTO_SEM_TARIFA } from '../orcamento/orcamento.regras';
import { avisoDeEspalhar, confirmacaoDoPlano, impedimentosDoPlano, PLANO_MUDOU, SO_A_PROPRIA, SO_DMS } from './disparo.regras';
import { FORMATO_DA_CHAVE, PRAZO_HORAS } from './idempotencia.regras';
import { comIdempotencia } from './mcp.escrita';
import { LEITURA, naConta, type ContextoDaFerramenta, type Ferramenta } from './mcp.ferramenta';
import { campanhaParaFora, custoParaFora, esquemaDaCampanha, esquemaDoCusto } from './mcp.leitura';

const chaveDeIdempotencia = z
  .string()
  .regex(FORMATO_DA_CHAVE)
  .describe(`Uma chave sua, única por ação (8 a 100 caracteres). Repetir o MESMO pedido com a mesma chave devolve a mesma resposta, sem fazer de novo. Vale por ${PRAZO_HORAS} horas.`);

const esquemaDoOrcamento = z.object({
  definido: z.boolean(),
  periodos: z.array(
    z.object({
      periodo: z.enum(['dia', 'semana', 'mes']),
      rotulo: z.string(),
      tetoCentavos: z.number(),
      gastoCentavos: z.number(),
      texto: z.string(),
      sinal: z.enum(['ok', 'atencao', 'cheio']),
    }),
  ),
  aviso: z.string().nullable(),
});

/** A campanha, se for deste aplicativo. De outra conta ou inexistente: 404 do serviço. */
async function aPropria(c: ContextoDaFerramenta, id: string): Promise<ResumoCampanha> {
  if (c.quem.classe !== 'dms') throw new ForbiddenException(SO_DMS);
  const r = await c.servicos.campanhas.detalhe(c.quem.contaId, id);
  if (r.integracaoProduto !== c.quem.produto) throw new ForbiddenException(SO_A_PROPRIA);
  return r;
}

/** O plano do disparo: os números que valem agora, o que impede e a confirmação. */
async function planejar(c: ContextoDaFerramenta, id: string) {
  const r = await aPropria(c, id);
  const campanha = campanhaParaFora(r);
  const custo = custoParaFora(r.custo);
  // Lido como operador: quem integra não muda o orçamento.
  const o = await c.servicos.orcamento.ler(c.quem.contaId, 'operador');
  const temTeto = o.periodos.length > 0;
  const aSairCentavos = custo?.aSairCentavos ?? null;

  const impedimentos = impedimentosDoPlano({
    doServico: await c.servicos.campanhas.oQueImpedeODisparo(c.quem.contaId, id),
    naFila: campanha.naFila,
    temTeto,
    orcamentoConta: Boolean(o.moeda) && !o.avisos.includes(ORCAMENTO_SEM_MOEDA) && !o.avisos.includes(ORCAMENTO_SEM_TARIFA),
    custoEstimavel: aSairCentavos !== null,
  });
  const podeDisparar = impedimentos.length === 0;

  return {
    campanha,
    custo,
    orcamento: {
      definido: temTeto,
      periodos: o.periodos.map(({ periodo, rotulo, tetoCentavos, gastoCentavos, texto, sinal }) => ({ periodo, rotulo, tetoCentavos, gastoCentavos, texto, sinal })),
      aviso: podeDisparar ? avisoDeEspalhar(aSairCentavos, o.periodos) : null,
    },
    podeDisparar,
    impedimentos,
    confirmacao: podeDisparar
      ? confirmacaoDoPlano({
          campanhaId: id,
          produto: c.quem.produto,
          situacao: campanha.situacao,
          destinatarios: campanha.destinatarios,
          naFila: campanha.naFila,
          modelo: campanha.modelo,
          aSairCentavos,
          tetos: { ...o.tetos },
        })
      : null,
  };
}

const disparoPlanejar: Ferramenta = {
  nome: 'campanha_disparo_planejar',
  escopo: 'campanhas.disparar',
  registrar(servidor, c) {
    servidor.registerTool(
      'campanha_disparo_planejar',
      {
        title: 'Planejar o disparo de uma campanha',
        description:
          'O primeiro passo do disparo: mostra, para uma campanha em rascunho que este aplicativo montou, quantas pessoas vão receber, o custo estimado na Meta (teto), como está o orçamento de disparos da conta e o que impede o disparo agora. Se nada impede, devolve a `confirmacao` que campanha_disparar exige. Não muda nada. A decisão de disparar é de quem aprova do lado de quem chama: mostre estes números a essa pessoa.',
        inputSchema: z.object({ id: z.string().uuid().describe('O id da campanha em rascunho, como veio em campanha_rascunhar.') }),
        outputSchema: z.object({
          campanha: esquemaDaCampanha,
          custo: esquemaDoCusto,
          orcamento: esquemaDoOrcamento,
          podeDisparar: z.boolean(),
          impedimentos: z.array(z.string()),
          confirmacao: z.string().nullable(),
        }),
        annotations: { ...LEITURA, openWorldHint: true },
      },
      async ({ id }) => naConta(c, 'campanha_disparo_planejar', () => planejar(c, id)),
    );
  },
};

const campanhaDisparar: Ferramenta = {
  nome: 'campanha_disparar',
  escopo: 'campanhas.disparar',
  registrar(servidor, c) {
    servidor.registerTool(
      'campanha_disparar',
      {
        title: 'Disparar uma campanha',
        description:
          'DISPARA a campanha: as mensagens começam a sair para o público, e a Meta cobra cada uma que for entregue. Não tem volta para o que já saiu. Exige a `confirmacao` devolvida por campanha_disparo_planejar — se o público, o custo ou o orçamento mudaram desde o plano, é recusado e é preciso planejar de novo. Só para campanha que este aplicativo montou, e só com o orçamento de disparos da conta definido. Depois de disparada, a campanha respeita a janela, o ritmo, o plano e o orçamento (que pausa e retoma sozinho); acompanhe com campanha_detalhar. O dono da conta é avisado.',
        inputSchema: z.object({
          chaveIdempotencia: chaveDeIdempotencia,
          id: z.string().uuid().describe('O id da campanha.'),
          confirmacao: z.string().min(16).max(64).describe('A confirmação que veio em campanha_disparo_planejar.'),
        }),
        outputSchema: z.object({ campanha: esquemaDaCampanha, custo: esquemaDoCusto, proximoPasso: z.string() }),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      },
      async ({ chaveIdempotencia, id, confirmacao }) => {
        // Preenchido só quando o disparo acontece AGORA (não na repetição com a mesma chave).
        let disparada: { nome: string; pessoas: number; custo: string | null } | null = null;
        const r = await naConta(c, 'campanha_disparar', () =>
          comIdempotencia(c, 'campanha_disparar', chaveIdempotencia, { id, confirmacao }, async () => {
            const plano = await planejar(c, id);
            if (!plano.podeDisparar) throw new BadRequestException(plano.impedimentos.join(' '));
            if (plano.confirmacao !== confirmacao) throw new BadRequestException(PLANO_MUDOU);

            const depois = await c.servicos.campanhas.disparar(c.quem.contaId, null, id);
            disparada = { nome: depois.nome, pessoas: plano.campanha.naFila, custo: plano.custo?.linhas[0]?.valor ?? null };
            return {
              campanha: campanhaParaFora(depois),
              custo: custoParaFora(depois.custo),
              proximoPasso:
                'A campanha entrou na fila de envio. Ela respeita a janela, o ritmo, o plano e o orçamento de disparos da conta. Acompanhe com campanha_detalhar; para parar, campanha_pausar.',
            };
          }),
        );
        // Depois do commit: o dono fica sabendo que um aplicativo disparou.
        const feita = disparada as { nome: string; pessoas: number; custo: string | null } | null;
        if (feita && !('isError' in r)) {
          void c.servicos.avisos.avisar(c.quem.contaId, 'campanhas', {
            titulo: `Campanha disparada pelo aplicativo ${c.quem.nome}`,
            corpo: `"${feita.nome}" começou a sair para ${feita.pessoas} ${feita.pessoas === 1 ? 'pessoa' : 'pessoas'}${feita.custo ? `. Custo estimado na Meta: ${feita.custo}` : ''}.`,
            dados: { campanhaId: id },
          });
        }
        return r;
      },
    );
  },
};

const campanhaPausar: Ferramenta = {
  nome: 'campanha_pausar',
  escopo: 'campanhas.disparar',
  registrar(servidor, c) {
    servidor.registerTool(
      'campanha_pausar',
      {
        title: 'Pausar uma campanha',
        description:
          'Para uma campanha que está saindo ou agendada, montada por este aplicativo: nenhuma mensagem nova sai, e quem faltava continua na fila. O que já saiu não volta. Quem retoma é uma pessoa da conta, na tela.',
        inputSchema: z.object({ chaveIdempotencia: chaveDeIdempotencia, id: z.string().uuid().describe('O id da campanha.') }),
        outputSchema: z.object({ campanha: esquemaDaCampanha, proximoPasso: z.string() }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ chaveIdempotencia, id }) =>
        naConta(c, 'campanha_pausar', () =>
          comIdempotencia(c, 'campanha_pausar', chaveIdempotencia, { id }, async () => {
            await aPropria(c, id);
            const depois = await c.servicos.campanhas.pausar(c.quem.contaId, null, id);
            return {
              campanha: campanhaParaFora(depois),
              proximoPasso: 'A campanha está pausada. Quem faltava continua na fila; uma pessoa da conta retoma em Campanhas.',
            };
          }),
        ),
    );
  },
};

export const FERRAMENTAS_DE_DISPARO: readonly Ferramenta[] = [disparoPlanejar, campanhaDisparar, campanhaPausar];
