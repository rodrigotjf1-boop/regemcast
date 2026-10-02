/**
 * As ferramentas de LEITURA do MCP: o que outro produto da DMS enxerga da conta.
 *
 * Cada uma chama o MESMO serviço que a tela usa, dentro da conta do token
 * (`comConta`), e devolve um recorte curado — o que serve para decidir, e não o
 * registro inteiro. Três regras valem para todas:
 *
 * - **Sem telefone, sem nome de contato, sem conteúdo de conversa.** Contagens
 *   e situações. O que identifica uma pessoa não sai por aqui (a única
 *   ferramenta que devolve telefone é a de `mcp.conversas.ts`).
 * - **Dinheiro em centavos inteiros**, e a frase pronta ao lado, quando existe.
 * - **Erro de regra volta como resposta de erro**, com a frase em português que
 *   a tela mostraria; erro inesperado não vaza detalhe.
 *
 * Os textos escritos por quem usa a conta (nome de campanha, corpo de modelo)
 * são DADOS: quem consome não deve tratá-los como instrução.
 */
import * as z from 'zod/v4';

import type { ResumoCampanha } from '../campanha/campanha.service';
import { ORIGENS_DO_PUBLICO } from '../contato/origem-do-publico';
import { MODELO_APROVADO } from '../meta/meta.service';
import type { CustoParaTela } from '../orcamento/custo.regras';
import { LEITURA, naConta, type Ferramenta } from './mcp.ferramenta';

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

// ---------------------------------------------------------------- conta

const contaSituacao: Ferramenta = {
  nome: 'conta_situacao',
  escopo: 'conta.ler',
  registrar(servidor, c) {
    servidor.registerTool(
      'conta_situacao',
      {
        title: 'Situação da conta',
        description:
          'Diz se a conta pode enviar mensagens agora (a saúde da conta do WhatsApp na Meta, com o que resolver quando há problema), o plano e quantos disparos já saíram no ciclo. Use antes de propor ou montar uma campanha.',
        inputSchema: z.object({}),
        outputSchema: z.object({
          conta: z.string(),
          fuso: z.string(),
          whatsapp: z.object({
            conectado: z.boolean(),
            sinal: z.enum(['pode_enviar', 'com_restricao', 'bloqueado', 'desconhecido']).nullable(),
            titulo: z.string().nullable(),
            resumo: z.string().nullable(),
            lidaEm: z.string().nullable(),
            problemas: z.array(z.object({ onde: z.string(), titulo: z.string(), explicacao: z.string(), acao: z.string().nullable() })),
          }),
          plano: z.object({
            nome: z.string().nullable(),
            assinatura: z.string().nullable(),
            gratisPeloRegem: z.boolean(),
            disparosNoCiclo: z.number(),
            tetoDoCiclo: z.number().nullable(),
            restantes: z.number().nullable(),
            cicloFim: z.string().nullable(),
          }),
        }),
        annotations: LEITURA,
      },
      async () =>
        naConta(c, 'conta_situacao', async () => {
          const [saude, resumo] = [await c.servicos.saude.daConta(c.quem.contaId), await c.servicos.conta.resumo()];
          const conectado = 'sinal' in saude;
          return {
            conta: resumo.conta.nome,
            fuso: resumo.conta.timezone,
            whatsapp: conectado
              ? {
                  conectado: true,
                  sinal: saude.sinal,
                  titulo: saude.titulo,
                  resumo: saude.resumo,
                  lidaEm: iso(saude.lidaEm),
                  problemas: saude.itens.flatMap((i) =>
                    i.problemas.map((p) => ({ onde: i.rotulo, titulo: p.titulo, explicacao: p.explicacao, acao: p.acao })),
                  ),
                }
              : { conectado: false, sinal: null, titulo: null, resumo: 'A conta ainda não conectou o WhatsApp.', lidaEm: null, problemas: [] },
            plano: {
              nome: resumo.plano?.nome ?? null,
              assinatura: resumo.assinatura?.status ?? null,
              gratisPeloRegem: resumo.gratisPeloRegem,
              disparosNoCiclo: resumo.uso.disparos,
              tetoDoCiclo: resumo.uso.teto,
              restantes: resumo.uso.restantes,
              cicloFim: resumo.assinatura?.cicloFim ?? null,
            },
          };
        }),
    );
  },
};

// ------------------------------------------------------------ campanhas

const SITUACOES_DE_CAMPANHA = ['rascunho', 'agendada', 'enviando', 'pausada', 'concluida', 'cancelada'] as const;

