/**
 * A aprovação de disparos (Hub DMS, F5 parte B): o pedido, a decisão de uma
 * pessoa da conta e a execução, uma vez.
 *
 * Quem pede é outro produto da DMS, pela porta MCP (`mcp.aprovacao.ts`); quem
 * decide é o dono, ou quem ele autorizou, na tela (`aprovacao.controller.ts`),
 * com o código do aplicativo autenticador; quem executa é este serviço, com o
 * MESMO disparo da tela (`CampanhaService.disparar`). As situações, o prazo, o
 * resumo do plano e as conferências são as do pacote comum (seção 11); o
 * desenho e o porquê estão em `docs/aprovacao-de-disparos.md`.
 *
 * As regras de transação deste arquivo:
 *
 * - **O que precisa ficar mesmo com a recusa** (o código errado na trava, o
 *   passo do código gasto) grava em transação PRÓPRIA (`ctx.comConta`), antes
 *   do `throw` (V33), e antes de a transação do pedido tocar a linha da pessoa
 *   (a gravação própria esperaria por ela mesma).
 * - **Quem ENCERRA o pedido** (o plano mudou, o aplicativo foi desligado)
 *   responde com o pedido encerrado em vez de lançar: assim o encerramento é
 *   confirmado com a transação de quem chamou.
 * - **Aprovar e executar são dois passos** do serviço; a tela encadeia os dois
 *   na mesma transação. A execução trava o pedido e a campanha, refaz o plano e
 *   dispara dentro de um ponto de salvamento: se o disparo recusar (o WhatsApp
 *   caiu entre abrir e aprovar), só ele se desfaz, o pedido segue aprovado e a
 *   rotina tenta de novo até o prazo.
 */
import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { passoDoCodigo } from '../../common/totp';
import { env } from '../../config/env';
import { ContextoDb } from '../../db/contexto';
import { acaoPedido, campanha, conta, usuario } from '../../db/schema';
import {
  acaoParaRegistro,
  conferirAprovacao,
  conferirExecucao,
  conferirPedidoNovo,
  conferirPedidoRepetido,
  conferirRecusa,
  ErroProblema,
  lembreteDoPedido,
  pedidoPublico,
  problemaDaParada,
  problemaDoPedido,
  resumoDaPessoa,
  situacaoAgora,
  vencimentoDoPedido,
  type Aprovacao,
  type DecididoPor,
  type PedidoDeAcao,
  type PedidoPublico,
  type QuemPede,
  type SituacaoDoPedido,
  type TipoProblema,
} from '../../dms/integracao-dms';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { CampanhaService, type ResumoCampanha } from '../campanha/campanha.service';
import { HubService } from '../hub/hub.service';
import { quandoNoFuso } from '../integracao/aviso-de-ligacao.service';
import { decifrarToken } from '../meta/cripto';
import { MetaService } from '../meta/meta.service';
import {
  ACAO_DO_DISPARO,
  adiado,
  APROVACAO_TRAVADA,
  CODIGO_JA_USADO,
  CODIGO_NAO_CONFERE,
  CREDENCIAL_DESLIGADA,
  decididoPorQuem,
  impressaoDoPedido,
  LIMITE_DE_PEDIDOS,
  MAX_ERROS_CODIGO_APROVACAO,
  MAX_PEDIDOS_ESPERANDO,
  MINUTOS_PARA_TENTAR_DE_NOVO,
  MINUTOS_TRAVA_APROVACAO,
  MODELO_SEM_TEXTO,
  montarPlano,
  MOTIVO_OBRIGATORIO,
  PEDIDO_NAO_ENCONTRADO,
  podeAprovar,
  resumoDaChave,
  resumoDoDisparo,
  RISCO_DO_DISPARO,
  SEM_APLICATIVO_AUTENTICADOR,
  SO_QUEM_PODE_APROVAR,
  TETO_FORA,
  tetoValido,
  type CupomDoPedido,
  type PlanoDoDisparo,
} from './aprovacao.regras';
import { AvisoDeAprovacao } from './aviso-de-aprovacao.service';
import { ErroDoPedido } from './erro-do-pedido';

export { ErroDoPedido };

type Linha = typeof acaoPedido.$inferSelect;

/** O pedido no formato do pacote, a partir da linha. */
export function pedidoDaLinha(l: Linha): PedidoDeAcao {
  return {
    id: l.id,
    acao: l.acao,
    risco: l.risco === 'R2' ? 'R2' : 'R3',
    situacao: l.situacao as SituacaoDoPedido,
    resumoDoPlano: l.resumoPlano,
    aplicativo: l.aplicativo,
    pedidoPor: l.pedidoPor as QuemPede,
    criadoEm: l.criadoEm,
    venceEm: l.venceEm,
    decididoEm: l.decididoEm,
    tetoDeGastoCentavos: l.tetoGastoCentavos,
    motivo: (l.motivo as TipoProblema | null) ?? null,
    motivoDaRecusa: l.motivoRecusa,
  };
}

/** Quem pede, pela porta: a conta, o produto, a credencial e o prefixo visível dela. */
export interface QuemPedePelaPorta {
  contaId: string;
  contaNome: string;
  produto: string;
  classe: 'dms' | 'externo';
  tokenId: string;
  ligacaoPrefixo: string | null;
}

/** Um pedido como a tela mostra: o do pacote, o plano guardado e o que ela precisa para decidir. */
export interface PedidoParaTela {
  pedido: PedidoPublico;
  plano: PlanoDoDisparo;
  campanhaId: string | null;
  /** Pedido feito pelo agente (sem pessoa) ou por uma pessoa do produto de origem. */
  pedidoPor: 'agente' | 'pessoa';
  decididoPorNome: string | null;
}

export interface ListaParaTela {
  esperando: PedidoParaTela[];
  decididos: PedidoParaTela[];
  podeAprovar: boolean;
  /** Quem pergunta tem o aplicativo autenticador ligado (aprovar pede o código dele). */
  segundoFatorPorApp: boolean;
}

