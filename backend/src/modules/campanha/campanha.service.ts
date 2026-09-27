/**
 * Campanhas: criar, disparar e contar o que realmente aconteceu.
 *
 * Este módulo nasce corrigindo o defeito mais caro que a auditoria do Regem
 * encontrou: **lá uma campanha marca "100% enviada" com 100% das mensagens em
 * `failed`**. A causa é simples e vale repetir, porque é fácil de reintroduzir:
 * o envio guarda "a Meta aceitou o POST" e nunca reconcilia com o que ela
 * responde depois, por webhook, sobre cada mensagem.
 *
 * Aqui o caminho fecha: guardamos o `wamid` de cada destinatário, e o webhook
 * encontra a linha por ele. "Enviada" e "entregue" são estados diferentes, e a
 * tela mostra os dois.
 *
 * ## Por que criar e disparar são dois passos
 *
 * A campanha e os destinatários são gravados e **commitados** antes de qualquer
 * mensagem sair. Se o disparo falhar no meio, o registro do que ia ser enviado
 * já existe — dá para ver, retomar e explicar. Criar e enviar no mesmo request
 * significa que um erro no fim apaga o registro de mensagens que já saíram e
 * já foram cobradas.
 *
 * ## O que ainda não é
 *
 * O disparo é **síncrono**, dentro do request, com teto de destinatários. Não é
 * a versão final: a fila (BullMQ/Redis) entra na Fase 4 e resolve retomada,
 * vazão e paralelismo. O teto existe justamente para que a limitação seja
 * recusa explícita em vez de timeout no meio.
 */
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import { paraCloudApi } from '../../common/telefone';
import { formasDosContatos, gemeoEmSql } from '../../common/telefone-sql';
import { env } from '../../config/env';
import { ContextoDb } from '../../db/contexto';
import { assinatura, campanha, campanhaDestinatario, conta, contatoLista, waNumero } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AvisoService } from '../aviso/aviso.service';
import { cashbackValido, hojeDaConta, hojeNoFuso } from '../contato/cashback';
import { PERIODOS, sugerirHorario, type Periodo, type SugestaoDeHorario } from '../contato/habitos';
import { origemDoPublico, type PedidoDeOrigem } from '../contato/origem-do-publico';
import { ERRO_SEM_WHATSAPP, marcarSemWhatsappNaFila, registrarFalhaSemWhatsapp } from '../contato/sem-whatsapp';
import { ErroGraph, GraphService } from '../meta/graph.service';
import { MetaService } from '../meta/meta.service';
import { TelemetriaService } from '../telemetria/telemetria.service';
import type { CriarCampanhaDto } from './dto/criar-campanha.dto';
import type { EditarCampanhaDto } from './dto/editar-campanha.dto';
import { conferirCashbackDaFila } from './cashback-da-fila';
import { decidir, momentoNoFuso, type RegraDeEnvio } from './janela';
import { rotuloDoPublico, type OrigemDaCampanha } from './rotulo-do-publico';
import { lerVariaveis, normalizarVariaveis, usaCashback, variaveisEmSql, type VariavelDaLista } from './variaveis';

type Executor = { execute: (q: SQL) => Promise<unknown> };

export const TITULO_DESCADASTRADO = 'Pediu para sair';

/**
 * Tira da fila quem pediu para não receber mais mensagens.
 *
 * Vira `falhou` com o motivo, e não some da campanha: sumir faria o total não
 * bater com o que a pessoa montou, e ela não saberia por que alguém ficou de
 * fora. Nada é enviado, nada conta no consumo do plano.
 *
 * Uma única consulta para a campanha inteira — conferir contato a contato seria
 * uma ida ao banco por destinatário.
 *
 * Confere as DUAS formas do celular brasileiro (com e sem o 9º dígito): a
 * pessoa pode ter pedido para sair numa forma e estar na campanha na outra. É a
 * regra de `gemeoDoCelular` (common/telefone.ts), em SQL — e o cruzamento é por
 * igualdade (`formasDosContatos`), que usa índice: roda a cada rodada do envio,
 * sobre a fila inteira da campanha (ERR-018).
 */
export async function marcarDescadastrados(db: Executor, contaId: string, filtro: SQL): Promise<void> {
  await db.execute(sql`
    with m as materialized ${formasDosContatos(contaId, sql`c.opt_out = true`)}
    update campanha_destinatario d
       set status = 'falhou',
           erro_titulo = ${TITULO_DESCADASTRADO},
           erro_detalhe = 'Esta pessoa pediu para não receber mais mensagens da sua empresa. Nada foi enviado.',
           falhou_em = now()
      from m
     where d.conta_id = ${contaId}
       and ${filtro}
       and d.status = 'pendente'
       and d.telefone_e164 = m.telefone
  `);
}

/**
 * Recebeu campanha de MARKETING nos últimos `dias` — está em descanso.
 *
 * Conta a mensagem que saiu de verdade (enviada, entregue, lida) e a que está
 * saindo agora (`enviando`, de outra campanha na mesma rodada); falha não
 * conta, porque não chegou. As duas formas do celular valem juntas. Campanha
 * sem categoria gravada (antigas) conta como marketing: na dúvida, descansa.
 */
export function recebeuMarketingRecente(conta: SQL, telefone: SQL, dias: number, excetoCampanha?: SQL): SQL {
  return sql`exists (
    select 1
      from campanha_destinatario o
      join campanha oc on oc.id = o.campanha_id
     where o.conta_id = ${conta}
       ${excetoCampanha ? sql`and o.campanha_id <> ${excetoCampanha}` : sql``}
       and upper(coalesce(oc.modelo_categoria, 'MARKETING')) = 'MARKETING'
       and o.telefone_e164 in (${telefone}, ${gemeoEmSql(telefone)})
       and (o.status = 'enviando'
            or (o.status in ('enviada', 'entregue', 'lida')
                and o.enviada_em >= now() - make_interval(days => ${dias})))
  )`;
}

export const TITULO_DESCANSO = 'Em descanso';

export const MENSAGEM_SEM_SALDO =
  'Os disparos do seu plano acabaram neste ciclo. A campanha pode sair quando o ciclo virar ou com um plano maior.';

/**
 * Quantos disparos ainda cabem no plano da conta neste ciclo.
 *
 * `null` = sem teto (conta sem plano): não limita. O que conta como gasto:
 *
 * - `uso_ciclo.disparos` — o que a Meta já aceitou neste ciclo;
 * - destinatários em `enviando` — o que está saindo AGORA e ainda não entrou no
 *   contador. Sem eles, uma rodada leria o saldo antes de a anterior terminar
 *   de contar, e o plano seria ultrapassado exatamente em quem manda muito.
 */
export async function saldoDoPlano(db: Executor, contaId: string): Promise<number | null> {
  const r = (await db.execute(sql`
    select p.disparos_mes as teto,
           coalesce(u.disparos, 0) as usados,
           (select count(*) from campanha_destinatario d
             where d.conta_id = c.id and d.status = 'enviando') as em_voo
      from conta c
      left join assinatura a on a.conta_id = c.id
      left join plano p on p.id = coalesce(a.plano_id, c.plano_id)
      left join uso_ciclo u on u.conta_id = c.id and u.ciclo_inicio = a.ciclo_inicio
     where c.id = ${contaId}
  `)) as { rows: { teto: number | null; usados: string | number; em_voo: string | number }[] };

  const linha = r.rows[0];
  if (!linha || linha.teto === null || linha.teto === undefined) return null;
  return Number(linha.teto) - Number(linha.usados) - Number(linha.em_voo);
}

export const MENSAGEM_INADIMPLENTE =
  'Os disparos estão parados por falta de pagamento do plano. Regularize em Conta e usuários → Plano e pagamento.';

/**
 * A conta pode enviar? `inadimplencia` quando não pode; `null` quando pode.
 *
 * Só os DISPAROS param — painel, contatos e modelos continuam, para o cliente
 * conseguir pagar e voltar. A carência (CARENCIA_DIAS) conta:
 *
 * - do fim do grátis, para quem nunca pagou (mesmo que o job ainda não tenha
 *   marcado a conta como inadimplente — a regra não depende do job ter rodado);
 * - de `inadimplente_desde`, para quem teve a cobrança recusada.
 *
 * Assinatura cancelada não envia. Conta sem assinatura nenhuma não é bloqueada
 * aqui (é conta interna ou legado; o teto do plano continua valendo).
 */
export async function motivoDeBloqueio(db: Executor, contaId: string): Promise<'inadimplencia' | null> {
  const r = (await db.execute(sql`
    select a.status,
           (a.status = 'cortesia' and a.gratis_ate is not null
              and a.gratis_ate + make_interval(days => ${env.mercadoPago.carenciaDias}) <= now()) as gratis_vencido,
           (a.status = 'inadimplente'
              and coalesce(a.inadimplente_desde, now()) + make_interval(days => ${env.mercadoPago.carenciaDias}) <= now()) as carencia_vencida
      from assinatura a
     where a.conta_id = ${contaId}
  `)) as { rows: { status: string; gratis_vencido: boolean; carencia_vencida: boolean }[] };

  const a = r.rows[0];
  if (!a) return null;
  if (a.status === 'cancelada' || a.gratis_vencido || a.carencia_vencida) return 'inadimplencia';
  return null;
}

/**
 * O limite de envio da META, como a rodada precisa: quanto cabe agora.
 *
 * É outro teto, separado do plano: pessoas DIFERENTES alcançadas com modelo
 * numa janela MÓVEL de 24 horas, do portfólio inteiro (250 → 2.000 → 10.000 →
 * 100.000 → sem teto; ver `limite.regras.ts`). Conta todas as campanhas da
 * conta.
 *
 * `null` quando não há o que obedecer: sem teto, ou limite nunca lido — não
 * sabemos, e travar por falta de leitura pararia quem não precisa (o job de
 * limite relê de 6 em 6 horas).
 *
 * Conservador de propósito: conta também quem estava com a conversa aberta (a
 * Meta não conta) e quem está saindo agora. Errar para menos só atrasa a
 * campanha; errar para mais faz a Meta recusar.
 */