export const esquemaDaCampanha = z.object({
  id: z.string(),
  nome: z.string(),
  situacao: z.string(),
  pausaMotivo: z.string().nullable(),
  modelo: z.string(),
  categoria: z.string().nullable(),
  publico: z.string().nullable(),
  destinatarios: z.number(),
  naFila: z.number(),
  enviadas: z.number(),
  entregues: z.number(),
  lidas: z.number(),
  falhas: z.number(),
  responderam: z.number(),
  criadaEm: z.string().nullable(),
  iniciadaEm: z.string().nullable(),
  concluidaEm: z.string().nullable(),
});

/** A campanha como o MCP entrega: os números que decidem, sem a lista de quem recebeu. */
export function campanhaParaFora(r: ResumoCampanha): z.infer<typeof esquemaDaCampanha> {
  const n = (...status: string[]) => status.reduce((soma, s) => soma + (r.porStatus[s] ?? 0), 0);
  return {
    id: r.id,
    nome: r.nome,
    situacao: r.status,
    pausaMotivo: r.pausaMotivo,
    modelo: r.modeloNome,
    categoria: r.modeloCategoria,
    publico: r.publicoRotulo ?? r.listaNome,
    destinatarios: r.total,
    naFila: n('pendente', 'enviando'),
    // "Enviada" = a Meta aceitou. Entregue e lida já foram enviadas.
    enviadas: n('enviada', 'entregue', 'lida'),
    entregues: n('entregue', 'lida'),
    lidas: n('lida'),
    falhas: n('falhou'),
    responderam: r.respondidas,
    criadaEm: iso(r.criadoEm),
    iniciadaEm: iso(r.iniciadaEm),
    concluidaEm: iso(r.concluidaEm),
  };
}

export const esquemaDoCusto = z
  .object({
    moeda: z.string().nullable(),
    gastoCentavos: z.number().nullable(),
    aSairCentavos: z.number().nullable(),
    linhas: z.array(z.object({ rotulo: z.string(), valor: z.string(), detalhe: z.string().nullable() })),
    avisos: z.array(z.string()),
  })
  .nullable();

export function custoParaFora(custo: CustoParaTela | null | undefined): z.infer<typeof esquemaDoCusto> {
  if (!custo) return null;
  return { moeda: custo.moeda, gastoCentavos: custo.gastoCentavos, aSairCentavos: custo.aSairCentavos, linhas: custo.linhas, avisos: custo.avisos };
}

const campanhasListar: Ferramenta = {
  nome: 'campanhas_listar',
  escopo: 'campanhas.ler',
  registrar(servidor, c) {
    servidor.registerTool(
      'campanhas_listar',
      {
        title: 'Listar campanhas',
        description:
          'Lista as campanhas da conta, das mais novas para as mais antigas, com a situação e os números de cada uma (na fila, enviadas, entregues, lidas, falhas, quem respondeu). Para o motivo de uma pausa, as falhas e o custo, use campanha_detalhar.',
        inputSchema: z.object({
          situacao: z.enum(SITUACOES_DE_CAMPANHA).optional().describe('Só as campanhas nesta situação.'),
          limite: z.number().int().min(1).max(50).optional().describe('Quantas devolver. Padrão: 20.'),
        }),
        outputSchema: z.object({ campanhas: z.array(esquemaDaCampanha), total: z.number() }),
        annotations: LEITURA,
      },
      async ({ situacao, limite }) =>
        naConta(c, 'campanhas_listar', async () => {
          const todas = await c.servicos.campanhas.listar(c.quem.contaId);
          const filtradas = situacao ? todas.filter((r) => r.status === situacao) : todas;
          return { campanhas: filtradas.slice(0, limite ?? 20).map(campanhaParaFora), total: filtradas.length };
        }),
    );
  },
};

const campanhaDetalhar: Ferramenta = {
  nome: 'campanha_detalhar',
  escopo: 'campanhas.ler',
  registrar(servidor, c) {
    servidor.registerTool(
      'campanha_detalhar',
      {
        title: 'Detalhar uma campanha',
        description:
          'Os números de uma campanha, por que ela está pausada ou esperando (e até quando), os motivos das falhas com o que fazer em cada um, e o custo na Meta: a estimativa antes de disparar, o gasto e o que ainda pode sair depois. Não devolve quem recebeu.',
        inputSchema: z.object({ id: z.string().uuid().describe('O id da campanha, como veio em campanhas_listar.') }),
        outputSchema: z.object({
          campanha: esquemaDaCampanha,
          pausa: z.object({ motivo: z.string(), explicacao: z.string().nullable(), voltaEm: z.string().nullable() }).nullable(),
          espera: z.object({ motivo: z.string(), ate: z.string().nullable() }).nullable(),
          falhasPorMotivo: z.array(z.object({ mensagens: z.number(), titulo: z.string(), explicacao: z.string(), acao: z.string().nullable() })),
          custo: esquemaDoCusto,
          descansoDias: z.number().nullable(),
        }),
        annotations: LEITURA,
      },
      async ({ id }) =>
        naConta(c, 'campanha_detalhar', async () => {
          const r = await c.servicos.campanhas.detalhe(c.quem.contaId, id);
          return {
            campanha: campanhaParaFora(r),
            pausa: r.pausaMotivo
              ? {
                  motivo: r.pausaMotivo,
                  explicacao: r.pausaTexto ?? (r.pausaErro ? `${r.pausaErro.titulo}. ${r.pausaErro.acao ?? ''}`.trim() : null),
                  voltaEm: iso(r.pausaAte),
                }
              : null,
            espera: r.espera ? { motivo: r.espera.motivo, ate: iso(r.espera.ate) } : null,
            falhasPorMotivo: (r.falhasPorMotivo ?? []).map((f) => ({
              mensagens: f.total,
              titulo: f.erro.titulo,
              explicacao: f.erro.explicacao,
              acao: f.erro.acao,
            })),
            custo: custoParaFora(r.custo),
            descansoDias: r.descansoDias,
          };
        }),
    );
  },
};