/** O que a execução fez: disparou, encerrou o pedido (com o problema) ou deixou para a rotina tentar de novo. */
export type ResultadoDaExecucao =
  | { resultado: 'executado'; pedido: PedidoDeAcao; campanha: ResumoCampanha }
  | { resultado: 'encerrado'; pedido: PedidoDeAcao; recusa: ErroProblema }
  | { resultado: 'adiado'; pedido: PedidoDeAcao; aviso: string };

/** O que o serviço precisa dos serviços da tela e da porta (os testes trocam por dublês). */
export interface ConferenciaDaPorta {
  /** O plano do disparo pela porta: pode disparar, e a confirmação é a de agora. Recusa com a frase. */
  (): Promise<void>;
}

@Injectable()
export class AprovacaoService {
  private readonly log = new Logger('Aprovacao');

  /** O relógio (os testes avançam): todo "agora" do pedido sai daqui, inclusive o `criado_em`. */
  agora: () => Date = () => new Date();

  constructor(
    private readonly ctx: ContextoDb,
    private readonly campanhas: CampanhaService,
    private readonly meta: MetaService,
    private readonly auditoria: AuditoriaService,
    private readonly hub: HubService,
    private readonly avisos: AvisoDeAprovacao,
  ) {}

  /** O endereço do pedido no site, para quem pediu mostrar "esperando o destino" com o link (decisão F5-9). */
  enderecoDaTela(id: string): string {
    return `${String(env.rede?.appUrl ?? '').replace(/\/+$/, '')}/campanhas/para-aprovar/${id}`;
  }

  // ------------------------------------------------------------------ plano

  /**
   * O plano do disparo AGORA: a campanha (os números, o custo estimado, as variáveis e o que o envio exige), o modelo
   * como a Meta o tem (o texto que sai), a impressão de quem recebe e o cupom que veio no pedido. Roda na transação
   * corrente (a conta já está no contexto). Sem o texto do modelo, recusa: quem aprova precisa ver o que sai.
   */
  async planoAgora(contaId: string, campanhaId: string, aplicativo: string, cupom: CupomDoPedido | null): Promise<PlanoDoDisparo> {
    const r = await this.campanhas.detalhe(contaId, campanhaId);
    const [c] = await this.ctx.db
      .select({ modeloId: campanha.modeloId, variaveis: campanha.variaveisLista, envio: campanha.envio })
      .from(campanha)
      .where(and(eq(campanha.id, campanhaId), eq(campanha.contaId, contaId)))
      .limit(1);
    if (!c) throw new NotFoundException('Campanha não encontrada.');

    const naMeta = (await this.meta.modelos(contaId)).find((m) =>
      c.modeloId ? m.id === c.modeloId : m.nome === r.modeloNome && m.idioma === r.modeloIdioma,
    );
    if (!naMeta || !naMeta.corpo) throw new BadRequestException(MODELO_SEM_TEXTO);

    return montarPlano({
      campanhaId,
      aplicativo,
      nome: r.nome,
      modelo: {
        id: naMeta.id,
        nome: naMeta.nome,
        idioma: naMeta.idioma,
        categoria: r.modeloCategoria,
        cabecalho: naMeta.cabecalho,
        corpo: naMeta.corpo,
        rodape: naMeta.rodape,
        botoes: naMeta.botoes ?? [],
      },
      variaveis: c.variaveis,
      variavelCabecalho: r.variavelCabecalho,
      envio: c.envio,
      publicoRotulo: r.publicoRotulo ?? r.listaNome,
      destinatarios: r.total,
      aceitaram: naFila(r),
      impressaoDoPublico: await this.impressaoDoPublico(contaId, campanhaId),
      moeda: r.custo?.moeda ?? null,
      estimadoCentavos: r.custo?.aSairCentavos ?? null,
      cupom,
    });
  }

  /** A impressão de quem recebe: o telefone, as variáveis e a do título de cada um que ainda pode sair, em ordem. */
  private async impressaoDoPublico(contaId: string, campanhaId: string): Promise<string> {
    const r = await this.ctx.db.execute<{ impressao: string }>(sql`
      select encode(sha256(convert_to(coalesce(string_agg(
               d.telefone_e164 || '|' || d.variaveis::text || '|' || coalesce(d.variavel_cabecalho, ''),
               E'\n' order by d.telefone_e164, d.id), ''), 'UTF8')), 'hex') as impressao
        from campanha_destinatario d
       where d.campanha_id = ${campanhaId} and d.conta_id = ${contaId} and d.status in ('pendente', 'enviando')
    `);
    return String(r.rows[0]?.impressao ?? '');
  }

  // ------------------------------------------------------------- 1. pedir