export interface CapacidadeDaMeta {
  limite: number;
  /** Alcançados nas últimas 24 h + os que estão saindo agora. */
  usados: number;
  /** Quando o envio mais antigo da janela completa 24 h — a próxima vaga. */
  liberaEm: Date | null;
}

export async function capacidadeDaMeta(db: Executor, contaId: string): Promise<CapacidadeDaMeta | null> {
  const r = (await db.execute(sql`
    select n.tier_limite as limite,
           (select count(distinct d.telefone_e164) from campanha_destinatario d
             where d.conta_id = ${contaId} and d.enviada_em > now() - interval '24 hours') as alcancados,
           (select count(*) from campanha_destinatario d
             where d.conta_id = ${contaId} and d.status = 'enviando') as em_voo,
           (select min(d.enviada_em) + interval '24 hours' from campanha_destinatario d
             where d.conta_id = ${contaId} and d.enviada_em > now() - interval '24 hours') as libera_em
      from wa_numero n
     where n.conta_id = ${contaId} and n.status = 'registrado'
     order by n.tier_em desc nulls last
     limit 1
  `)) as {
    rows: { limite: number | null; alcancados: string | number; em_voo: string | number; libera_em: unknown }[];
  };

  const linha = r.rows[0];
  if (!linha || linha.limite === null || linha.limite === undefined) return null;
  return {
    limite: Number(linha.limite),
    usados: Number(linha.alcancados ?? 0) + Number(linha.em_voo ?? 0),
    liberaEm: linha.libera_em ? new Date(String(linha.libera_em)) : null,
  };
}

/**
 * Recusas da Meta que pedem para DESACELERAR a campanha inteira (ritmo e teto
 * de chamadas), e não só adiar um destinatário.
 */
const DESACELERA = new Set([130429, 80007]);

/** Quantas vezes, no máximo, tentamos de novo um destinatário que a Meta recusou por ritmo ou instabilidade. */
export const MAX_TENTATIVAS_ENVIO = 3;

/**
 * Espera até a próxima tentativa: a que a Meta pede, dobrando a cada nova
 * recusa, até 1 hora. O que ela manda esperar um dia (131049), espera um dia —
 * insistir antes disso ela pune.
 */
export function esperaDaNovaTentativa(baseSegundos: number | undefined, tentativasFeitas: number): number {
  const base = baseSegundos && baseSegundos > 0 ? baseSegundos : 60;
  if (base >= 86_400) return base;
  return Math.min(base * 2 ** tentativasFeitas, 3_600);
}

/**
 * O que a tela diz de uma falha definitiva de envio.
 *
 * Duas falhas precisam de texto próprio, porque a explicação padrão do erro
 * promete o que não vai acontecer ("tentamos de novo automaticamente"):
 * a rede que caiu no meio do envio (não reenviamos — pode ter chegado) e a
 * recusa que continuou depois de todas as novas tentativas.
 */
export function detalheDaFalha(g: ErroGraph | null, tentativasFeitas: number): string {
  if (!g) return 'Não conseguimos enviar esta mensagem.';
  if (g.status === 0) {
    return 'A conexão com a Meta caiu durante o envio e não dá para saber se a mensagem chegou. Para não correr o risco de enviar duas vezes, ela não foi reenviada.';
  }
  if (g.retentavel) {
    return `A Meta recusou ${tentativasFeitas + 1} vezes seguidas (${g.traduzido.titulo.toLowerCase()}). Para não insistir, esta mensagem não foi reenviada.`;
  }
  return g.mensagemParaUsuario;
}

/** O que acontece com um destinatário depois da tentativa de envio. */
type ResultadoEnvio =
  | { tipo: 'enviada' }
  | { tipo: 'falhou' }
  | { tipo: 'nova_tentativa' }
  | { tipo: 'desacelerar'; esperaSegundos: number };

/** A campanha ativa que está esperando, e até quando. */
export interface EsperaDaCampanha {
  /** `limite_meta`: a conta já alcançou o limite de 24 h; `ritmo`: a Meta pediu calma. */
  motivo: 'limite_meta' | 'ritmo';
  ate: Date | null;
  /** O limite de pessoas por 24 h, quando o motivo é ele. */
  limite: number | null;
}

/**
 * Devolve à fila as campanhas pausadas por falta de disparos.
 *
 * Chamado quando o saldo pode ter voltado: ciclo virou, plano mudou. Não confere
 * o saldo de cada conta — o worker confere na rodada seguinte e, se ainda não
 * houver, pausa de novo. Uma consulta só em vez de uma conta por vez.
 */
export async function retomarPausadasPorTeto(
  db: Executor,
  contaIds?: string[],
  motivos: ('teto_plano' | 'inadimplencia')[] = ['teto_plano'],
): Promise<number> {
  const filtro =
    contaIds && contaIds.length
      ? sql`and conta_id in (${sql.join(contaIds.map((id) => sql`${id}`), sql`, `)})`
      : sql``;
  const r = (await db.execute(sql`
    update campanha set status = 'agendada', pausa_motivo = null
     where status = 'pausada'
       and pausa_motivo in (${sql.join(motivos.map((m) => sql`${m}`), sql`, `)})
       ${filtro}
    returning id
  `)) as { rows: unknown[] };
  return r.rows.length;
}

/** Estados em que a campanha ainda tem trabalho para o worker. */
const ESTADOS_ATIVOS = ['agendada', 'enviando'] as const;

/**
 * Quantas mensagens por rodada, no máximo.
 *
 * Pequeno de propósito: a rodada fala com a Meta uma vez por destinatário, e
 * uma rodada longa atrasa as campanhas de todas as outras contas que esperam
 * a vez. Vinte por rodada, a cada poucos segundos, mantém a fila andando para
 * todo mundo.
 */
const LOTE_POR_RODADA = 20;

/** Quantos destinatários a tela da campanha recebe, no máximo. */
const LIMITE_DESTINATARIOS_TELA = 500;

/** Depois de quanto tempo um destinatário em "enviando" é considerado preso. */
const MINUTOS_PRESO = 10;

/** O público montado: quantos entraram, a lista (se foi lista) e o nome que o cartão mostra. */
interface PublicoMontado {
  total: number;
  listaId: string | null;
  origem: OrigemDaCampanha;
  rotulo: string | null;
  /** De onde sai cada variável (lista e "Da base"); nulo para números digitados. */
  variaveis: VariavelDaLista[] | null;
}

/** A prévia de "Quem recebe": quantos podem receber, quantos estão em descanso e em que período pedem. */
export interface PreviaDoPublico {
  total: number;
  descanso: { dias: number; emDescanso: number };
  horario: SugestaoDeHorario;
  /**
   * Com variável de cashback, `total` é só quem tem cashback válido; aqui, de
   * quantos do público (quem pode receber). Nulo sem variável de cashback.
   */
  cashback: { doPublico: number } | null;
}

export interface ResumoCampanha {
  id: string;
  nome: string;
  modeloNome: string;
  modeloIdioma: string;
  status: string;
  /** conexao | teto_plano — só quando pausada. */
  pausaMotivo: string | null;
  criadoEm: Date;
  iniciadaEm: Date | null;
  concluidaEm: Date | null;
  /** Contagem por status, derivada dos destinatários — nunca de contador guardado. */
  porStatus: Record<string, number>;
  total: number;
  /** A lista de contatos de onde saiu o público; nulo quando os números foram digitados. */
  listaNome: string | null;
  /** A categoria do modelo, traduzida: marketing, utilidade, autenticação. */
  modeloCategoria: string | null;
  /** De onde saiu o público (lista, números, base, importação, perfil, público) e o nome dele no cartão. */
  publicoOrigem: string | null;
  publicoRotulo: string | null;
  /** O que a tela de edição precisa para reabrir a campanha como ela está. */
  modeloId: string | null;
  listaId: string | null;
  janelaDias: number[];
  janelaInicio: string | null;
  janelaFim: string | null;
  pausaSegundos: number;
  maxPorDia: number | null;
  maxPorSemana: number | null;
  maxPorMes: number | null;
  /**
   * Por que uma campanha ativa não está saindo agora, e até quando. Nulo
   * quando nada a segura. Não é pausa: ela continua sozinha.
   */
  espera: EsperaDaCampanha | null;
  /** Quantas pessoas responderam à mensagem (só o fato; o texto não é guardado). */
  respondidas: number;
  /** O descanso desta campanha, em dias; nulo = sem descanso. */
  descansoDias: number | null;
}

@Injectable()
export class CampanhaService {
  private readonly log = new Logger('Campanha');

  constructor(
    private readonly ctx: ContextoDb,
    private readonly meta: MetaService,
    private readonly graph: GraphService,
    private readonly auditoria: AuditoriaService,
    private readonly telemetria: TelemetriaService,
    private readonly avisos: AvisoService,
  ) {}