// -------------------------------------------------------------- públicos

const esquemaDoGrupo = z.object({ id: z.string(), nome: z.string(), regra: z.string().nullable(), pessoas: z.number() });

const publicosListar: Ferramenta = {
  nome: 'publicos_listar',
  escopo: 'publicos.ler',
  registrar(servidor, c) {
    servidor.registerTool(
      'publicos_listar',
      {
        title: 'Listar públicos',
        description:
          'Os grupos de contatos que uma campanha pode usar, com quantas pessoas de cada um PODEM receber (quem pediu para sair ou não tem WhatsApp já está fora): as listas da conta, os públicos prontos (com a regra de cada um) e os perfis da base. Só contagens: nenhum nome ou telefone.',
        inputSchema: z.object({}),
        outputSchema: z.object({
          listas: z.array(esquemaDoGrupo.extend({ usadaEm: z.string().nullable() })),
          publicos: z.array(esquemaDoGrupo),
          perfis: z.array(esquemaDoGrupo),
        }),
        annotations: LEITURA,
      },
      async () =>
        naConta(c, 'publicos_listar', async () => {
          const listas = await c.servicos.contatos.listas(c.quem.contaId);
          const publicos = await c.servicos.publicos.resumo(c.quem.contaId);
          const perfis = await c.servicos.segmentos.resumo(c.quem.contaId);
          return {
            listas: listas.map((l) => ({ id: l.id, nome: l.nome, regra: l.descricao ?? null, pessoas: l.total, usadaEm: iso(l.usadaEm) })),
            publicos: publicos.publicos.map((p) => ({ id: p.id, nome: p.nome, regra: p.regra, pessoas: p.total })),
            perfis: perfis.segmentos.map((p) => ({ id: p.id, nome: p.nome, regra: p.regra, pessoas: p.total })),
          };
        }),
    );
  },
};

const publicoEstimar: Ferramenta = {
  nome: 'publico_estimar',
  escopo: 'publicos.ler',
  registrar(servidor, c) {
    servidor.registerTool(
      'publico_estimar',
      {
        title: 'Estimar um público',
        description:
          'Quantas pessoas de um público podem receber, quantas estão em descanso (receberam marketing há pouco e ficariam de fora) e, informando a categoria do modelo, o custo estimado na Meta — que é teto: a Meta só cobra a mensagem entregue. Usa a mesma regra da montagem da campanha. Não cria nada.',
        inputSchema: z.object({
          origem: z.enum(ORIGENS_DO_PUBLICO).describe('De onde sai o público: lista, importacao, base (toda a base), perfil, regiao (estado, pelo DDD) ou publico (um público pronto).'),
          origemId: z.string().uuid().optional().describe('O id da lista ou da importação, quando a origem é uma delas.'),
          segmento: z.string().optional().describe('O id do perfil, quando a origem é perfil (veja publicos_listar).'),
          uf: z.string().length(2).optional().describe('A sigla do estado, quando a origem é regiao.'),
          publico: z.string().optional().describe('O id do público pronto, quando a origem é publico (veja publicos_listar).'),
          publicoValor: z.string().max(80).optional().describe('O bairro, o mês (1 a 12) ou o produto, quando o público pede.'),
          categoria: z.enum(['marketing', 'utilidade', 'autenticação']).optional().describe('A categoria do modelo que será usado. Com ela vem o custo estimado.'),
        }),
        outputSchema: z.object({
          pessoas: z.number(),
          emDescanso: z.number(),
          descansoDias: z.number(),
          custo: esquemaDoCusto,
        }),
        annotations: LEITURA,
      },
      async (entrada) =>
        naConta(c, 'publico_estimar', async () => {
          const p = await c.servicos.campanhas.previaDoPublico(c.quem.contaId, entrada);
          return { pessoas: p.total, emDescanso: p.descanso.emDescanso, descansoDias: p.descanso.dias, custo: custoParaFora(p.custo) };
        }),
    );
  },
};