  /**
   * O pedido novo, ou o mesmo pela chave. Roda na transação da ferramenta. A chave vem PRIMEIRO (pacote: a mesma chave
   * devolve o pedido como está agora, aprovado ou não, mesmo depois de a campanha ter saído); só o pedido novo passa
   * pela conferência da porta (`conferirPlano`: pode disparar, e a confirmação é a de agora).
   */
  async pedir(
    quem: QuemPedePelaPorta,
    p: { chave: string; campanhaId: string; confirmacao: string; pedidoPor: unknown; cupom: CupomDoPedido | null },
    conferirPlano: ConferenciaDaPorta,
  ): Promise<{ pedido: PedidoDeAcao; novo: boolean; plano: PlanoDoDisparo | null }> {
    const db = this.ctx.db;
    const chaveResumo = resumoDaChave(p.chave);
    const impressao = impressaoDoPedido({ campanha: p.campanhaId, confirmacao: p.confirmacao, pedidoPor: p.pedidoPor, cupom: p.cupom });

    const repetido = await this.porChave(quem.contaId, quem.produto, chaveResumo);
    if (repetido) return { pedido: this.repetido(repetido, impressao), novo: false, plano: null };

    const esperando = await db.execute<{ total: number }>(sql`
      select count(*)::int as total from acao_pedido where conta_id = ${quem.contaId} and situacao = 'aguardando'
    `);
    if (Number(esperando.rows[0]?.total ?? 0) >= MAX_PEDIDOS_ESPERANDO) throw new ErroDoPedido(new ErroProblema('regra-invalida', LIMITE_DE_PEDIDOS));

    await conferirPlano();
    const plano = await this.planoAgora(quem.contaId, p.campanhaId, quem.produto, p.cupom);
    const resumo = resumoDoDisparo(plano);
    // O token `externo` do Regemcast é o programa do cliente (a classe `proprio` do Padrão): não pede disparo.
    const classe = quem.classe === 'dms' ? 'dms' : 'proprio';
    const recusa = conferirPedidoNovo({ classe, risco: RISCO_DO_DISPARO, resumoDoPlano: resumo, pedidoPor: p.pedidoPor });
    if (recusa) throw new ErroDoPedido(recusa);

    const criado = this.agora();
    const inserido = await db.execute<{ id: string }>(sql`
      insert into acao_pedido (conta_id, campanha_id, acao, risco, situacao, resumo_plano, plano, aplicativo, token_id,
                               ligacao_prefixo, pedido_por, chave_resumo, impressao, criado_em, vence_em, lembrete_em)
      values (${quem.contaId}, ${p.campanhaId}, ${ACAO_DO_DISPARO}, ${RISCO_DO_DISPARO}, 'aguardando', ${resumo},
              ${JSON.stringify(plano)}::jsonb, ${quem.produto}, ${quem.tokenId}, ${quem.ligacaoPrefixo},
              ${JSON.stringify(p.pedidoPor)}::jsonb, ${chaveResumo}, ${impressao}, ${criado.toISOString()}::timestamptz,
              ${vencimentoDoPedido(criado).toISOString()}::timestamptz, ${lembreteDoPedido(criado).toISOString()}::timestamptz)
      on conflict do nothing
      returning id
    `);
    const id = inserido.rows[0]?.id;
    if (!id) {
      // Bateu num índice único: a mesma chave (a corrida de dois pedidos iguais, que esperou o outro confirmar) ou um
      // pedido ativo da mesma campanha, com outra chave.
      const outro = await this.porChave(quem.contaId, quem.produto, chaveResumo);
      if (outro) return { pedido: this.repetido(outro, impressao), novo: false, plano: null };
      const ativo = await this.ativoDaCampanha(quem.contaId, p.campanhaId);
      throw new ErroDoPedido(problemaDoPedido('aprovacao-pendente'), ativo ? { pedido: ativo.id } : undefined);
    }

    await this.auditoria.registrar({
      contaId: quem.contaId,
      acao: 'acao_pedido.criado',
      entidade: 'acao_pedido',
      entidadeId: id,
      detalhe: { campanha: p.campanhaId, aplicativo: quem.produto, pedidoPor: (p.pedidoPor as QuemPede).tipo, resumo },
    });
    return { pedido: pedidoDaLinha((await this.linha(quem.contaId, id))!), novo: true, plano };
  }

  private repetido(l: Linha, impressao: string): PedidoDeAcao {
    const recusa = conferirPedidoRepetido(l.impressao, impressao);
    if (recusa) throw new ErroDoPedido(recusa);
    return pedidoDaLinha(l);
  }

  /** Depois do commit do pedido novo: quem aprova fica sabendo, e o hub registra. Não lança. */
  depoisDoPedido(quem: QuemPedePelaPorta, pedido: PedidoDeAcao, plano: PlanoDoDisparo | null): void {
    this.registrar(pedido, { conta: quem.contaId, contaNome: quem.contaNome, ligacaoPrefixo: quem.ligacaoPrefixo ?? undefined });
    void this.avisos.pedidoNovo(quem.contaId, pedido.id, false, plano ?? undefined);
  }

  // ------------------------------------------------- 2. ler e cancelar (porta)

  /** O pedido de um aplicativo. De outro aplicativo ou de outra conta: não encontrado. */
  async lerDoAplicativo(contaId: string, aplicativo: string, id: string): Promise<PedidoDeAcao> {
    const l = await this.linha(contaId, id);
    if (!l || l.aplicativo !== aplicativo) throw new NotFoundException(PEDIDO_NAO_ENCONTRADO);
    return pedidoDaLinha(l);
  }

  /**
   * Quem pediu desiste: `aguardando` ou `aprovado` → `cancelado`, decidido por quem pediu. Cancelar de novo devolve o
   * cancelado (a desistência já valeu). O que acabou de outro jeito (aprovado e executado, recusado, vencido) recusa com
   * o problema dele: a desistência não muda o que aconteceu.
   */
  async cancelarPeloAplicativo(contaId: string, aplicativo: string, id: string): Promise<{ pedido: PedidoDeAcao; mudou: boolean }> {
    const antes = await this.lerDoAplicativo(contaId, aplicativo, id);
    const agora = this.agora();
    const r = await this.ctx.db.execute<{ id: string }>(sql`
      update acao_pedido
         set situacao = 'cancelado', decidido_em = ${agora.toISOString()}::timestamptz, decidido_por = 'quem_pediu'
       where id = ${id} and conta_id = ${contaId} and aplicativo = ${aplicativo}
         and situacao in ('aguardando', 'aprovado') and vence_em > ${agora.toISOString()}::timestamptz
      returning id
    `);
    if (!r.rows.length) {
      const situacao = situacaoAgora(antes, agora);
      if (situacao === 'cancelado' && antes.motivo == null) return { pedido: antes, mudou: false };
      throw new ErroDoPedido(conferirExecucao({ ...antes, situacao }, antes.resumoDoPlano, agora) ?? problemaDoPedido('aprovacao-usada'));
    }
    await this.auditoria.registrar({ contaId, acao: 'acao_pedido.cancelado', entidade: 'acao_pedido', entidadeId: id, detalhe: { por: 'quem_pediu' } });
    return { pedido: pedidoDaLinha((await this.linha(contaId, id))!), mudou: true };
  }

  // ---------------------------------------------------------------- 3. tela