  /** Cria a campanha com os destinatários em `pendente`. Nada é enviado aqui. */
  async criar(
    contaId: string,
    usuarioId: string,
    dto: CriarCampanhaDto,
    papel: 'dono' | 'operador' = 'operador',
  ): Promise<{ id: string }> {
    // Recusa cedo: sem WhatsApp conectado a campanha não teria como sair, e
    // deixar criar para falhar no disparo só adianta a frustração.
    const credencial = await this.meta.tokenDaConta(contaId);
    if (!credencial) {
      throw new BadRequestException(
        'Conecte sua conta do WhatsApp antes de criar uma campanha.',
      );
    }

    // Normaliza ANTES de qualquer outra coisa, por dois motivos.
    //
    // É este valor que vai para a Meta: quando a validação e a gravação usam
    // funções diferentes, o número que passou no formulário não é o número que
    // sai — foi assim que "21989751705", sem o 55, virou um destinatário
    // internacional inexistente e um erro da Meta que não explicava nada.
    //
    // E é por ele que a duplicidade tem de ser medida: "21989751705" e
    // "5521989751705" são a MESMA pessoa. Comparar o texto cru deixaria os dois
    // passarem aqui para estourar depois no índice único, com uma mensagem do
    // banco que ninguém entende.
    // Antes de gravar qualquer coisa: número inválido ou repetido recusa aqui.
    if (dto.destinatarios?.length) this.conferirNumeros(dto.destinatarios);
    this.conferirTetos(dto.maxPorDia, dto.maxPorSemana, dto.maxPorMes);

    // Descanso entre campanhas: o número da conta é COPIADO para a campanha
    // agora — mudar o da conta depois não mexe em campanha já criada. Só para
    // modelo de marketing; liberar (mandar mesmo para quem está em descanso) é
    // decisão do dono.
    if (dto.ignorarDescanso && papel !== 'dono') {
      throw new ForbiddenException('Só o dono da conta pode enviar para quem está em descanso.');
    }
    const [config] = await this.ctx.db
      .select({ dias: conta.descansoMarketingDias })
      .from(conta)
      .where(eq(conta.id, contaId))
      .limit(1);
    const ehMarketing = (dto.modeloCategoria ?? '').toUpperCase() === 'MARKETING';
    const descansoDias = ehMarketing && !dto.ignorarDescanso && (config?.dias ?? 0) > 0 ? config!.dias : null;

    const [criada] = await this.ctx.db
      .insert(campanha)
      .values({
        contaId,
        nome: dto.nome.trim(),
        modeloId: dto.modeloId ?? null,
        modeloNome: dto.modeloNome,
        modeloIdioma: dto.modeloIdioma,
        modeloCategoria: dto.modeloCategoria ?? null,
        status: 'rascunho',
        criadaPor: usuarioId,
        janelaDias: dto.janelaDias ?? [],
        // Só grava a janela quando vier COMPLETA. Início sem fim não é uma
        // regra: é um formulário pela metade, e tratá-lo como janela deixaria
        // a campanha parada por uma decisão que ninguém tomou.
        janelaInicio: dto.janelaInicio && dto.janelaFim ? dto.janelaInicio : null,
        janelaFim: dto.janelaInicio && dto.janelaFim ? dto.janelaFim : null,
        pausaSegundos: dto.pausaSegundos ?? 0,
        maxPorDia: dto.maxPorDia ?? null,
        maxPorSemana: dto.maxPorSemana ?? null,
        maxPorMes: dto.maxPorMes ?? null,
        descansoDias,
      })
      .returning({ id: campanha.id });

    const publico = await this.montarPublico(contaId, criada!.id, dto);
    const totalDestinatarios = publico.total;

    await this.ctx.db
      .update(campanha)
      .set({
        listaId: publico.listaId,
        publicoOrigem: publico.origem,
        publicoRotulo: publico.rotulo,
        variaveisLista: publico.variaveis,
      })
      .where(eq(campanha.id, criada!.id));

    // Já na montagem: a pessoa vê, antes de disparar, quem não vai receber e
    // por quê — em vez de descobrir no relatório depois.
    await marcarDescadastrados(this.ctx.db, contaId, sql`d.campanha_id = ${criada!.id}`);
    await marcarSemWhatsappNaFila(this.ctx.db, contaId, sql`d.campanha_id = ${criada!.id}`);

    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuarioId,
      acao: 'campanha.criada',
      entidade: 'campanha',
      entidadeId: criada!.id,
      detalhe: {
        nome: dto.nome,
        modelo: dto.modeloNome,
        destinatarios: totalDestinatarios,
        lista: publico.listaId,
        publico: publico.origem,
        publicoRotulo: publico.rotulo,
        descansoDias,
        descansoLiberadoPeloDono: Boolean(dto.ignorarDescanso && ehMarketing),
      },
    });

    return { id: criada!.id };
  }

  /**
   * Normaliza os números digitados e recusa repetição.
   *
   * Separado da gravação porque a recusa precisa acontecer ANTES de a campanha
   * existir: mesmo com a transação desfazendo tudo, validar depois de gravar
   * significa que o erro chega junto com um rollback — e qualquer passo futuro
   * fora da transação (fila, telemetria) passaria a depender disso.
   */
  private conferirNumeros(
    destinatarios: { telefone: string; variaveis?: string[] }[],
  ): { telefoneE164: string; variaveis: string[] }[] {
    const normalizados = destinatarios.map((d) => {
      const { e164 } = paraCloudApi(d.telefone);
      if (!e164) {
        throw new BadRequestException(
          `O telefone ${d.telefone} não é válido. Informe DDD + número, por exemplo 21 99999-8888.`,
        );
      }
      return { telefoneE164: e164, variaveis: d.variaveis ?? [] };
    });

    const repetido = normalizados.find(
      (d, i) => normalizados.findIndex((o) => o.telefoneE164 === d.telefoneE164) !== i,
    );
    if (repetido) {
      // O banco também barra (índice único), mas a mensagem dele não diz qual
      // número está repetido — e é isso que a pessoa precisa saber.
      throw new BadRequestException(
        `O telefone ${repetido.telefoneE164} aparece mais de uma vez. Cada pessoa recebe uma vez só.`,
      );
    }

    return normalizados;
  }

  /**
   * Grava quem vai receber — da lista de contatos ou dos números digitados.
   *
   * Um lugar só, usado pela criação e pela edição: quando as duas montavam o
   * público por caminhos diferentes, bastava corrigir um para o outro continuar
   * errado (foi assim que o opt-out ficou de fora de um dos dois no Regem).
   */
  private async montarPublico(
    contaId: string,
    campanhaId: string,
    dto: {
      listaId?: string;
      daBase?: PedidoDeOrigem;
      destinatarios?: { telefone: string; variaveis?: string[] }[];
      variaveisLista?: VariavelDaLista[];
    },
  ): Promise<PublicoMontado> {
    // Uma lista escolhida pelo caminho "da base" é uma lista como outra qualquer.
    const listaId = dto.listaId ?? (dto.daBase?.origem === 'lista' ? (dto.daBase.origemId ?? undefined) : undefined);
    const daBase = dto.daBase && dto.daBase.origem !== 'lista' ? dto.daBase : undefined;
    if ([Boolean(listaId), Boolean(daBase), Boolean(dto.destinatarios?.length)].filter(Boolean).length !== 1) {
      throw new BadRequestException('Escolha quem recebe: uma lista, um público da base ou os números digitados — um só.');
    }

    // As variáveis que saem do contato (nome, cashback…) valem para todo público
    // que sai da base (`variaveis.ts`). Com variável de cashback, só entra quem
    // tem cashback válido hoje, no fuso da conta — a mesma regra dos públicos.
    const lista = normalizarVariaveis(dto.variaveisLista);
    const hoje = hojeDaConta(contaId);
    const comCashback = usaCashback(lista);
    const soComCashback = (apelido: 'c' | 'contato') => (comCashback ? sql`and ${cashbackValido(apelido, hoje)}` : sql``);

    if (listaId) {
      const [escolhida] = await this.ctx.db
        .select({ id: contatoLista.id, nome: contatoLista.nome })
        .from(contatoLista)
        .where(and(eq(contatoLista.id, listaId), eq(contatoLista.contaId, contaId)))
        .limit(1);
      if (!escolhida) throw new NotFoundException('Lista de contatos não encontrada.');

      // Uma query só, dentro do banco: a lista pode ter dezenas de milhares de
      // contatos, e trazê-los para cá para devolver um por um seria o N+1 que
      // derruba a request. Quem pediu para sair já fica de fora aqui.
      // `count(*)` sobre o CTE, e não `returning id`: devolver 50 mil ids ao
      // Node só para contá-los custa segundos de rede e memória.
      const r = await this.ctx.db.execute(sql`
        with inseridos as (
        insert into campanha_destinatario (conta_id, campanha_id, telefone_e164, variaveis)
        select ${contaId}, ${campanhaId}, c.telefone_e164, ${variaveisEmSql(lista, 'c', hoje)}
          from contato_lista_item i
          join contato c on c.id = i.contato_id and c.conta_id = i.conta_id
         where i.conta_id = ${contaId}
           and i.lista_id = ${escolhida.id}
           and c.opt_out = false
           ${soComCashback('c')}
        on conflict (campanha_id, telefone_e164) do nothing
        returning 1
        )
        select count(*)::int as total from inseridos
      `);
      const total = Number((r.rows[0] as { total: number } | undefined)?.total ?? 0);
      if (total === 0) {
        // Desfaz a campanha junto (a request é uma transação): uma campanha
        // vazia só confundiria a lista.
        throw new BadRequestException(
          comCashback
            ? `A lista "${escolhida.nome}" não tem ninguém com cashback válido que possa receber.`
            : `A lista "${escolhida.nome}" não tem ninguém que possa receber: está vazia ou todos pediram para sair.`,
        );
      }
      return { total, listaId: escolhida.id, origem: 'lista', rotulo: null, variaveis: lista };
    }

    if (daBase) {
      // Um público da base (toda a base, importação, perfil, estado, público
      // pronto): a MESMA regra dos blocos e da prévia, copiada agora — a foto
      // que a campanha manda, como a da lista.
      const o = await origemDoPublico(this.ctx.db, contaId, daBase);
      const rotulo = rotuloDoPublico(daBase.origem, o.nome);
      const r = await this.ctx.db.execute(sql`
        with inseridos as (
        insert into campanha_destinatario (conta_id, campanha_id, telefone_e164, variaveis)
        select ${contaId}, ${campanhaId}, contato.telefone_e164, ${variaveisEmSql(lista, 'contato', hoje)}
          from contato
         where contato.conta_id = ${contaId}
           and contato.opt_out = false
           and ${o.filtro}
           ${soComCashback('contato')}
        on conflict (campanha_id, telefone_e164) do nothing
        returning 1
        )
        select count(*)::int as total from inseridos
      `);
      const total = Number((r.rows[0] as { total: number } | undefined)?.total ?? 0);
      if (total === 0) {
        throw new BadRequestException(
          comCashback
            ? `"${rotulo}" não tem ninguém com cashback válido que possa receber agora.`
            : `"${rotulo}" não tem ninguém que possa receber agora.`,
        );
      }
      return { total, listaId: null, origem: daBase.origem, rotulo, variaveis: lista };
    }

    const normalizados = this.conferirNumeros(dto.destinatarios ?? []);

    await this.ctx.db.insert(campanhaDestinatario).values(
      normalizados.map((d) => ({
        contaId,
        campanhaId,
        telefoneE164: d.telefoneE164,
        variaveis: d.variaveis,
      })),
    );

    return { total: normalizados.length, listaId: null, origem: 'numeros', rotulo: null, variaveis: null };
  }

  /**
   * Pausa por decisão do cliente.
   *
   * Diferente das pausas automáticas (conexão, teto do plano, inadimplência):
   * aquelas voltam sozinhas quando a causa some, esta só volta quando a pessoa
   * mandar. É por isso que o motivo fica gravado — o worker resume as
   * automáticas e nunca toca nesta.
   *
   * Quem já estava saindo naquele instante (status `enviando`) segue: a Meta já
   * recebeu, e fingir que não recebeu duplicaria a mensagem na retomada.
   */
  async pausar(contaId: string, usuarioId: string, campanhaId: string): Promise<ResumoCampanha> {
    const alvo = await this.buscar(contaId, campanhaId);

    if (alvo.status !== 'agendada' && alvo.status !== 'enviando') {
      throw new BadRequestException(
        `Só dá para pausar campanha que está saindo ou agendada — esta está "${alvo.status}".`,
      );
    }

    await this.ctx.db
      .update(campanha)
      .set({ status: 'pausada', pausaMotivo: 'manual' })
      .where(
        and(
          eq(campanha.id, campanhaId),
          eq(campanha.contaId, contaId),
          inArray(campanha.status, ['agendada', 'enviando']),
        ),
      );

    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuarioId,
      acao: 'campanha.pausada',
      entidade: 'campanha',
      entidadeId: campanhaId,
      detalhe: { motivo: 'manual' },
    });

    return this.detalhe(contaId, campanhaId);
  }

  /**
   * Edita a campanha.
   *
   * O que dá para mudar depende da situação:
   *
   * - **rascunho** — tudo, inclusive modelo e público: nada saiu ainda;
   * - **agendada ou pausada** — nome, janela, ritmo e limites. Modelo e público
   *   de campanha que já começou são HISTÓRIA: trocá-los faria a tela mentir
   *   sobre o que foi enviado, e a métrica deixaria de bater com a realidade.
   */
  async editar(
    contaId: string,
    usuarioId: string,
    campanhaId: string,
    dto: EditarCampanhaDto,
  ): Promise<ResumoCampanha> {
    const alvo = await this.buscar(contaId, campanhaId);

    if (!['rascunho', 'agendada', 'pausada'].includes(alvo.status)) {
      throw new BadRequestException(
        `Campanha "${alvo.status}" não é mais editável. Monte outra para enviar de novo.`,
      );
    }

    const mexeNoConteudo = Boolean(
      dto.modeloNome || dto.modeloId || dto.listaId || dto.daBase || dto.destinatarios?.length || dto.variaveisLista,
    );
    if (mexeNoConteudo && alvo.status !== 'rascunho') {
      throw new BadRequestException(
        'Depois de disparada, dá para ajustar só o nome, a janela, o ritmo e os limites. Modelo e público ficam como foram enviados.',
      );
    }

    this.conferirTetos(
      dto.maxPorDia ?? alvo.maxPorDia ?? undefined,
      dto.maxPorSemana ?? alvo.maxPorSemana ?? undefined,
      dto.maxPorMes ?? alvo.maxPorMes ?? undefined,
    );

    const mudancas: Record<string, unknown> = {};
    if (dto.nome !== undefined) mudancas.nome = dto.nome.trim();
    if (dto.modeloNome !== undefined) mudancas.modeloNome = dto.modeloNome;
    if (dto.modeloIdioma !== undefined) mudancas.modeloIdioma = dto.modeloIdioma;
    if (dto.modeloId !== undefined) mudancas.modeloId = dto.modeloId;
    if (dto.modeloCategoria !== undefined) mudancas.modeloCategoria = dto.modeloCategoria;
    if (dto.pausaSegundos !== undefined) mudancas.pausaSegundos = dto.pausaSegundos;
    if (dto.maxPorDia !== undefined) mudancas.maxPorDia = dto.maxPorDia;
    if (dto.maxPorSemana !== undefined) mudancas.maxPorSemana = dto.maxPorSemana;
    if (dto.maxPorMes !== undefined) mudancas.maxPorMes = dto.maxPorMes;
    if (dto.janelaDias !== undefined) mudancas.janelaDias = dto.janelaDias;

    // Janela só vale COMPLETA, como na criação: início sem fim não é regra, é
    // formulário pela metade — e deixaria a campanha parada sem ninguém ter
    // decidido isso.
    if (dto.janelaInicio !== undefined || dto.janelaFim !== undefined) {
      // `null` vindo da tela quer dizer "tirar o horário" — por isso a
      // comparação é com `undefined` (campo não enviado), e não um `??`,
      // que trataria o null como "manter o antigo" e a janela nunca sairia.
      const inicio = dto.janelaInicio !== undefined ? dto.janelaInicio : alvo.janelaInicio;
      const fim = dto.janelaFim !== undefined ? dto.janelaFim : alvo.janelaFim;
      mudancas.janelaInicio = inicio && fim ? inicio : null;
      mudancas.janelaFim = inicio && fim ? fim : null;
    }

    if (Object.keys(mudancas).length) {
      await this.ctx.db
        .update(campanha)
        .set(mudancas)
        .where(and(eq(campanha.id, campanhaId), eq(campanha.contaId, contaId)));
    }

    if (mexeNoConteudo && (dto.listaId || dto.daBase || dto.destinatarios?.length)) {
      // Troca de público em rascunho: os antigos saem inteiros. Nada foi
      // enviado, então não há histórico a preservar.
      await this.ctx.db
        .delete(campanhaDestinatario)
        .where(
          and(eq(campanhaDestinatario.campanhaId, campanhaId), eq(campanhaDestinatario.contaId, contaId)),
        );

      const publico = await this.montarPublico(contaId, campanhaId, {
        listaId: dto.listaId,
        daBase: dto.daBase,
        destinatarios: dto.destinatarios,
        variaveisLista: dto.variaveisLista,
      });
      await this.ctx.db
        .update(campanha)
        .set({
          listaId: publico.listaId,
          publicoOrigem: publico.origem,
          publicoRotulo: publico.rotulo,
          variaveisLista: publico.variaveis,
        })
        .where(and(eq(campanha.id, campanhaId), eq(campanha.contaId, contaId)));
      await marcarDescadastrados(this.ctx.db, contaId, sql`d.campanha_id = ${campanhaId}`);
      await marcarSemWhatsappNaFila(this.ctx.db, contaId, sql`d.campanha_id = ${campanhaId}`);
    }

    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuarioId,
      acao: 'campanha.editada',
      entidade: 'campanha',
      entidadeId: campanhaId,
      detalhe: { campos: Object.keys(mudancas), publicoTrocado: mexeNoConteudo },
    });

    return this.detalhe(contaId, campanhaId);
  }

  /**
   * Excluir, e o que isso significa em cada situação.
   *
   * - **rascunho** — some de vez: nada saiu, não há história a guardar.
   * - **agendada ou pausada** — vira `cancelada`. Quem não recebeu passa a
   *   `cancelado`, e não a `falhou`: falha é problema de entrega, e misturar as
   *   duas esconderia justamente o sinal que denuncia número com problema.
   * - **concluída ou cancelada** — sai da lista (`arquivada_em`), mas continua
   *   no banco: o consumo do ciclo e a cobrança da Meta se apoiam nela.
   *
   * Campanha **enviando** não é cancelada direto: pausar primeiro é o que
   * garante que ninguém receba mensagem de uma campanha "cancelada".
   */
  async excluir(
    contaId: string,
    usuarioId: string,
    campanhaId: string,
  ): Promise<{ resultado: 'apagada' | 'cancelada' | 'arquivada' }> {
    const alvo = await this.buscar(contaId, campanhaId);

    if (alvo.status === 'enviando') {
      throw new BadRequestException(
        'Esta campanha está enviando agora. Pause primeiro e depois cancele — assim ninguém recebe uma campanha cancelada.',
      );
    }

    if (alvo.status === 'rascunho') {
      await this.ctx.db
        .delete(campanha)
        .where(and(eq(campanha.id, campanhaId), eq(campanha.contaId, contaId)));
      await this.auditar(contaId, usuarioId, campanhaId, 'campanha.excluida', { nome: alvo.nome });
      return { resultado: 'apagada' };
    }

    if (alvo.status === 'agendada' || alvo.status === 'pausada') {
      const cancelados = await this.ctx.db.execute(sql`
        with parados as (
          update campanha_destinatario
             set status = 'cancelado', atualizado_em = now()
           where campanha_id = ${campanhaId} and conta_id = ${contaId} and status = 'pendente'
          returning 1
        )
        select count(*)::int as total from parados
      `);

      await this.ctx.db
        .update(campanha)
        .set({ status: 'cancelada', pausaMotivo: null, concluidaEm: sql`now()` })
        .where(and(eq(campanha.id, campanhaId), eq(campanha.contaId, contaId)));

      await this.auditar(contaId, usuarioId, campanhaId, 'campanha.cancelada', {
        nome: alvo.nome,
        naoEnviados: Number((cancelados.rows[0] as { total: number } | undefined)?.total ?? 0),
      });
      return { resultado: 'cancelada' };
    }

    await this.ctx.db
      .update(campanha)
      .set({ arquivadaEm: sql`now()` })
      .where(and(eq(campanha.id, campanhaId), eq(campanha.contaId, contaId)));
    await this.auditar(contaId, usuarioId, campanhaId, 'campanha.arquivada', { nome: alvo.nome });
    return { resultado: 'arquivada' };
  }

  private async auditar(
    contaId: string,
    usuarioId: string,
    campanhaId: string,
    acao: string,
    detalhe: Record<string, unknown>,
  ): Promise<void> {
    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuarioId,
      acao,
      entidade: 'campanha',
      entidadeId: campanhaId,
      detalhe,
    });
  }

  /** Os limites precisam ser crescentes. O banco também barra, mas com erro de banco. */
  private conferirTetos(dia?: number | null, semana?: number | null, mes?: number | null): void {
    if (
      (dia && semana && dia > semana) ||
      (semana && mes && semana > mes) ||
      (dia && mes && dia > mes)
    ) {
      throw new BadRequestException(
        'Os limites precisam ser crescentes: o do dia não pode passar o da semana, nem o da semana o do mês.',
      );
    }
  }

  /**
   * Dispara a campanha — isto é, AGENDA.
   *
   * Nenhuma mensagem sai dentro deste request. A campanha vira `agendada` e o
   * worker a envia, rodada a rodada, respeitando janela, pausa e tetos.
   *
   * Duas razões para não enviar aqui, e as duas são defeitos que o envio
   * síncrono tinha:
   *
   * 1. Respeitar "só das 9 às 20" é impossível dentro do request: se a janela
   *    está fechada, alguém precisa enviar depois.
   * 2. O request segurava uma conexão de banco durante TODAS as chamadas à
   *    Meta. Com dez destinatários era tolerável; numa campanha de verdade, é
   *    o que esgota o pool e derruba o painel de todas as contas.
   *
   * Tudo que pode falhar de forma previsível é conferido AGORA, para o cliente
   * receber o erro na tela e não descobrir uma campanha parada horas depois.
   */
  async disparar(
    contaId: string,
    usuarioId: string,
    campanhaId: string,
  ): Promise<ResumoCampanha> {
    const alvo = await this.buscar(contaId, campanhaId);

    if (alvo.status !== 'rascunho') {
      // Disparar de novo reenviaria para quem já recebeu. Mensagem duplicada
      // queima o destinatário e cobra outra vez.
      throw new BadRequestException(
        `Esta campanha já foi disparada (está "${alvo.status}"). Crie outra para enviar de novo.`,
      );
    }

    const credencial = await this.meta.tokenDaConta(contaId);
    if (!credencial) {
      throw new BadRequestException('Conecte sua conta do WhatsApp antes de disparar.');
    }

    // Falha cedo: sem número registrado a campanha ficaria agendada para sempre.
    await this.numeroDeEnvio(contaId);

    // E sem disparos no plano, ela pausaria na primeira rodada. Melhor dizer já.
    if (await motivoDeBloqueio(this.ctx.db, contaId)) {
      throw new BadRequestException(MENSAGEM_INADIMPLENTE);
    }
    const saldo = await saldoDoPlano(this.ctx.db, contaId);
    if (saldo !== null && saldo <= 0) {
      throw new BadRequestException(MENSAGEM_SEM_SALDO);
    }

    await this.ctx.db
      .update(campanha)
      .set({ status: 'agendada', iniciadaEm: new Date() })
      .where(eq(campanha.id, campanhaId));

    const [{ total }] = await this.ctx.db
      .select({ total: count(campanhaDestinatario.id) })
      .from(campanhaDestinatario)
      .where(eq(campanhaDestinatario.campanhaId, campanhaId));

    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuarioId,
      acao: 'campanha.disparada',
      entidade: 'campanha',
      entidadeId: campanhaId,
      detalhe: { destinatarios: Number(total), modelo: alvo.modeloNome },
    });

    return this.detalhe(contaId, campanhaId);
  }

  /**
   * Retoma uma campanha pausada.
   *
   * A campanha pausa quando a conexão com o WhatsApp cai no meio do envio. Os
   * destinatários que faltavam voltaram para a fila, intactos — e é isto que
   * os coloca de volta para andar.
   *
   * Confere a conexão ANTES de reagendar. Retomar sem ela só pausaria de novo
   * na rodada seguinte, e o cliente veria o botão "funcionar" e nada sair.
   */
  async retomar(contaId: string, usuarioId: string, campanhaId: string): Promise<ResumoCampanha> {
    const alvo = await this.buscar(contaId, campanhaId);

    if (alvo.status !== 'pausada') {
      throw new BadRequestException(`Só dá para retomar uma campanha pausada — esta está "${alvo.status}".`);
    }

    const credencial = await this.meta.tokenDaConta(contaId);
    if (!credencial) {
      throw new BadRequestException('Reconecte o WhatsApp antes de retomar: a conexão ainda está fora.');
    }
    await this.numeroDeEnvio(contaId);

    if (await motivoDeBloqueio(this.ctx.db, contaId)) {
      throw new BadRequestException(MENSAGEM_INADIMPLENTE);
    }
    const saldo = await saldoDoPlano(this.ctx.db, contaId);
    if (saldo !== null && saldo <= 0) {
      throw new BadRequestException(MENSAGEM_SEM_SALDO);
    }

    await this.ctx.db
      .update(campanha)
      .set({ status: 'agendada', pausaMotivo: null })
      .where(and(eq(campanha.id, campanhaId), eq(campanha.status, 'pausada')));

    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuarioId,
      acao: 'campanha.retomada',
      entidade: 'campanha',
      entidadeId: campanhaId,
      detalhe: { modelo: alvo.modeloNome },
    });

    return this.detalhe(contaId, campanhaId);
  }

  // ----------------------------------------------------------------- worker
  //
  // Tudo daqui para baixo roda FORA de request, chamado pelo worker. Não há
  // contexto de banco pronto: cada acesso abre o próprio, curto. E nenhuma
  // transação fica aberta durante uma chamada à Meta.

  /** Campanhas com trabalho pendente. Escopo de sistema: o worker não é conta nenhuma. */
  async campanhasAtivas(): Promise<string[]> {
    return this.ctx.comEscopoSistema('campanha.worker.listar', async (db) => {
      const linhas = await db
        .select({ id: campanha.id })
        .from(campanha)
        .where(inArray(campanha.status, [...ESTADOS_ATIVOS]))
        .limit(200);
      return linhas.map((l) => l.id);
    });
  }

  /**
   * Uma rodada de uma campanha.
   *
   * O passo que mais importa é a reivindicação com `FOR UPDATE SKIP LOCKED`.
   * Duas réplicas da API — ou duas rodadas sobrepostas — podem olhar a mesma
   * campanha ao mesmo tempo; sem o lock, as duas pegariam os mesmos
   * destinatários e cada pessoa receberia a mensagem duas vezes, cobrada duas
   * vezes. Com ele, a segunda pula o que a primeira já pegou. É o lock do
   * próprio Postgres: não precisa de Redis para isto.
   */
  async processarRodada(campanhaId: string, agora = new Date()): Promise<void> {
    const estado = await this.ctx.comEscopoSistema('campanha.worker.ler', async (db) => {
      const [linha] = await db
        .select({
          id: campanha.id,
          contaId: campanha.contaId,
          nome: campanha.nome,
          status: campanha.status,
          modeloNome: campanha.modeloNome,
          modeloIdioma: campanha.modeloIdioma,
          janelaDias: campanha.janelaDias,
          janelaInicio: campanha.janelaInicio,
          janelaFim: campanha.janelaFim,
          pausaSegundos: campanha.pausaSegundos,
          maxPorDia: campanha.maxPorDia,
          maxPorSemana: campanha.maxPorSemana,
          maxPorMes: campanha.maxPorMes,
          retomarEm: campanha.retomarEm,
          descansoDias: campanha.descansoDias,
          variaveisLista: campanha.variaveisLista,
          fuso: conta.timezone,
          // O ciclo em que o disparo conta. É o MESMO campo que a tela de Conta
          // usa para ler o consumo — duas definições de ciclo divergiriam.
          cicloInicio: assinatura.cicloInicio,
        })
        .from(campanha)
        .innerJoin(conta, eq(conta.id, campanha.contaId))
        .leftJoin(assinatura, eq(assinatura.contaId, campanha.contaId))
        .where(eq(campanha.id, campanhaId))
        .limit(1);

      if (!linha) return null;

      // Os períodos são contados no FUSO DA CONTA. "Hoje" em UTC começa às 21h
      // de São Paulo — o teto diário zeraria no meio da noite do cliente.
      const contagem = await db.execute(sql`
        select
          count(*) filter (where enviada_em >= date_trunc('day',   now() at time zone ${linha.fuso}) at time zone ${linha.fuso}) as dia,
          count(*) filter (where enviada_em >= date_trunc('week',  now() at time zone ${linha.fuso}) at time zone ${linha.fuso}) as semana,
          count(*) filter (where enviada_em >= date_trunc('month', now() at time zone ${linha.fuso}) at time zone ${linha.fuso}) as mes,
          max(enviada_em) as ultimo
        from campanha_destinatario
        where campanha_id = ${campanhaId} and enviada_em is not null
      `);

      return { campanha: linha, contagem: contagem.rows[0] as Record<string, unknown> };
    });

    if (!estado || !ESTADOS_ATIVOS.includes(estado.campanha.status as (typeof ESTADOS_ATIVOS)[number])) {
      return;
    }

    const c = estado.campanha;

    // A Meta pediu calma (130429, 80007): a campanha espera até lá, sem pausar.
    if (c.retomarEm && c.retomarEm > agora) return;

    const regra: RegraDeEnvio = {
      janelaDias: (c.janelaDias as number[] | null) ?? [],
      janelaInicio: c.janelaInicio,
      janelaFim: c.janelaFim,
      pausaSegundos: c.pausaSegundos,
      maxPorDia: c.maxPorDia,
      maxPorSemana: c.maxPorSemana,
      maxPorMes: c.maxPorMes,
    };

    const ultimo = estado.contagem.ultimo ? new Date(String(estado.contagem.ultimo)) : null;
    const decisao = decidir(
      regra,
      momentoNoFuso(agora, c.fuso),
      {
        dia: Number(estado.contagem.dia ?? 0),
        semana: Number(estado.contagem.semana ?? 0),
        mes: Number(estado.contagem.mes ?? 0),
      },
      ultimo,
      agora,
      LOTE_POR_RODADA,
    );

    if (!decisao.pode) return;

    // Reivindicação atômica. `SKIP LOCKED` é o que impede envio duplicado.
    let pausadaPor: 'inadimplencia' | 'teto_plano' | null = null;
    const reivindicados = await this.ctx.comEscopoSistema('campanha.worker.reivindicar', async (db) => {
      // Quem pediu para sair DEPOIS de a campanha ser montada não recebe. A
      // conferência é feita aqui, na hora do envio, e não só na montagem: entre
      // montar e a janela abrir podem passar dias. Mandar para quem já pediu
      // para sair viola a política da Meta e derruba a qualidade do número.
      await marcarDescadastrados(db, c.contaId, sql`d.campanha_id = ${campanhaId}`);
      await marcarSemWhatsappNaFila(db, c.contaId, sql`d.campanha_id = ${campanhaId}`);
      // Campanha que fala do cashback: quem usou ou perdeu o saldo depois da
      // montagem não recebe, e quem ainda tem recebe o valor de hoje.
      const variaveis = lerVariaveis(c.variaveisLista);
      if (variaveis && usaCashback(variaveis)) {
        await conferirCashbackDaFila(db, c.contaId, campanhaId, variaveis, hojeNoFuso(c.fuso));
      }

      // Teto do PLANO (disparos por ciclo), somado de todas as campanhas da
      // conta. A trava por conta serializa as rodadas de campanhas diferentes da
      // mesma conta: sem ela, duas campanhas leriam o mesmo saldo e as duas
      // gastariam — e o cliente passaria do que pagou.
      await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`regemcast.teto.${c.contaId}`}))`);
      // Conta inadimplente depois da carência: nada sai, a campanha pausa e
      // volta sozinha quando o pagamento for confirmado.
      if (await motivoDeBloqueio(db, c.contaId)) {
        const r = await db.execute(sql`
          update campanha set status = 'pausada', pausa_motivo = 'inadimplencia'
           where id = ${campanhaId} and status in ('agendada', 'enviando')
          returning id
        `);
        if (r.rows?.length) pausadaPor = 'inadimplencia';
        return null;
      }

      const saldo = await saldoDoPlano(db, c.contaId);

      if (saldo !== null && saldo <= 0) {
        // Os destinatários ficam na fila, intactos. A campanha volta sozinha
        // quando o ciclo virar ou o plano mudar.
        const r = await db.execute(sql`
          update campanha set status = 'pausada', pausa_motivo = 'teto_plano'
           where id = ${campanhaId} and status in ('agendada', 'enviando')
          returning id
        `);
        if (r.rows?.length) pausadaPor = 'teto_plano';
        return null;
      }

      // Limite da META (pessoas diferentes por 24 h). Cheio, a rodada não pega
      // ninguém — e a campanha NÃO pausa: quando a janela de 24 h abre vaga,
      // ela continua sozinha. A tela mostra até quando (`espera` no resumo).
      // Dentro da mesma trava por conta: duas campanhas não gastam a mesma vaga.
      const meta = await capacidadeDaMeta(db, c.contaId);
      const cabeNaMeta = meta === null ? null : Math.max(0, meta.limite - meta.usados);
      if (cabeNaMeta === 0) return [];

      let limite = decisao.quantas;
      if (saldo !== null) limite = Math.min(limite, saldo);
      if (cabeNaMeta !== null) limite = Math.min(limite, cabeNaMeta);

      /*
       * A reserva em DUAS etapas, com a primeira MATERIALIZADA. A forma antiga
       * — `update … where id in (select … for update skip locked limit N)` —
       * reservava MAIS que N: com a RLS ligada, o planejador escolhe um nested
       * loop e reexecuta o `select` para cada linha da tabela, e cada
       * reexecução pula a linha que o próprio comando acabou de mudar e pega a
       * seguinte. Pedia 1, marcava a fila inteira — e o lote da rodada, o teto
       * do plano, o ritmo e o limite da Meta viravam enfeite. Medido no banco,
       * com o papel da aplicação.
       *
       * Quem a Meta recusou por ritmo ou instabilidade volta só na hora marcada.
       */
      //
      // Descanso: dos reservados, quem recebeu marketing de OUTRA campanha nos
      // últimos N dias vira `descanso` — não sai, não é falha, não conta no
      // plano. Dentro da mesma trava por conta, então duas campanhas da conta
      // não mandam para a mesma pessoa na mesma rodada. Só é conferido para os
      // reservados (no máximo o lote), nunca para a fila inteira.
      const dias = c.descansoDias ?? 0;
      const descanso =
        dias > 0
          ? sql`, descanso as (
              update campanha_destinatario d
                 set status = 'descanso',
                     erro_titulo = ${TITULO_DESCANSO},
                     erro_detalhe = ${`Recebeu outra campanha de marketing há menos de ${dias} ${dias === 1 ? 'dia' : 'dias'}. Nada foi enviado, e não contou no plano.`},
                     atualizado_em = now()
                from alvo
               where d.id = alvo.id
                 and ${recebeuMarketingRecente(sql`d.conta_id`, sql`d.telefone_e164`, dias, sql`d.campanha_id`)}
              returning d.id
            )`
          : sql``;
      const r = await db.execute(sql`
        with alvo as materialized (
          select id from campanha_destinatario
           where campanha_id = ${campanhaId} and status = 'pendente'
             and (proxima_tentativa_em is null or proxima_tentativa_em <= now())
           order by criado_em
           for update skip locked
           limit ${limite}
        )${descanso}
        update campanha_destinatario d
           set status = 'enviando', atualizado_em = now()
          from alvo
         where d.id = alvo.id
           ${dias > 0 ? sql`and d.id not in (select id from descanso)` : sql``}
        returning d.id, d.telefone_e164, d.variaveis, d.tentativas
      `);
      return r.rows as { id: string; telefone_e164: string; variaveis: unknown; tentativas: number | null }[];
    });

    if (reivindicados === null) {
      this.log.log(`Campanha ${campanhaId} pausada: a conta ${c.contaId} está sem disparos no plano ou com o pagamento atrasado.`);
      if (pausadaPor === 'teto_plano') {
        void this.avisos.avisar(c.contaId, 'campanhas', {
          titulo: `Campanha pausada: ${c.nome}`,
          corpo: 'Os disparos do seu plano acabaram neste ciclo. Quem faltava continua na fila e sai quando o ciclo virar ou com um plano maior.',
          dados: { campanhaId },
        });
      } else if (pausadaPor === 'inadimplencia') {
        void this.avisos.avisar(c.contaId, 'campanhas', {
          titulo: `Campanha pausada: ${c.nome}`,
          corpo: 'O pagamento do plano está pendente. A campanha volta sozinha quando o pagamento for confirmado.',
          dados: { campanhaId },
        });
      }
      return;
    }

    if (!reivindicados.length) {
      await this.concluirSeTerminou(campanhaId);
      return;
    }

    await this.ctx.comEscopoSistema('campanha.worker.iniciar', (db) =>
      db
        .update(campanha)
        .set({ status: 'enviando' })
        .where(and(eq(campanha.id, campanhaId), eq(campanha.status, 'agendada'))),
    );

    // Credencial lida agora, e não guardada do disparo: o token pode ter vencido
    // entre o agendamento e esta rodada.
    const acesso = await this.ctx.comConta(c.contaId, async () => {
      const credencial = await this.meta.tokenDaConta(c.contaId);
      const [numero] = await this.ctx.db
        .select({ phoneNumberId: waNumero.phoneNumberId })
        .from(waNumero)
        .where(and(eq(waNumero.contaId, c.contaId), eq(waNumero.status, 'registrado')))
        .limit(1);
      return { credencial, phoneNumberId: numero?.phoneNumberId ?? null };
    });

    if (!acesso.credencial || !acesso.phoneNumberId) {
      // A conexão caiu entre o disparo e agora. Os destinatários VOLTAM para a
      // fila — não é culpa deles, e queimá-los como "falhou" seria perder a
      // campanha por um token vencido. A campanha pausa, para não girar em
      // falso a cada rodada.
      const pausou = await this.ctx.comEscopoSistema('campanha.worker.pausar', async (db) => {
        await db
          .update(campanhaDestinatario)
          .set({ status: 'pendente' })
          .where(inArray(campanhaDestinatario.id, reivindicados.map((d) => d.id)));
        const r = await db
          .update(campanha)
          .set({ status: 'pausada', pausaMotivo: 'conexao' })
          .where(and(eq(campanha.id, campanhaId), inArray(campanha.status, [...ESTADOS_ATIVOS])))
          .returning({ id: campanha.id });
        return r.length > 0;
      });

      this.log.warn(
        `Campanha ${campanhaId} pausada: a conta ${c.contaId} perdeu a conexão com a Meta antes do envio.`,
      );
      if (pausou) {
        void this.avisos.avisar(c.contaId, 'campanhas', {
          titulo: `Campanha pausada: ${c.nome}`,
          corpo: 'A conexão com o WhatsApp caiu antes de terminar. Reconecte pelo site e retome a campanha.',
          dados: { campanhaId },
        });
      }
      return;
    }

    for (let i = 0; i < reivindicados.length; i++) {
      const d = reivindicados[i]!;
      const resultado = await this.enviarUm(
        c.contaId,
        { id: d.id, telefone: d.telefone_e164, variaveis: d.variaveis, tentativas: Number(d.tentativas ?? 0) },
        c,
        acesso.phoneNumberId,
        acesso.credencial.token,
        c.cicloInicio,
        campanhaId,
      );
      // A Meta pediu calma: continuar a rodada seria bater no mesmo muro com
      // os próximos. Eles voltam para a fila e a campanha espera.
      if (resultado.tipo === 'desacelerar') {
        await this.desacelerar(campanhaId, reivindicados.slice(i + 1).map((r) => r.id), resultado.esperaSegundos);
        return;
      }
    }

    await this.concluirSeTerminou(campanhaId);
  }

  /**
   * A Meta recusou por ritmo (130429) ou teto de chamadas (80007): a campanha
   * espera o tempo pedido. Não é pausa — ninguém precisa retomar, e nenhum
   * destinatário é queimado: os que a rodada já tinha pego voltam para a fila
   * como estavam.
   */
  private async desacelerar(campanhaId: string, restantes: string[], esperaSegundos: number): Promise<void> {
    await this.ctx.comEscopoSistema('campanha.worker.desacelerar', async (db) => {
      await db
        .update(campanha)
        .set({ retomarEm: sql`now() + make_interval(secs => ${esperaSegundos})` })
        .where(eq(campanha.id, campanhaId));
      if (restantes.length) {
        await db
          .update(campanhaDestinatario)
          .set({ status: 'pendente' })
          .where(and(inArray(campanhaDestinatario.id, restantes), eq(campanhaDestinatario.status, 'enviando')));
      }
    });
    this.log.warn(`Campanha ${campanhaId}: a Meta pediu para desacelerar. Continua em ${esperaSegundos} s.`);
  }

  /**
   * Destinatários presos em `enviando`.
   *
   * Acontece quando o processo cai DEPOIS de reivindicar e ANTES de gravar o
   * resultado. A pergunta é o que fazer com eles, e a resposta é deliberada:
   * **viram `falhou`, e nunca voltam para `pendente` sozinhos.**
   *
   * Porque não dá para saber se a Meta recebeu. Se o processo caiu depois de a
   * Meta aceitar e antes de gravarmos o `wamid`, reenviar entregaria a mesma
   * mensagem duas vezes — cobrada duas vezes, na pessoa que talvez já tenha
   * lido a primeira. Entre perder uma mensagem e duplicá-la, numa campanha de
   * marketing, perder é o erro mais barato. E fica registrado, com motivo.
   */
  async recuperarPresos(): Promise<number> {
    return this.ctx.comEscopoSistema('campanha.worker.presos', async (db) => {
      const r = await db.execute(sql`
        update campanha_destinatario
           set status = 'falhou',
               falhou_em = now(),
               erro_titulo = 'Envio interrompido',
               erro_detalhe = 'O envio foi interrompido e não dá para saber se a mensagem chegou. Para não correr o risco de enviar duas vezes, ela não foi reenviada.'
         where status = 'enviando'
           and atualizado_em < now() - make_interval(mins => ${MINUTOS_PRESO})
        returning id
      `);
      return r.rows.length;
    });
  }

  /** Conclui a campanha quando não sobra ninguém para enviar — e avisa, uma vez só. */
  private async concluirSeTerminou(campanhaId: string): Promise<void> {
    const concluida = await this.ctx.comEscopoSistema('campanha.worker.concluir', async (db) => {
      const [{ restam }] = await db
        .select({ restam: count(campanhaDestinatario.id) })
        .from(campanhaDestinatario)
        .where(
          and(
            eq(campanhaDestinatario.campanhaId, campanhaId),
            inArray(campanhaDestinatario.status, ['pendente', 'enviando']),
          ),
        );

      if (Number(restam) !== 0) return null;
      // `returning` só devolve linha na rodada que de fato concluiu: duas
      // rodadas terminando juntas não mandam o aviso duas vezes.
      const [linha] = await db
        .update(campanha)
        .set({ status: 'concluida', concluidaEm: new Date() })
        .where(and(eq(campanha.id, campanhaId), inArray(campanha.status, [...ESTADOS_ATIVOS])))
        .returning({ contaId: campanha.contaId, nome: campanha.nome });
      if (!linha) return null;

      const r = await db.execute(sql`
        select count(*) filter (where status in ('enviada', 'entregue', 'lida')) as saiu,
               count(*) filter (where status = 'falhou') as falhou
          from campanha_destinatario where campanha_id = ${campanhaId}
      `);
      const t = (r.rows?.[0] ?? {}) as { saiu?: unknown; falhou?: unknown };
      return { ...linha, saiu: Number(t.saiu ?? 0), falhou: Number(t.falhou ?? 0) };
    });

    if (concluida) {
      const falhas = concluida.falhou > 0 ? ` ${concluida.falhou} não ${concluida.falhou === 1 ? 'chegou' : 'chegaram'}.` : '';
      void this.avisos.avisar(concluida.contaId, 'campanhas', {
        titulo: `Campanha concluída: ${concluida.nome}`,
        corpo: `${concluida.saiu.toLocaleString('pt-BR')} ${concluida.saiu === 1 ? 'mensagem saiu' : 'mensagens saíram'}.${falhas} Toque para ver o resultado.`,
        dados: { campanhaId },
      });
    }
  }

  /**
   * Envia para um destinatário e grava o resultado, seja qual for.
   *
   * Cada destinatário é tratado isoladamente: uma falha não interrompe os
   * outros, e o motivo real fica gravado na linha dele. A gravação abre uma
   * transação curta DEPOIS da chamada à Meta — nunca uma que fique aberta
   * durante ela.
   */
  private async enviarUm(
    contaId: string,
    destinatario: { id: string; telefone: string; variaveis: unknown; tentativas?: number },
    alvo: { modeloNome: string; modeloIdioma: string },
    phoneNumberId: string,
    token: string,
    cicloInicio: Date | null,
    campanhaId: string,
  ): Promise<ResultadoEnvio> {
    const variaveis = Array.isArray(destinatario.variaveis)
      ? destinatario.variaveis.map((v) => String(v))
      : [];

    try {
      const wamid = await this.graph.enviarModelo(
        phoneNumberId,
        {
          para: destinatario.telefone,
          modelo: alvo.modeloNome,
          idioma: alvo.modeloIdioma,
          variaveis,
        },
        token,
      );

      /*
       * "enviada", não "entregue". A Meta aceitou e devolveu um identificador;
       * se chegou ao aparelho, quem diz é o webhook. Chamar isto de entregue é
       * a mentira que faz a campanha do Regem marcar 100% de sucesso.
       */
      /*
       * O status e o contador na MESMA transação. Separados, uma queda entre os
       * dois deixaria mensagem enviada sem contar (a cobrança perde) ou contada
       * sem enviar (o cliente paga pelo que não saiu).
       *
       * Até esta mudança, `uso_ciclo.disparos` NUNCA era incrementado: a tela
       * de Conta mostrava consumo zero para sempre, e a cobrança por faixa de
       * disparos não tinha contador.
       *
       * O upsert com `disparos + 1` é atômico no Postgres: dez envios
       * simultâneos somam dez, e não um — que é o que um "ler, somar, gravar"
       * em código faria.
       */
      await this.ctx.comConta(contaId, async (db) => {
        await db
          .update(campanhaDestinatario)
          .set({ status: 'enviada', waMessageId: wamid, enviadaEm: new Date() })
          .where(eq(campanhaDestinatario.id, destinatario.id));

        if (cicloInicio) {
          await db.execute(sql`
            insert into uso_ciclo (conta_id, ciclo_inicio, disparos)
            values (${contaId}, ${cicloInicio}, 1)
            on conflict (conta_id, ciclo_inicio)
            do update set disparos = uso_ciclo.disparos + 1, atualizado_em = now()
          `);
        }
      });
      return { tipo: 'enviada' };
    } catch (erro) {
      const g = erro instanceof ErroGraph ? erro : null;
      const detalhe = g ? g.detalheParaLog : String(erro);

      this.log.warn(`Falha ao enviar para ${this.mascarar(destinatario.telefone)}: ${detalhe}`);

      // Sem o telefone: a telemetria agrupa por conta e código, e não precisa
      // saber para quem era a mensagem.
      void this.telemetria.registrar({
        contaId,
        origem: 'meta',
        classe: g?.classe ?? null,
        codigo: g?.codigo ?? null,
        status: g?.status ?? null,
        mensagem: detalhe,
        detalhe: { campanhaId, traceId: g?.traceId ?? null },
      });

      /*
       * A Meta RESPONDEU recusando (status > 0) por ritmo ou instabilidade:
       * ela não aceitou a mensagem, então tentar de novo não duplica nada.
       * Rede caída ou tempo esgotado (status 0) é outra história — não dá para
       * saber se a mensagem chegou, e reenviar poderia entregar duas vezes.
       */
      const feitas = destinatario.tentativas ?? 0;
      if (g && g.status > 0 && g.retentavel && feitas < MAX_TENTATIVAS_ENVIO) {
        const espera = esperaDaNovaTentativa(g.traduzido.esperaSegundos, feitas);
        await this.ctx.comConta(contaId, (db) =>
          db
            .update(campanhaDestinatario)
            .set({
              status: 'pendente',
              tentativas: feitas + 1,
              proximaTentativaEm: new Date(Date.now() + espera * 1_000),
            })
            .where(eq(campanhaDestinatario.id, destinatario.id)),
        );
        return g.codigo !== null && DESACELERA.has(g.codigo)
          ? { tipo: 'desacelerar', esperaSegundos: espera }
          : { tipo: 'nova_tentativa' };
      }

      await this.ctx.comConta(contaId, async (db) => {
        await db
          .update(campanhaDestinatario)
          .set({
            status: 'falhou',
            falhouEm: new Date(),
            erroCodigo: g?.codigo ?? null,
            erroTitulo: g?.traduzido.titulo ?? 'Falha no envio',
            // A explicação é o que a tela mostra; o detalhe técnico fica no log.
            erroDetalhe: detalheDaFalha(g, feitas),
          })
          .where(eq(campanhaDestinatario.id, destinatario.id));
        // Número sem WhatsApp em duas campanhas: sai sozinho dos próximos envios.
        if (g?.codigo === ERRO_SEM_WHATSAPP) await registrarFalhaSemWhatsapp(db, contaId, destinatario.telefone);
      });
      return { tipo: 'falhou' };
    }
  }

  /** Número registrado da conta. Sem ele não há de onde enviar. */
  private async numeroDeEnvio(contaId: string): Promise<string> {
    const [numero] = await this.ctx.db
      .select({ phoneNumberId: waNumero.phoneNumberId, status: waNumero.status })
      .from(waNumero)
      .where(and(eq(waNumero.contaId, contaId), eq(waNumero.status, 'registrado')))
      .limit(1);

    if (!numero) {
      throw new BadRequestException(
        'Nenhum número pronto para enviar. Conclua a conexão do WhatsApp antes de disparar.',
      );
    }
    return numero.phoneNumberId;
  }

  /**
   * Antes de montar: quantos do público podem receber, quantos estão em
   * descanso hoje e em que período do dia costumam pedir — uma consulta, com a
   * MESMA regra que a montagem usa (`origem-do-publico.ts`), para lista ou
   * público da base. O descanso só vale para modelo de marketing: a tela só o
   * mostra nesse caso, e o envio confere de novo na hora de mandar.
   */
  async previaDoPublico(
    contaId: string,
    pedido: PedidoDeOrigem & { soComCashback?: boolean },
  ): Promise<PreviaDoPublico> {
    return this.ctx.comConta(contaId, async (db) => {
      const o = await origemDoPublico(db, contaId, pedido);
      // Mensagem com variável de cashback só vai para quem tem cashback válido:
      // a prévia conta como a montagem vai montar, e diz de quantos do público.
      const comCashback = Boolean(pedido.soComCashback);
      const quemPode = sql`contato.conta_id = ${contaId}
           and contato.opt_out = false
           and contato.sem_whatsapp_em is null
           and ${o.filtro}`;
      const [config] = await db
        .select({ dias: conta.descansoMarketingDias })
        .from(conta)
        .where(eq(conta.id, contaId))
        .limit(1);
      const dias = config?.dias ?? 0;
      const emDescanso =
        dias > 0
          ? sql`count(*) filter (where ${recebeuMarketingRecente(sql`contato.conta_id`, sql`contato.telefone_e164`, dias)})::int`
          : sql`0`;
      const periodos = PERIODOS.map(
        (p) => sql`count(*) filter (where contato.periodo_preferido = ${p})::int as ${sql.identifier(p)}`,
      );
      const r = await db.execute(sql`
        select count(*)::int as total, ${emDescanso} as em_descanso, ${sql.join(periodos, sql`, `)}
               ${comCashback ? sql`, (select count(*)::int from contato where ${quemPode}) as do_publico` : sql``}
          from contato
         where ${quemPode}
           ${comCashback ? sql`and ${cashbackValido('contato', hojeDaConta(contaId))}` : sql``}
      `);
      const linha = (r.rows[0] ?? {}) as Record<string, number | string | null>;
      const total = Number(linha.total ?? 0);
      const contagem = Object.fromEntries(PERIODOS.map((p) => [p, Number(linha[p] ?? 0)])) as Record<Periodo, number>;
      return {
        total,
        descanso: { dias, emDescanso: Number(linha.em_descanso ?? 0) },
        horario: sugerirHorario(total, contagem),
        cashback: comCashback ? { doPublico: Number(linha.do_publico ?? 0) } : null,
      };
    });
  }

  async listar(contaId: string): Promise<ResumoCampanha[]> {
    const linhas = await this.ctx.db
      .select()
      .from(campanha)
      .where(and(eq(campanha.contaId, contaId), isNull(campanha.arquivadaEm)))
      .orderBy(desc(campanha.criadoEm))
      .limit(100);

    return this.comContagens(linhas);
  }

  async detalhe(contaId: string, campanhaId: string): Promise<ResumoCampanha> {
    const [resumo] = await this.comContagens([await this.buscar(contaId, campanhaId)]);
    return resumo;
  }

  /**
   * Destinatários de uma campanha, com o que aconteceu com cada um.
   *
   * No máximo os 500 primeiros, com as FALHAS na frente — são elas que pedem
   * ação. Uma campanha de 50 mil pessoas não cabe numa resposta; os totais por
   * situação vêm do resumo, que conta tudo.
   */
  async destinatarios(contaId: string, campanhaId: string) {
    await this.buscar(contaId, campanhaId);

    return this.ctx.db
      .select({
        id: campanhaDestinatario.id,
        telefone: campanhaDestinatario.telefoneE164,
        status: campanhaDestinatario.status,
        erroTitulo: campanhaDestinatario.erroTitulo,
        erroDetalhe: campanhaDestinatario.erroDetalhe,
        enviadaEm: campanhaDestinatario.enviadaEm,
        entregueEm: campanhaDestinatario.entregueEm,
        lidaEm: campanhaDestinatario.lidaEm,
        falhouEm: campanhaDestinatario.falhouEm,
      })
      .from(campanhaDestinatario)
      .where(eq(campanhaDestinatario.campanhaId, campanhaId))
      .orderBy(sql`(${campanhaDestinatario.status} = 'falhou') desc`, campanhaDestinatario.criadoEm)
      .limit(LIMITE_DESTINATARIOS_TELA);
  }

  private async buscar(contaId: string, campanhaId: string) {
    const [achada] = await this.ctx.db
      .select()
      .from(campanha)
      .where(and(eq(campanha.id, campanhaId), eq(campanha.contaId, contaId)))
      .limit(1);

    // 404 e não 403: dizer "existe, mas não é sua" confirma a existência do id
    // para quem está sondando. A RLS já filtraria, mas o `where` explícito
    // deixa a intenção visível para quem lê.
    if (!achada) throw new NotFoundException('Campanha não encontrada.');
    return achada;
  }

  /**
   * Junta a campanha à contagem por status.
   *
   * Contado na hora, do banco. Contador guardado precisa ser mantido no envio e
   * no webhook, e o dia em que um dos dois falha o número na tela mente sem
   * ninguém perceber.
   */
  private async comContagens(campanhas: (typeof campanha.$inferSelect)[]): Promise<ResumoCampanha[]> {
    if (!campanhas.length) return [];
    const ids = campanhas.map((c) => c.id);

    // Duas queries para a lista inteira, e não duas por campanha.
    const linhas = await this.ctx.db
      .select({ campanhaId: campanhaDestinatario.campanhaId, status: campanhaDestinatario.status, quantos: count() })
      .from(campanhaDestinatario)
      .where(inArray(campanhaDestinatario.campanhaId, ids))
      .groupBy(campanhaDestinatario.campanhaId, campanhaDestinatario.status);

    const respostas = await this.ctx.db
      .select({ campanhaId: campanhaDestinatario.campanhaId, quantas: count() })
      .from(campanhaDestinatario)
      .where(and(inArray(campanhaDestinatario.campanhaId, ids), sql`${campanhaDestinatario.respondidaEm} is not null`))
      .groupBy(campanhaDestinatario.campanhaId);
    const respondidas = new Map(respostas.map((r) => [r.campanhaId, Number(r.quantas)]));

    const idsListas = [...new Set(campanhas.map((c) => c.listaId).filter((v): v is string => Boolean(v)))];
    const listas = idsListas.length
      ? await this.ctx.db
          .select({ id: contatoLista.id, nome: contatoLista.nome })
          .from(contatoLista)
          .where(inArray(contatoLista.id, idsListas))
      : [];
    const nomeDaLista = new Map(listas.map((l) => [l.id, l.nome]));

    // O limite da Meta é da CONTA: uma leitura serve a todas as campanhas
    // ativas da lista. Sem campanha ativa, nem pergunta.
    const ativas = campanhas.some((c) => ESTADOS_ATIVOS.includes(c.status as (typeof ESTADOS_ATIVOS)[number]));
    const meta = ativas ? await capacidadeDaMeta(this.ctx.db, campanhas[0]!.contaId) : null;
    const metaCheia = meta && meta.usados >= meta.limite ? meta : null;
    const agora = new Date();

    return campanhas.map((c) => {
      const porStatus: Record<string, number> = {};
      let total = 0;
      for (const l of linhas) {
        if (l.campanhaId !== c.id) continue;
        porStatus[l.status] = Number(l.quantos);
        total += Number(l.quantos);
      }

      let espera: EsperaDaCampanha | null = null;
      if (ESTADOS_ATIVOS.includes(c.status as (typeof ESTADOS_ATIVOS)[number])) {
        if (c.retomarEm && c.retomarEm > agora) espera = { motivo: 'ritmo', ate: c.retomarEm, limite: null };
        else if (metaCheia) espera = { motivo: 'limite_meta', ate: metaCheia.liberaEm, limite: metaCheia.limite };
      }

      return this.montarResumo(
        c,
        porStatus,
        total,
        c.listaId ? (nomeDaLista.get(c.listaId) ?? null) : null,
        espera,
        respondidas.get(c.id) ?? 0,
      );
    });
  }

  private montarResumo(
    c: typeof campanha.$inferSelect,
    porStatus: Record<string, number>,
    total: number,
    listaNome: string | null,
    espera: EsperaDaCampanha | null = null,
    respondidas = 0,
  ): ResumoCampanha {
    return {
      id: c.id,
      nome: c.nome,
      modeloNome: c.modeloNome,
      modeloIdioma: c.modeloIdioma,
      status: c.status,
      pausaMotivo: c.status === 'pausada' ? c.pausaMotivo : null,
      criadoEm: c.criadoEm,
      iniciadaEm: c.iniciadaEm,
      concluidaEm: c.concluidaEm,
      porStatus,
      total,
      listaNome,
      modeloCategoria: c.modeloCategoria ?? null,
      publicoOrigem: c.publicoOrigem ?? null,
      publicoRotulo: c.publicoRotulo ?? null,
      modeloId: c.modeloId,
      listaId: c.listaId,
      janelaDias: (c.janelaDias as number[] | null) ?? [],
      janelaInicio: c.janelaInicio,
      janelaFim: c.janelaFim,
      pausaSegundos: c.pausaSegundos,
      maxPorDia: c.maxPorDia,
      maxPorSemana: c.maxPorSemana,
      maxPorMes: c.maxPorMes,
      espera,
      respondidas,
      descansoDias: c.descansoDias ?? null,
    };
  }

  /** Telefone nunca vai inteiro para o log. */
  private mascarar(valor: string): string {
    return valor.length <= 4 ? '••••' : `••••${valor.slice(-4)}`;
  }
}