// --------------------------------------------------------------- modelos

const modelosListar: Ferramenta = {
  nome: 'modelos_listar',
  escopo: 'modelos.ler',
  registrar(servidor, c) {
    servidor.registerTool(
      'modelos_listar',
      {
        title: 'Listar modelos de mensagem',
        description:
          'Os modelos de mensagem da conta como a Meta os tem agora: situação (só "aprovado" pode ser disparado), categoria (decide o preço e o descanso), qualidade, quantas variáveis o texto espera e o que pede atenção. O texto do modelo é conteúdo escrito pela loja.',
        inputSchema: z.object({ soAprovados: z.boolean().optional().describe('Só os que podem ser disparados.') }),
        outputSchema: z.object({
          modelos: z.array(
            z.object({
              id: z.string(),
              nome: z.string(),
              idioma: z.string(),
              categoria: z.string(),
              situacao: z.string(),
              podeDisparar: z.boolean(),
              qualidade: z.string(),
              variaveis: z.number(),
              cabecalho: z.string().nullable(),
              corpo: z.string(),
              rodape: z.string().nullable(),
              botoes: z.array(z.string()),
              alertas: z.array(z.string()),
            }),
          ),
        }),
        annotations: { ...LEITURA, openWorldHint: true },
      },
      async ({ soAprovados }) =>
        naConta(c, 'modelos_listar', async () => {
          const modelos = await c.servicos.meta.modelos(c.quem.contaId);
          return {
            modelos: modelos
              .filter((m) => !soAprovados || m.status === MODELO_APROVADO)
              .map((m) => ({
                id: m.id,
                nome: m.nome,
                idioma: m.idioma,
                categoria: m.categoria,
                situacao: m.status,
                // Aprovado, e o disparo sabe mandar tudo o que o modelo pede.
                podeDisparar: m.status === MODELO_APROVADO && m.exige.semSuporte.length === 0,
                qualidade: m.qualidade,
                variaveis: m.variaveis,
                cabecalho: m.cabecalho,
                corpo: m.corpo,
                rodape: m.rodape,
                botoes: m.botoes,
                alertas: m.alertas.map((a) => a.texto),
              })),
          };
        }),
    );
  },
};

// ------------------------------------------------------------- orçamento

const orcamentoLer: Ferramenta = {
  nome: 'orcamento_ler',
  escopo: 'orcamento.ler',
  registrar(servidor, c) {
    servidor.registerTool(
      'orcamento_ler',
      {
        title: 'Orçamento de disparos',
        description:
          'Os tetos de gasto na Meta que o dono da conta definiu (por dia, semana e mês, em centavos) e quanto já saiu em cada período. Período sem teto não aparece. Quando um teto é atingido, as campanhas pausam e voltam sozinhas na virada do período.',
        inputSchema: z.object({}),
        outputSchema: z.object({
          moeda: z.string().nullable(),
          tetos: z.object({ dia: z.number().nullable(), semana: z.number().nullable(), mes: z.number().nullable() }),
          periodos: z.array(
            z.object({
              periodo: z.enum(['dia', 'semana', 'mes']),
              rotulo: z.string(),
              tetoCentavos: z.number(),
              gastoCentavos: z.number(),
              percentual: z.number(),
              texto: z.string(),
              sinal: z.enum(['ok', 'atencao', 'cheio']),
            }),
          ),
          avisos: z.array(z.string()),
        }),
        annotations: LEITURA,
      },
      async () =>
        naConta(c, 'orcamento_ler', async () => {
          // Lido como operador: quem integra não muda o orçamento.
          const o = await c.servicos.orcamento.ler(c.quem.contaId, 'operador');
          return {
            moeda: o.moeda,
            tetos: o.tetos,
            periodos: o.periodos.map(({ periodo, rotulo, tetoCentavos, gastoCentavos, percentual, texto, sinal }) => ({
              periodo,
              rotulo,
              tetoCentavos,
              gastoCentavos,
              percentual,
              texto,
              sinal,
            })),
            avisos: o.avisos,
          };
        }),
    );
  },
};

/** As ferramentas de leitura, na ordem em que aparecem para quem integra. */
export const FERRAMENTAS_DE_LEITURA: readonly Ferramenta[] = [
  contaSituacao,
  campanhasListar,
  campanhaDetalhar,
  publicosListar,
  publicoEstimar,
  modelosListar,
  orcamentoLer,
];