  async listarParaTela(u: UsuarioAutenticado): Promise<ListaParaTela> {
    const agora = this.agora();
    const desde = new Date(agora.getTime() - 30 * 86_400_000);
    const linhas = await this.ctx.db
      .select()
      .from(acaoPedido)
      .where(and(eq(acaoPedido.contaId, u.contaId), or(inArray(acaoPedido.situacao, ['aguardando', 'aprovado', 'executando']), gte(acaoPedido.criadoEm, desde))))
      .orderBy(desc(acaoPedido.criadoEm))
      .limit(200);
    const nomes = await this.nomesDeQuemDecidiu(u.contaId, linhas);
    const quem = await this.quemAprova(u);
    const paraTela = linhas.map((l) => this.paraTela(l, agora, nomes));
    return {
      esperando: paraTela.filter((p) => p.pedido.situacao === 'aguardando').sort((a, b) => a.pedido.vence_em.localeCompare(b.pedido.vence_em)),
      decididos: paraTela.filter((p) => p.pedido.situacao !== 'aguardando'),
      podeAprovar: quem.pode,
      segundoFatorPorApp: quem.app,
    };
  }

  /**
   * O pedido aberto na tela. Se o plano de agora é outro que o do pedido, o pedido se encerra ali (`cancelado`, motivo
   * `plano-mudou`), na transação da tela. A leitura da Meta que falhar não encerra nada: a tela diz que não conferiu.
   */
  async detalheParaTela(u: UsuarioAutenticado, id: string): Promise<PedidoParaTela & { podeAprovar: boolean; segundoFatorPorApp: boolean; conferido: boolean }> {
    let l = await this.linha(u.contaId, id);
    if (!l) throw new NotFoundException(PEDIDO_NAO_ENCONTRADO);
    let conferido = true;
    if (situacaoAgora(pedidoDaLinha(l), this.agora()) === 'aguardando' && l.campanhaId) {
      try {
        if (await this.planoMudou(l)) l = (await this.encerrar(l, 'plano-mudou', 'produto')) ?? l;
      } catch (erro) {
        if (!(erro instanceof HttpException)) throw erro;
        conferido = false;
      }
    }
    const quem = await this.quemAprova(u);
    const nomes = await this.nomesDeQuemDecidiu(u.contaId, [l]);
    return { ...this.paraTela(l, this.agora(), nomes), podeAprovar: quem.pode, segundoFatorPorApp: quem.app, conferido };
  }

  // ----------------------------------------------------------- 4. aprovar

  /**
   * Aprovar pela tela: quem pode, o teto, o código do aplicativo autenticador (com a trava, em transação própria) e
   * então `aprovarConferido`. Não executa: a tela chama `executar` em seguida, na mesma transação.
   */
  async aprovar(u: UsuarioAutenticado, id: string, d: { codigo: string; tetoCentavos: number; resumoVisto: string }): Promise<PedidoDeAcao> {
    const quem = await this.quemAprova(u);
    if (!quem.pode) throw new ErroDoPedido(new ErroProblema('escopo-insuficiente', SO_QUEM_PODE_APROVAR));
    if (!tetoValido(d.tetoCentavos)) throw new BadRequestException(TETO_FORA);
    if (!(await this.linha(u.contaId, id))) throw new NotFoundException(PEDIDO_NAO_ENCONTRADO);
    await this.conferirCodigo(u, d.codigo);
    return this.aprovarConferido(u.contaId, id, {
      pessoa: resumoDaPessoa(u.email),
      podeAprovar: true,
      segundoFator: true,
      resumoVisto: d.resumoVisto,
      tetoDeGastoCentavos: d.tetoCentavos,
      usuarioId: u.id,
      papel: u.papel,
    });
  }

  /**
   * A aprovação com a pessoa e o segundo fator já conferidos (a tela, ou os casos comuns do pacote). A situação de agora
   * primeiro (o vencido não vira cancelado); o aplicativo que pediu ainda ligado e sem parada; o plano de agora igual
   * ao do pedido (senão encerra e devolve o encerrado); as conferências do pacote; o que impediria o disparo agora.
   * Então `aprovado`, condicional a `aguardando`.
   */
  async aprovarConferido(contaId: string, id: string, a: Aprovacao & { usuarioId: string | null; papel: string }): Promise<PedidoDeAcao> {
    const l = await this.linha(contaId, id);
    if (!l) throw new NotFoundException(PEDIDO_NAO_ENCONTRADO);
    const agora = this.agora();
    const p = pedidoDaLinha(l);

    if (situacaoAgora(p, agora) === 'aguardando' && a.podeAprovar === true && a.segundoFator === true) {
      if (!(await this.credencialValendo(l))) return pedidoDaLinha((await this.encerrar(l, 'pedido-cancelado', 'produto')) ?? l);
      if (this.parado(l)) throw new ErroDoPedido(problemaDaParada());
      if (l.campanhaId && (await this.planoMudou(l))) return pedidoDaLinha((await this.encerrar(l, 'plano-mudou', 'produto')) ?? l);
    }
    const recusa = conferirAprovacao(p, a, agora);
    if (recusa) throw new ErroDoPedido(recusa);

    // O que o disparo recusaria agora (o WhatsApp caiu, o plano sem saldo): não aprova, e a frase diz o que fazer.
    if (l.campanhaId) {
      const impede = await this.campanhas.oQueImpedeODisparo(contaId, l.campanhaId);
      if (impede) throw new BadRequestException(`Não dá para aprovar agora: ${impede}`);
    }

    const decididoPor = decididoPorQuem(a.papel);
    const aprovado = await this.ctx.db.execute<{ id: string }>(sql`
      update acao_pedido
         set situacao = 'aprovado', decidido_em = ${agora.toISOString()}::timestamptz, decidido_por = ${decididoPor},
             decidido_por_usuario = ${a.usuarioId}, teto_gasto_centavos = ${a.tetoDeGastoCentavos ?? null}
       where id = ${id} and conta_id = ${contaId} and situacao = 'aguardando'
         and resumo_plano = ${a.resumoVisto} and vence_em > ${agora.toISOString()}::timestamptz
      returning id
    `);
    if (!aprovado.rows.length) {
      // Outra decisão chegou antes (a corrida de dois cliques, ou cancelaram): a recusa diz qual.
      const atual = pedidoDaLinha((await this.linha(contaId, id))!);
      throw new ErroDoPedido(conferirAprovacao(atual, a, agora) ?? problemaDoPedido('aprovacao-usada'));
    }
    await this.auditoria.registrar({
      contaId,
      atorUsuarioId: a.usuarioId,
      acao: 'acao_pedido.aprovado',
      entidade: 'acao_pedido',
      entidadeId: id,
      detalhe: { campanha: l.campanhaId, aplicativo: l.aplicativo, tetoCentavos: a.tetoDeGastoCentavos, por: decididoPor },
    });
    return pedidoDaLinha((await this.linha(contaId, id))!);
  }

  // ------------------------------------------------------------ 5. recusar

  async recusar(u: UsuarioAutenticado, id: string, motivo: string): Promise<PedidoDeAcao> {
    const quem = await this.quemAprova(u);
    return this.recusarConferido(u.contaId, id, { podeAprovar: quem.pode, usuarioId: u.id, papel: u.papel, motivo });
  }

  async recusarConferido(contaId: string, id: string, a: { podeAprovar: boolean; usuarioId: string | null; papel: string; motivo: string }): Promise<PedidoDeAcao> {
    const texto = String(a.motivo ?? '').replace(/\s+/g, ' ').trim();
    const l = await this.linha(contaId, id);
    if (!l) throw new NotFoundException(PEDIDO_NAO_ENCONTRADO);
    const agora = this.agora();
    const recusa = conferirRecusa(pedidoDaLinha(l), { podeAprovar: a.podeAprovar }, agora);
    if (recusa) throw new ErroDoPedido(recusa.tipo === 'escopo-insuficiente' ? new ErroProblema('escopo-insuficiente', SO_QUEM_PODE_APROVAR) : recusa);
    if (!texto || texto.length > 300) throw new BadRequestException(MOTIVO_OBRIGATORIO);
    const r = await this.ctx.db.execute<{ id: string }>(sql`
      update acao_pedido
         set situacao = 'recusado', decidido_em = ${agora.toISOString()}::timestamptz, decidido_por = ${decididoPorQuem(a.papel)},
             decidido_por_usuario = ${a.usuarioId}, motivo_recusa = ${texto}
       where id = ${id} and conta_id = ${contaId} and situacao = 'aguardando' and vence_em > ${agora.toISOString()}::timestamptz
      returning id
    `);
    if (!r.rows.length) {
      const atual = pedidoDaLinha((await this.linha(contaId, id))!);
      throw new ErroDoPedido(conferirRecusa(atual, { podeAprovar: true }, agora) ?? problemaDoPedido('aprovacao-usada'));
    }
    await this.auditoria.registrar({
      contaId,
      atorUsuarioId: a.usuarioId,
      acao: 'acao_pedido.recusado',
      entidade: 'acao_pedido',
      entidadeId: id,
      detalhe: { campanha: l.campanhaId, aplicativo: l.aplicativo },
    });
    return pedidoDaLinha((await this.linha(contaId, id))!);
  }

  // ------------------------------------------------------------ 6. executar

  /**
   * Executa o pedido aprovado, uma vez, na transação corrente:
   *
   * 1. trava o pedido (`for update`); a situação de agora tem de ser `aprovado` (senão, a recusa do pacote);
   * 2. o aplicativo ainda ligado (senão encerra) e sem parada do hub (senão adia);
   * 3. trava a campanha e refaz o plano: mudou, encerra (`plano-mudou`); a Meta não respondeu, adia;
   * 4. num ponto de salvamento: `aprovado` → `executando`, o MESMO disparo da tela (com o pedido), a campanha guarda o
   *    pedido, `executado`. O disparo recusou: só o ponto de salvamento se desfaz, e o pedido segue aprovado (adiado).
   */
  async executar(contaId: string, id: string): Promise<ResultadoDaExecucao> {
    const db = this.ctx.db;
    const travado = await db.execute<{ id: string }>(sql`select id from acao_pedido where id = ${id} and conta_id = ${contaId} for update`);
    if (!travado.rows.length) throw new NotFoundException(PEDIDO_NAO_ENCONTRADO);
    const l = (await this.linha(contaId, id))!;
    const agora = this.agora();
    const p = pedidoDaLinha(l);
    if (situacaoAgora(p, agora) !== 'aprovado') throw new ErroDoPedido(conferirExecucao(p, p.resumoDoPlano, agora) ?? problemaDoPedido('aprovacao-usada'));

    const vence = await this.quandoVence(l);
    if (!(await this.credencialValendo(l))) return this.encerrado(l, 'pedido-cancelado', new ErroProblema('pedido-cancelado', CREDENCIAL_DESLIGADA));
    if (this.parado(l)) return { resultado: 'adiado', pedido: p, aviso: adiado('a integração do aplicativo está parada pela DMS.', vence) };
    if (!l.campanhaId) return this.encerrado(l, 'pedido-cancelado', problemaDoPedido('pedido-cancelado'));

    // A campanha travada: a edição, a exclusão e outro disparo esperam esta execução terminar.
    const camp = await db.execute<{ id: string }>(sql`select id from campanha where id = ${l.campanhaId} and conta_id = ${contaId} for update`);
    if (!camp.rows.length) return this.encerrado(l, 'pedido-cancelado', problemaDoPedido('pedido-cancelado'));

    let plano: PlanoDoDisparo;
    try {
      plano = await this.planoAgora(contaId, l.campanhaId, l.aplicativo, (l.plano as PlanoDoDisparo).cupom ?? null);
    } catch (erro) {
      if (!(erro instanceof HttpException) || erro.getStatus() >= 500) this.log.warn(`Plano do pedido ${id} não refeito: ${String((erro as Error)?.message ?? erro)}`);
      return { resultado: 'adiado', pedido: p, aviso: adiado(mensagemDe(erro), vence) };
    }
    const recusa = conferirExecucao(p, resumoDoDisparo(plano), agora);
    if (recusa) {
      if (recusa.tipo === 'plano-mudou') return this.encerrado(l, 'plano-mudou', recusa);
      throw new ErroDoPedido(recusa);
    }

    await db.execute(sql`savepoint aprovacao_executar`);
    try {
      const tomado = await db.execute<{ id: string }>(sql`
        update acao_pedido set situacao = 'executando'
         where id = ${id} and conta_id = ${contaId} and situacao = 'aprovado' and vence_em > ${agora.toISOString()}::timestamptz
        returning id
      `);
      if (!tomado.rows.length) throw new ErroDoPedido(problemaDoPedido('aprovacao-usada'));
      // O MESMO disparo da tela, com as conferências de sempre; quem dispara é quem aprovou.
      const depois = await this.campanhas.disparar(contaId, l.decididoPorUsuario, l.campanhaId, { pedidoId: id });
      await db.update(campanha).set({ acaoPedidoId: id }).where(and(eq(campanha.id, l.campanhaId), eq(campanha.contaId, contaId)));
      await db.execute(sql`
        update acao_pedido set situacao = 'executado', executado_em = ${agora.toISOString()}::timestamptz
         where id = ${id} and conta_id = ${contaId} and situacao = 'executando'
      `);
      await this.auditoria.registrar({
        contaId,
        atorUsuarioId: l.decididoPorUsuario,
        acao: 'acao_pedido.executado',
        entidade: 'acao_pedido',
        entidadeId: id,
        detalhe: { campanha: l.campanhaId, tetoCentavos: l.tetoGastoCentavos },
      });
      await db.execute(sql`release savepoint aprovacao_executar`);
      return { resultado: 'executado', pedido: pedidoDaLinha((await this.linha(contaId, id))!), campanha: depois };
    } catch (erro) {
      await db.execute(sql`rollback to savepoint aprovacao_executar`);
      if (erro instanceof ErroDoPedido) throw erro;
      if (!(erro instanceof HttpException) || erro.getStatus() >= 500) {
        this.log.warn(`Disparo do pedido ${id} não saiu agora: ${String((erro as Error)?.message ?? erro)}`);
      }
      return { resultado: 'adiado', pedido: pedidoDaLinha((await this.linha(contaId, id))!), aviso: adiado(mensagemDe(erro), vence) };
    }
  }

  /** Depois do commit de uma decisão ou execução: o hub registra cada situação por onde o pedido passou. Não lança. */
  async depoisDaDecisao(contaId: string, id: string, situacoes: readonly SituacaoDoPedido[]): Promise<void> {
    try {
      const l = await this.ctx.comConta(contaId, () => this.linha(contaId, id));
      if (!l) return;
      const nome = await this.nomeDaConta(contaId);
      const decididoPor = (l.decididoPor as DecididoPor | null) ?? undefined;
      for (const s of situacoes) this.registrar({ ...pedidoDaLinha(l), situacao: s }, { conta: contaId, contaNome: nome, ligacaoPrefixo: l.ligacaoPrefixo ?? undefined, decididoPor });
    } catch (erro) {
      this.log.warn(`Registro do pedido ${id} no hub não saiu: ${String(erro)}`);
    }
  }

  // ------------------------------------------------------ 7. rotina (prazo)

  /** Vence o que passou do prazo (`aguardando` ou `aprovado` → `vencido`, decidido pelo prazo), de todas as contas. */
  async vencer(): Promise<Array<{ contaId: string; id: string }>> {
    const agora = this.agora().toISOString();
    return this.ctx.comEscopoSistema('aprovacao.rotina.vencer', async (db) => {
      const r = await db.execute<{ id: string; conta_id: string }>(sql`
        with alvo as materialized (
          select id from acao_pedido
           where situacao in ('aguardando', 'aprovado') and vence_em <= ${agora}::timestamptz
           order by vence_em
           limit 200
           for update skip locked
        )
        update acao_pedido a
           set situacao = 'vencido', decidido_em = a.vence_em, decidido_por = 'prazo'
          from alvo
         where a.id = alvo.id and a.situacao in ('aguardando', 'aprovado')
        returning a.id, a.conta_id
      `);
      return r.rows.map((l) => ({ id: l.id, contaId: l.conta_id }));
    });
  }

  /** Os pedidos que chegaram à metade do prazo sem resposta: marca o lembrete (uma vez) e devolve, para o aviso. */
  async lembrar(): Promise<Array<{ contaId: string; id: string }>> {
    const agora = this.agora().toISOString();
    return this.ctx.comEscopoSistema('aprovacao.rotina.lembrar', async (db) => {
      const r = await db.execute<{ id: string; conta_id: string }>(sql`
        with alvo as materialized (
          select id from acao_pedido
           where situacao = 'aguardando' and lembrado_em is null
             and lembrete_em <= ${agora}::timestamptz and vence_em > ${agora}::timestamptz
           order by lembrete_em
           limit 200
           for update skip locked
        )
        update acao_pedido a set lembrado_em = ${agora}::timestamptz
          from alvo
         where a.id = alvo.id and a.situacao = 'aguardando' and a.lembrado_em is null
        returning a.id, a.conta_id
      `);
      return r.rows.map((l) => ({ id: l.id, contaId: l.conta_id }));
    });
  }

  /** Depois do commit da rotina: o hub registra o vencido; o lembrete vai a quem aprova. Não lança. */
  async depoisDaRotina(vencidos: Array<{ contaId: string; id: string }>, lembrados: Array<{ contaId: string; id: string }>): Promise<void> {
    for (const v of vencidos) await this.depoisDaDecisao(v.contaId, v.id, ['vencido']);
    for (const l of lembrados) void this.avisos.pedidoNovo(l.contaId, l.id, true);
  }

  /** Os aprovados que não saíram (a execução foi adiada, ou o processo caiu): a rotina tenta de novo, cada um na conta dele. */
  async aprovadosParados(): Promise<Array<{ contaId: string; id: string }>> {
    const agora = this.agora();
    const antes = new Date(agora.getTime() - MINUTOS_PARA_TENTAR_DE_NOVO * 60_000).toISOString();
    return this.ctx.comEscopoSistema('aprovacao.rotina.aprovados', async (db) => {
      const r = await db.execute<{ id: string; conta_id: string }>(sql`
        select id, conta_id from acao_pedido
         where situacao = 'aprovado' and atualizado_em <= ${antes}::timestamptz and vence_em > ${agora.toISOString()}::timestamptz
         order by atualizado_em
         limit 50
      `);
      return r.rows.map((l) => ({ id: l.id, contaId: l.conta_id }));
    });
  }

  /** Executa um aprovado parado, na conta dele. Devolve o que aconteceu (a rotina registra depois do commit). */
  async executarNaConta(contaId: string, id: string): Promise<ResultadoDaExecucao | null> {
    try {
      return await this.ctx.comConta(contaId, () => this.executar(contaId, id));
    } catch (erro) {
      // Outra execução tomou antes, ou o prazo venceu no meio: nada a fazer aqui.
      if (erro instanceof ErroDoPedido) return null;
      throw erro;
    }
  }

  // --------------------------------------------------------------- apoio

  private async linha(contaId: string, id: string): Promise<Linha | null> {
    const [l] = await this.ctx.db
      .select()
      .from(acaoPedido)
      .where(and(eq(acaoPedido.id, id), eq(acaoPedido.contaId, contaId)))
      .limit(1);
    return l ?? null;
  }

  private async porChave(contaId: string, aplicativo: string, chaveResumo: string): Promise<Linha | null> {
    const [l] = await this.ctx.db
      .select()
      .from(acaoPedido)
      .where(and(eq(acaoPedido.contaId, contaId), eq(acaoPedido.aplicativo, aplicativo), eq(acaoPedido.chaveResumo, chaveResumo)))
      .limit(1);
    return l ?? null;
  }

  private async ativoDaCampanha(contaId: string, campanhaId: string): Promise<Linha | null> {
    const [l] = await this.ctx.db
      .select()
      .from(acaoPedido)
      .where(and(eq(acaoPedido.contaId, contaId), eq(acaoPedido.campanhaId, campanhaId), inArray(acaoPedido.situacao, ['aguardando', 'aprovado', 'executando'])))
      .limit(1);
    return l ?? null;
  }

  /** O plano de agora é outro que o guardado no pedido? */
  private async planoMudou(l: Linha): Promise<boolean> {
    if (!l.campanhaId) return false;
    const agora = await this.planoAgora(l.contaId, l.campanhaId, l.aplicativo, (l.plano as PlanoDoDisparo).cupom ?? null);
    return resumoDoDisparo(agora) !== l.resumoPlano;
  }

  /**
   * A credencial por onde o pedido veio ainda vale, com a permissão de disparar e a classe da DMS: o token de integração
   * ou a ligação do Hub DMS (a ligação da troca automática tem o id do token; as duas caem juntas).
   */
  private async credencialValendo(l: Linha): Promise<boolean> {
    const r = await this.ctx.db.execute<{ vale: boolean }>(sql`
      select exists (
               select 1 from integracao_token t
                where t.id = ${l.tokenId} and t.conta_id = ${l.contaId} and t.revogado_em is null
                  and t.classe = 'dms' and t.produto = ${l.aplicativo} and t.escopos ? 'campanhas.disparar')
          or exists (
               select 1 from integracao_ligacao g
                where g.id = ${l.tokenId} and g.conta_id = ${l.contaId} and g.revogado_em is null
                  and g.classe = 'dms' and g.produto = ${l.aplicativo} and g.escopos ? 'campanhas.disparar') as vale
    `);
    return r.rows[0]?.vale === true;
  }

  /** A lista de parada do hub para o aplicativo, a ligação ou a ferramenta do disparo (desligado: nunca para). */
  private parado(l: Linha): boolean {
    return this.hub.parado({ aplicativo: l.aplicativo, ligacaoPrefixo: l.ligacaoPrefixo, ferramenta: ACAO_DO_DISPARO }) !== null;
  }

  /**
   * Encerra o pedido (`cancelado`, com o motivo) na transação corrente, condicional à situação de antes. Devolve a
   * linha nova, ou nula se outra decisão chegou antes. Quem chama responde com o encerrado (não lança): o encerramento
   * confirma com a transação.
   */
  private async encerrar(l: Linha, motivo: 'plano-mudou' | 'pedido-cancelado', por: DecididoPor): Promise<Linha | null> {
    const agora = this.agora();
    const feito = await this.ctx.db.execute<{ id: string }>(sql`
      update acao_pedido
         set situacao = 'cancelado', motivo = ${motivo}, decidido_em = ${agora.toISOString()}::timestamptz, decidido_por = ${por}
       where id = ${l.id} and conta_id = ${l.contaId} and situacao in ('aguardando', 'aprovado')
      returning id
    `);
    if (!feito.rows.length) return null;
    await this.auditoria.registrar({
      contaId: l.contaId,
      atorTipo: 'sistema',
      acao: 'acao_pedido.cancelado',
      entidade: 'acao_pedido',
      entidadeId: l.id,
      detalhe: { motivo, por },
    });
    return this.linha(l.contaId, l.id);
  }

  private async encerrado(l: Linha, motivo: 'plano-mudou' | 'pedido-cancelado', recusa: ErroProblema): Promise<ResultadoDaExecucao> {
    const nova = await this.encerrar(l, motivo, 'produto');
    return { resultado: 'encerrado', pedido: pedidoDaLinha(nova ?? l), recusa };
  }

  /** "às 09:52 de 23/10/2026", no fuso da conta: até quando a rotina tenta de novo. */
  private async quandoVence(l: Linha): Promise<string> {
    const [c] = await this.ctx.db.select({ fuso: conta.timezone }).from(conta).where(eq(conta.id, l.contaId)).limit(1);
    return quandoNoFuso(l.venceEm, c?.fuso ?? 'America/Sao_Paulo');
  }

  /** Quem pergunta pode aprovar, e tem o aplicativo autenticador ligado. */
  private async quemAprova(u: UsuarioAutenticado): Promise<{ pode: boolean; app: boolean }> {
    const [l] = await this.ctx.db
      .select({ papel: usuario.papel, status: usuario.status, aprovaDisparos: usuario.aprovaDisparos, doisFatores: usuario.doisFatores })
      .from(usuario)
      .where(and(eq(usuario.id, u.id), eq(usuario.contaId, u.contaId)))
      .limit(1);
    if (!l) return { pode: false, app: false };
    return { pode: podeAprovar(l), app: l.doisFatores === 'app' };
  }

  /**
   * O código do aplicativo autenticador, agora. Travado: recusa sem olhar o código. Errado: conta numa transação
   * própria e trava no quinto em 15 minutos. Certo: o passo é gasto numa transação própria (o mesmo código não vale de
   * novo, nem na entrada) e a trava zera.
   */
  private async conferirCodigo(u: UsuarioAutenticado, codigo: string): Promise<void> {
    const [l] = await this.ctx.db
      .select({ doisFatores: usuario.doisFatores, segredo: usuario.totpSegredoCifrado, travadaAte: usuario.aprovacaoTravadaAte })
      .from(usuario)
      .where(and(eq(usuario.id, u.id), eq(usuario.contaId, u.contaId)))
      .limit(1);
    if (!l) throw new ForbiddenException(SO_QUEM_PODE_APROVAR);
    if (l.doisFatores !== 'app' || !l.segredo) throw new ErroDoPedido(new ErroProblema('segundo-fator-invalido', SEM_APLICATIVO_AUTENTICADOR));
    if (l.travadaAte && l.travadaAte.getTime() > Date.now()) throw new ErroDoPedido(new ErroProblema('segundo-fator-invalido', APROVACAO_TRAVADA));

    const segredo = this.decifrar(l.segredo);
    const digitado = String(codigo ?? '').trim();
    const passo = segredo && /^\d{6}$/.test(digitado) ? passoDoCodigo(segredo, digitado) : null;
    if (passo === null) {
      const erros = await this.contarErro(u);
      throw new ErroDoPedido(new ErroProblema('segundo-fator-invalido', erros >= MAX_ERROS_CODIGO_APROVACAO ? APROVACAO_TRAVADA : CODIGO_NAO_CONFERE));
    }
    const gasto = await this.ctx.comConta(u.contaId, async (db) => {
      const r = await db.execute<{ id: string }>(sql`
        update usuario set totp_ultimo_passo = ${passo}, aprovacao_erros = 0, aprovacao_erro_em = null, aprovacao_travada_ate = null
         where id = ${u.id} and conta_id = ${u.contaId}
           and (totp_ultimo_passo is null or totp_ultimo_passo < ${passo})
        returning id
      `);
      return r.rows.length > 0;
    });
    if (!gasto) throw new ErroDoPedido(new ErroProblema('segundo-fator-invalido', CODIGO_JA_USADO));
  }

  /** Conta o código errado, numa transação própria. Erro mais velho que 15 minutos não conta. Devolve quantos seguidos. */
  private async contarErro(u: UsuarioAutenticado): Promise<number> {
    const [l] = await this.ctx.comConta(u.contaId, async (db) => {
      const r = await db.execute<{ erros: number }>(sql`
        update usuario x
           set aprovacao_erros = n.erros,
               aprovacao_erro_em = now(),
               aprovacao_travada_ate = case when n.erros >= ${MAX_ERROS_CODIGO_APROVACAO}
                                            then now() + make_interval(mins => ${MINUTOS_TRAVA_APROVACAO})
                                            else x.aprovacao_travada_ate end
          from (select id,
                       case when aprovacao_erro_em is null or aprovacao_erro_em < now() - make_interval(mins => ${MINUTOS_TRAVA_APROVACAO})
                            then 1 else aprovacao_erros + 1 end as erros
                  from usuario where id = ${u.id} and conta_id = ${u.contaId} for update) n
         where x.id = n.id
        returning x.aprovacao_erros as erros
      `);
      return r.rows;
    });
    return Number(l?.erros ?? 1);
  }

  private decifrar(cifrado: string): string | null {
    const chave = env.seguranca?.totpChave;
    if (!chave) throw new ServiceUnavailableException('O aplicativo autenticador não está configurado: falta a variável CONTA_TOTP_CHAVE no servidor.');
    try {
      return decifrarToken(cifrado, chave);
    } catch (erro) {
      this.log.error(`Segredo do aplicativo autenticador ilegível: ${(erro as Error)?.message ?? erro}`);
      return null;
    }
  }

  private async nomesDeQuemDecidiu(contaId: string, linhas: readonly Linha[]): Promise<Map<string, string>> {
    const ids = [...new Set(linhas.map((l) => l.decididoPorUsuario).filter((v): v is string => Boolean(v)))];
    if (!ids.length) return new Map();
    const r = await this.ctx.db
      .select({ id: usuario.id, nome: usuario.nome })
      .from(usuario)
      .where(and(eq(usuario.contaId, contaId), inArray(usuario.id, ids)));
    return new Map(r.map((l) => [l.id, l.nome]));
  }

  private async nomeDaConta(contaId: string): Promise<string | undefined> {
    const [l] = await this.ctx.comConta(contaId, (db) => db.select({ nome: conta.nome }).from(conta).where(eq(conta.id, contaId)).limit(1));
    return l?.nome;
  }

  private paraTela(l: Linha, agora: Date, nomes: Map<string, string>): PedidoParaTela {
    return {
      pedido: pedidoPublico(pedidoDaLinha(l), agora, this.enderecoDaTela(l.id)),
      plano: l.plano as PlanoDoDisparo,
      campanhaId: l.campanhaId,
      pedidoPor: (l.pedidoPor as QuemPede).tipo,
      decididoPorNome: l.decididoPorUsuario ? (nomes.get(l.decididoPorUsuario) ?? null) : null,
    };
  }

  /** Uma mudança de situação no registro do hub (desligado: nada). */
  private registrar(p: PedidoDeAcao, o: { conta?: string; contaNome?: string; ligacaoPrefixo?: string; decididoPor?: DecididoPor }): void {
    this.hub.registrarAcao(acaoParaRegistro(p, { ocorridoEm: this.agora(), ...o }));
  }
}

/** Quantas pessoas da campanha estão na fila e podem receber (o `naFila` da porta). */
function naFila(r: ResumoCampanha): number {
  return (r.porStatus.pendente ?? 0) + (r.porStatus.enviando ?? 0);
}

/** A frase de uma recusa (a do serviço, para a tela), ou uma genérica com o que fazer. */
function mensagemDe(erro: unknown): string {
  if (erro instanceof HttpException && erro.getStatus() < 500) {
    const corpo = erro.getResponse();
    const m = typeof corpo === 'string' ? corpo : (corpo as { message?: unknown }).message;
    const texto = Array.isArray(m) ? m.join(' ') : String(m ?? erro.message);
    return /[.!?]$/.test(texto.trim()) ? texto.trim() : `${texto.trim()}.`;
  }
  return 'a Meta ou o banco não responderam agora.';
}

