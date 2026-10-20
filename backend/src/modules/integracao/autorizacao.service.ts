/**
 * A autorização por clique do Hub DMS (F2, etapa B1). Desenho e regras em
 * `autorizacao.regras.ts`; a tela, montada aqui no servidor, em `autorizacao.tela.ts`.
 *
 * Os escopos de banco seguem `docs/rls.md`:
 * - o pedido, a decisão e a troca rodam em escopo de sistema (motivo A): o
 *   pedido não é de conta nenhuma até o dono decidir, e o código chega sem conta
 *   — é ele que diz de quem é;
 * - a senha errada conta numa transação PRÓPRIA da conta, antes da recusa (V33):
 *   a recusa desfaz a transação do pedido, e o contador não pode sumir com ela.
 *
 * Nada nasce no clique: o clique grava a autorização e um código; a ligação só
 * nasce (ou muda) quando o aplicativo troca o código, de servidor para servidor.
 */
import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import argon2 from 'argon2';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { env } from '../../config/env';
import { ContextoDb } from '../../db/contexto';
import { conta, integracaoAutorizacao, integracaoLigacao, integracaoPedido, usuario } from '../../db/schema';
import { ErroProblema, gerarChave, problemaDaParada, type TokenDmsId } from '../../dms/integracao-dms';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { comAutorDaIntegracao } from '../auditoria/autor-integracao';
import { anotarChamada } from '../hub/chamada-atual';
import { HubService } from '../hub/hub.service';
import { AvisoDeLigacao, type TipoDeLigacaoNova } from './aviso-de-ligacao.service';
import {
  APLICATIVOS_DA_AUTORIZACAO,
  conferirPedido,
  ehOutraEmpresa,
  enderecoDeVolta,
  gerarCodigo,
  gerarNumeroDoPedido,
  MAX_ERROS_SENHA_AUTORIZACAO,
  MINUTOS_TRAVA_AUTORIZACAO,
  permissoesLiberadas,
  resumoDoCodigo,
  resumoDoNumero,
  VALIDADE_DO_CODIGO_MS,
  VALIDADE_DO_PEDIDO_MS,
  verificadorConfere,
  VERSAO_DO_TEXTO,
  type AplicativoDaAutorizacao,
  type ContaQuePede,
  type CorpoDoPedido,
} from './autorizacao.regras';
import { montarTela, textoGuardado, type TelaDaAutorizacao } from './autorizacao.tela';
import { DmsIdService } from './dms-id.service';
import { escoposEfetivos } from './integracao.regras';
import type { LigacaoEntregue } from './integracao.service';

export const PEDIDO_INVALIDO =
  'Este pedido de autorização não vale: ele já foi usado, venceu (vale 10 minutos) ou chegou incompleto. Volte ao aplicativo e comece de novo.';
export const CODIGO_INVALIDO = 'Código de autorização inválido, vencido ou já usado.';
/** Quem revogou a ligação que veio de um token, quando o dono autorizou por clique (o motivo na tela e na auditoria). */
export const SUBSTITUIDA_PELO_CLIQUE = 'substituída pela autorização por clique';
const NAO_USA = 'Este aplicativo não usa a autorização por clique do Regemcast.';
const DESLIGADA = 'A autorização por clique não está ligada neste ambiente.';
const SO_O_DONO = 'Só o dono da conta autoriza um aplicativo.';
const PARADO = 'O aplicativo está parado pela DMS. Nenhuma autorização nova é aceita enquanto durar.';
/** 423 Locked (RFC 4918): a trava da senha. O `HttpStatus` do Nest 10 não tem o nome. */
const HTTP_TRAVADA = 423;

/** A resposta da página: a situação e, quando é para decidir, a tela inteira. */
export type RespostaDaTela =
  | { situacao: 'indisponivel' }
  | { situacao: 'invalido'; aplicativo: { nome: string; inicio: string } | null }
  | { situacao: 'pausado'; aplicativo: { nome: string; inicio: string } }
  | { situacao: 'nao_dono'; aplicativo: { nome: string; inicio: string }; pessoa: { nome: string; papel: string }; dono: string | null }
  | { situacao: 'travada'; aplicativo: { nome: string; inicio: string }; pessoa: { nome: string; papel: string }; minutos: number }
  | { situacao: 'escolha'; aplicativo: { nome: string; inicio: string }; pessoa: { nome: string; papel: string }; tela: TelaDaAutorizacao };

export interface DecisaoDoDono {
  clientId: string;
  requestUri: string;
  senha: string;
  opcionais: string[];
  confirmoOutraEmpresa: boolean;
}

/** Os campos da troca, como chegam no corpo (formulário da RFC 6749 ou JSON). */
export interface CorpoDaTroca {
  grant_type?: unknown;
  code?: unknown;
  code_verifier?: unknown;
  redirect_uri?: unknown;
  client_id?: unknown;
}

interface PedidoGuardado {
  id: string;
  redirectUri: string;
  necessarias: string[];
  opcionais: string[];
  state: string;
  desafio: string;
  contaQuePede: ContaQuePede;
}

const listaDeTexto = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

@Injectable()
export class AutorizacaoService {
  constructor(
    private readonly ctx: ContextoDb,
    private readonly dmsId: DmsIdService,
    private readonly hub: HubService,
    private readonly auditoria: AuditoriaService,
    private readonly avisos: AvisoDeLigacao,
  ) {}

  /** Ligada só com o DMS ID ligado: a autorização entrega uma ligação do DMS ID. */
  get ligada(): boolean {
    return (env as { autorizacao?: { ligada?: boolean } }).autorizacao?.ligada === true && this.dmsId.ligado;
  }

  private get config(): { empresa: string; cnpj: string; enderecosDeVolta: Record<string, string[]> } {
    const c = (env as { autorizacao?: { empresa: string; cnpj: string; enderecosDeVolta: Record<string, string[]> } }).autorizacao;
    return c ?? { empresa: '', cnpj: '', enderecosDeVolta: {} };
  }

  /** O endereço deste servidor, que volta no `iss` (RFC 9207): o aplicativo confere antes de trocar o código. */
  emissor(): string {
    return new URL(env.rede.apiUrl).origin;
  }

  /** O aplicativo do client_id: o produto pela lista da distribuição (DMS_ID_APLICATIVOS) e o catálogo dele. */
  aplicativoDo(clientId: unknown): { clientId: string; app: AplicativoDaAutorizacao } | null {
    if (typeof clientId !== 'string' || !clientId) return null;
    const produto = Object.entries(this.dmsId.aplicativos).find(([, id]) => id === clientId)?.[0];
    if (!produto || !Object.hasOwn(APLICATIVOS_DA_AUTORIZACAO, produto)) return null;
    return { clientId, app: APLICATIVOS_DA_AUTORIZACAO[produto]! };
  }

  private enderecosDeVolta(app: AplicativoDaAutorizacao): readonly string[] {
    return this.config.enderecosDeVolta[app.produto] ?? app.enderecosDeVolta;
  }

  /** A chave geral do Padrão (ACEITAR_INTEGRACOES) ou a lista de parada do hub para o aplicativo. */
  private parado(app: AplicativoDaAutorizacao, ferramenta: 'autorizacao.pedido' | 'autorizacao.token' = 'autorizacao.pedido'): boolean {
    return !this.hub.aceitaIntegracoes || this.hub.parado({ aplicativo: app.produto, ligacaoPrefixo: null, ferramenta }) !== null;
  }

  // -------------------------------------------------------------- 1. o pedido

  /**
   * O pedido empurrado (RFC 9126): o aplicativo, já conferido pelo token do DMS
   * ID, registra o que pede e recebe o número do pedido. O dono nunca vê esta
   * resposta: as frases de erro são para quem programa o aplicativo.
   */
  async criarPedido(corpo: CorpoDoPedido, doToken: Pick<TokenDmsId, 'aplicativo'>): Promise<{ request_uri: string; expires_in: number }> {
    const quem = this.aplicativoDo(doToken.aplicativo);
    if (!quem) throw new ErroProblema('cliente-invalido', NAO_USA);
    anotarChamada({ aplicativo: quem.app.produto });
    if (this.parado(quem.app)) throw problemaDaParada();

    const conferido = conferirPedido(corpo, quem.app, quem.clientId, this.enderecosDeVolta(quem.app));
    if ('erro' in conferido) throw new ErroProblema('parametro-invalido', conferido.erro);

    const { numero, resumo } = gerarNumeroDoPedido();
    await this.ctx.comEscopoSistema('integracao.autorizacao.pedir', async (db) => {
      // O pedido traz o e-mail de quem pediu: não fica além do necessário. A prova mora na autorização.
      await db.execute(sql`delete from integracao_pedido where vence_em < now() - interval '1 day'`);
      await db.insert(integracaoPedido).values({
        aplicativo: quem.clientId,
        produto: quem.app.produto,
        numeroHash: resumo,
        redirectUri: conferido.redirectUri,
        necessarias: conferido.necessarias,
        opcionais: conferido.opcionais,
        state: conferido.state,
        desafio: conferido.desafio,
        contaQuePede: conferido.contaQuePede,
        venceEm: new Date(Date.now() + VALIDADE_DO_PEDIDO_MS),
      });
    });
    return { request_uri: numero, expires_in: VALIDADE_DO_PEDIDO_MS / 1000 };
  }

  /** O pedido que ainda vale (existe, deste aplicativo, sem uso e no prazo), ou nulo. Só lê. */
  private async pedidoValido(clientId: string, requestUri: unknown): Promise<PedidoGuardado | null> {
    const resumo = resumoDoNumero(requestUri);
    if (!resumo) return null;
    const [p] = await this.ctx.comEscopoSistema('integracao.autorizacao.ler', (db) =>
      db
        .select()
        .from(integracaoPedido)
        .where(and(eq(integracaoPedido.numeroHash, resumo), eq(integracaoPedido.aplicativo, clientId), isNull(integracaoPedido.usadoEm), sql`${integracaoPedido.venceEm} > now()`))
        .limit(1),
    );
    return p ? this.paraPedido(p) : null;
  }

  private paraPedido(p: typeof integracaoPedido.$inferSelect): PedidoGuardado {
    return {
      id: p.id,
      redirectUri: p.redirectUri,
      necessarias: listaDeTexto(p.necessarias),
      opcionais: listaDeTexto(p.opcionais),
      state: p.state,
      desafio: p.desafio,
      contaQuePede: p.contaQuePede as ContaQuePede,
    };
  }

  // -------------------------------------------------------------- 2. a página

  /** O que a página mostra. Roda na transação do pedido (a conta da sessão); o pedido, em escopo de sistema. */
  async lerParaTela(u: UsuarioAutenticado, clientId: unknown, requestUri: unknown): Promise<RespostaDaTela> {
    if (!this.ligada) return { situacao: 'indisponivel' };
    const quem = this.aplicativoDo(clientId);
    if (!quem) return { situacao: 'invalido', aplicativo: null };
    const aplicativo = { nome: quem.app.nome, inicio: quem.app.inicio };

    const pedido = await this.pedidoValido(quem.clientId, requestUri);
    if (!pedido) return { situacao: 'invalido', aplicativo };
    if (this.parado(quem.app)) return { situacao: 'pausado', aplicativo };

    const pessoa = { nome: u.nome, papel: u.papel };
    if (u.papel !== 'dono') {
      const [dono] = await this.ctx.db
        .select({ nome: usuario.nome })
        .from(usuario)
        .where(and(eq(usuario.contaId, u.contaId), eq(usuario.papel, 'dono')))
        .limit(1);
      return { situacao: 'nao_dono', aplicativo, pessoa, dono: dono?.nome ?? null };
    }

    const [eu] = await this.ctx.db.select({ travadaAte: usuario.autorizacaoTravadaAte }).from(usuario).where(eq(usuario.id, u.id)).limit(1);
    if (eu?.travadaAte && eu.travadaAte.getTime() > Date.now()) {
      return { situacao: 'travada', aplicativo, pessoa, minutos: Math.ceil((eu.travadaAte.getTime() - Date.now()) / 60_000) };
    }

    const tela = await this.montar(this.ctx.db, u.contaId, quem, pedido);
    return { situacao: 'escolha', aplicativo, pessoa, tela };
  }

  private async montar(db: ContextoDb['db'], contaId: string, quem: { clientId: string; app: AplicativoDaAutorizacao }, pedido: PedidoGuardado) {
    const [dona] = await db.select({ nome: conta.nome, cnpj: conta.cnpj }).from(conta).where(eq(conta.id, contaId)).limit(1);
    const [ativa] = await db
      .select({ criadoEm: integracaoLigacao.criadoEm, escopos: integracaoLigacao.escopos, classe: integracaoLigacao.classe })
      .from(integracaoLigacao)
      .where(and(eq(integracaoLigacao.contaId, contaId), eq(integracaoLigacao.aplicativo, quem.clientId), isNull(integracaoLigacao.revogadoEm)))
      .limit(1);
    const contaDaSessao = { nome: dona?.nome ?? '', cnpj: dona?.cnpj ?? null };
    return montarTela({
      app: quem.app,
      empresa: { razaoSocial: this.config.empresa, cnpj: this.config.cnpj },
      redirectUri: pedido.redirectUri,
      pedido,
      conta: contaDaSessao,
      outraEmpresa: ehOutraEmpresa(pedido.contaQuePede.cnpj, contaDaSessao.cnpj),
      ligacaoAtiva: ativa ? { criadoEm: ativa.criadoEm, escopos: escoposEfetivos(ativa.escopos, ativa.classe) } : null,
    });
  }

  // -------------------------------------------------------------- 3. autorizar

  /**
   * O dono confirma com a senha. Grava a autorização com o texto e a versão, gasta
   * o pedido e devolve o endereço de volta com o código, o `state` e o `iss`. A
   * ligação ainda não existe: nasce na troca do código.
   */
  async autorizar(u: UsuarioAutenticado, d: DecisaoDoDono, origem: { ip?: string; userAgent?: string }): Promise<{ redirect: string }> {
    if (!this.ligada) throw new NotFoundException(DESLIGADA);
    if (u.papel !== 'dono') throw new ForbiddenException(SO_O_DONO);
    const quem = this.aplicativoDo(d.clientId);
    if (!quem) throw new GoneException(PEDIDO_INVALIDO);
    if (this.parado(quem.app)) throw new ServiceUnavailableException(PARADO);

    await this.conferirSenha(u, d.senha);

    const resumo = resumoDoNumero(d.requestUri);
    if (!resumo) throw new GoneException(PEDIDO_INVALIDO);
    const feito = await this.ctx.comEscopoSistema('integracao.autorizacao.decidir', async (db) => {
      // A trava na linha do pedido: duas abas autorizando o mesmo pedido não geram dois códigos.
      const [linha] = await db
        .select()
        .from(integracaoPedido)
        .where(and(eq(integracaoPedido.numeroHash, resumo), eq(integracaoPedido.aplicativo, quem.clientId)))
        .limit(1)
        .for('update');
      if (!linha || linha.usadoEm || linha.venceEm.getTime() <= Date.now()) return null;
      const pedido = this.paraPedido(linha);

      const fora = d.opcionais.find((o) => !pedido.opcionais.includes(o));
      if (fora) throw new BadRequestException('A escolha trouxe uma permissão que o aplicativo não pediu. Recarregue a página e decida de novo.');
      const tela = await this.montar(db, u.contaId, quem, pedido);
      if (tela.contaQuePede.outraEmpresa && d.confirmoOutraEmpresa !== true) {
        throw new BadRequestException('Marque a confirmação para ligar a conta de outra empresa.');
      }

      const escopos = permissoesLiberadas(pedido, d.opcionais);
      const { codigo, resumo: resumoDoCodigoNovo } = gerarCodigo();
      const [criada] = await db
        .insert(integracaoAutorizacao)
        .values({
          contaId: u.contaId,
          pedidoId: pedido.id,
          aplicativo: quem.clientId,
          produto: quem.app.produto,
          usuarioId: u.id,
          usuarioNome: u.nome,
          escopos,
          opcionaisDesligados: pedido.opcionais.filter((o) => !d.opcionais.includes(o)),
          contaQuePede: pedido.contaQuePede,
          outraEmpresa: tela.contaQuePede.outraEmpresa,
          textoVersao: VERSAO_DO_TEXTO,
          texto: textoGuardado(tela, { opcionaisLigadas: d.opcionais, confirmouOutraEmpresa: d.confirmoOutraEmpresa === true }),
          codigoHash: resumoDoCodigoNovo,
          codigoVenceEm: new Date(Date.now() + VALIDADE_DO_CODIGO_MS),
          redirectUri: pedido.redirectUri,
          desafio: pedido.desafio,
        })
        .returning({ id: integracaoAutorizacao.id });
      await db.update(integracaoPedido).set({ usadoEm: new Date() }).where(eq(integracaoPedido.id, pedido.id));
      await this.auditoria.registrar({
        contaId: u.contaId,
        atorTipo: 'usuario',
        atorUsuarioId: u.id,
        acao: 'integracao.autorizacao_concedida',
        entidade: 'integracao_autorizacao',
        entidadeId: criada!.id,
        // `por`: a auditoria só guarda o nome do ator quando é um aplicativo; o histórico da tela mostra quem foi.
        detalhe: {
          aplicativo: quem.app.produto,
          escopos,
          opcionaisDesligados: pedido.opcionais.filter((o) => !d.opcionais.includes(o)),
          outraEmpresa: tela.contaQuePede.outraEmpresa,
          textoVersao: VERSAO_DO_TEXTO,
          por: u.nome,
        },
        ip: origem.ip,
        userAgent: origem.userAgent,
      });
      return { codigo, redirectUri: pedido.redirectUri, state: pedido.state };
    });
    if (!feito) throw new GoneException(PEDIDO_INVALIDO);
    return { redirect: enderecoDeVolta(feito.redirectUri, { code: feito.codigo, state: feito.state, iss: this.emissor() }) };
  }

  /**
   * A senha da autorização. O argon2 roda sempre, travada ou não: o tempo da
   * resposta não denuncia a trava, e na trava o resultado nem é olhado. Errada:
   * conta numa transação própria, antes da recusa, e trava na quinta em 15
   * minutos. Certa: zera.
   */
  private async conferirSenha(u: UsuarioAutenticado, senha: string): Promise<void> {
    const [l] = await this.ctx.db
      .select({ hash: usuario.senhaHash, erros: usuario.autorizacaoErros, travadaAte: usuario.autorizacaoTravadaAte })
      .from(usuario)
      .where(and(eq(usuario.id, u.id), eq(usuario.contaId, u.contaId)))
      .limit(1);
    if (!l) throw new UnauthorizedException('Faça login para continuar.');

    const travada = (ate: Date | null) => {
      const minutos = Math.max(1, Math.ceil(((ate?.getTime() ?? Date.now()) - Date.now()) / 60_000));
      return new HttpException(
        `A autorização está travada por ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}: foram cinco senhas erradas seguidas. Nada foi liberado.`,
        HTTP_TRAVADA,
      );
    };
    const ok = await argon2.verify(l.hash, senha).catch(() => false);
    if (l.travadaAte && l.travadaAte.getTime() > Date.now()) throw travada(l.travadaAte);

    if (!ok) {
      const [conta_] = await this.ctx.comConta(u.contaId, async (db) => {
        const r = await db.execute(sql`
          update usuario u
             set autorizacao_erros = n.erros,
                 autorizacao_erro_em = now(),
                 autorizacao_travada_ate = case when n.erros >= ${MAX_ERROS_SENHA_AUTORIZACAO}
                                                then now() + make_interval(mins => ${MINUTOS_TRAVA_AUTORIZACAO})
                                                else u.autorizacao_travada_ate end
            from (select id,
                         case when autorizacao_erro_em is null or autorizacao_erro_em < now() - make_interval(mins => ${MINUTOS_TRAVA_AUTORIZACAO})
                              then 1 else autorizacao_erros + 1 end as erros
                    from usuario where id = ${u.id} and conta_id = ${u.contaId} for update) n
           where u.id = n.id
           returning u.autorizacao_erros as erros, u.autorizacao_travada_ate as travada_ate`);
        return r.rows as { erros: number; travada_ate: Date | string | null }[];
      });
      const erros = Number(conta_?.erros ?? 1);
      if (erros >= MAX_ERROS_SENHA_AUTORIZACAO) throw travada(conta_?.travada_ate ? new Date(conta_.travada_ate) : null);
      const restam = MAX_ERROS_SENHA_AUTORIZACAO - erros;
      throw new UnprocessableEntityException(
        `Senha incorreta. Nada foi autorizado. ${restam === 1 ? 'Mais uma senha errada trava' : `Mais ${restam} senhas erradas travam`} a autorização por ${MINUTOS_TRAVA_AUTORIZACAO} minutos.`,
      );
    }
    if (l.erros > 0 || l.travadaAte) {
      await this.ctx.db
        .update(usuario)
        .set({ autorizacaoErros: 0, autorizacaoErroEm: null, autorizacaoTravadaAte: null })
        .where(and(eq(usuario.id, u.id), eq(usuario.contaId, u.contaId)));
    }
  }

  // -------------------------------------------------------------- 4. recusar

  /** Cancelar (o dono) ou voltar (quem não é o dono): gasta o pedido e devolve o endereço de volta com `access_denied`. */
  async recusar(u: UsuarioAutenticado, d: { clientId: string; requestUri: string }): Promise<{ redirect: string }> {
    const quem = this.aplicativoDo(d.clientId);
    const resumo = resumoDoNumero(d.requestUri);
    if (!quem || !resumo) throw new GoneException(PEDIDO_INVALIDO);
    const recusado = await this.ctx.comEscopoSistema('integracao.autorizacao.recusar', async (db) => {
      const [p] = await db
        .update(integracaoPedido)
        .set({ usadoEm: new Date() })
        .where(and(eq(integracaoPedido.numeroHash, resumo), eq(integracaoPedido.aplicativo, quem.clientId), isNull(integracaoPedido.usadoEm), sql`${integracaoPedido.venceEm} > now()`))
        .returning({ id: integracaoPedido.id, redirectUri: integracaoPedido.redirectUri, state: integracaoPedido.state });
      if (!p) return null;
      await this.auditoria.registrar({
        contaId: u.contaId,
        atorTipo: 'usuario',
        atorUsuarioId: u.id,
        acao: 'integracao.autorizacao_recusada',
        entidade: 'integracao_pedido',
        entidadeId: p.id,
        detalhe: { aplicativo: quem.app.produto, papel: u.papel },
      });
      return p;
    });
    if (!recusado) throw new GoneException(PEDIDO_INVALIDO);
    return { redirect: enderecoDeVolta(recusado.redirectUri, { error: 'access_denied', state: recusado.state, iss: this.emissor() }) };
  }

  // -------------------------------------------------------------- 5. a troca

  /**
   * O aplicativo troca o código pelo segredo da ligação. O código é gasto numa
   * transação própria, ANTES das conferências: verificador errado ou endereço
   * diferente gastam o código também. Código usado de novo desliga a ligação que
   * ele criou (RFC 6749 §4.1.2), se ela ainda for dele.
   */
  async trocarCodigo(corpo: CorpoDaTroca, doToken: Pick<TokenDmsId, 'aplicativo'>): Promise<LigacaoEntregue> {
    const quem = this.aplicativoDo(doToken.aplicativo);
    if (!quem) throw new ErroProblema('cliente-invalido', NAO_USA);
    anotarChamada({ aplicativo: quem.app.produto });
    // Parado pela DMS: nenhuma ligação nasce, nem de um código emitido antes da parada.
    if (this.parado(quem.app, 'autorizacao.token')) throw problemaDaParada();
    if (corpo.client_id !== undefined && corpo.client_id !== quem.clientId) throw new ErroProblema('autorizacao-invalida', CODIGO_INVALIDO);
    if (corpo.grant_type !== 'authorization_code') throw new ErroProblema('parametro-invalido', 'grant_type precisa ser "authorization_code".');
    const resumo = resumoDoCodigo(corpo.code);
    if (!resumo) throw new ErroProblema('autorizacao-invalida', CODIGO_INVALIDO);

    const [a] = await this.ctx.comEscopoSistema('integracao.autorizacao.gastar', async (db) => {
      const r = await db.execute(sql`
        update integracao_autorizacao set codigo_usado_em = now()
         where codigo_hash = ${resumo} and aplicativo = ${quem.clientId} and codigo_usado_em is null and codigo_vence_em > now()
         returning id, conta_id, usuario_id, escopos, redirect_uri, desafio, conta_que_pede`);
      return r.rows as { id: string; conta_id: string; usuario_id: string | null; escopos: unknown; redirect_uri: string; desafio: string; conta_que_pede: ContaQuePede }[];
    });
    if (!a) {
      await this.desligarPeloReuso(resumo, quem.clientId);
      throw new ErroProblema('autorizacao-invalida', CODIGO_INVALIDO);
    }
    anotarChamada({ conta: a.conta_id });
    if (corpo.redirect_uri !== a.redirect_uri || !verificadorConfere(corpo.code_verifier, a.desafio)) {
      throw new ErroProblema('autorizacao-invalida', CODIGO_INVALIDO);
    }

    const escopos = listaDeTexto(a.escopos);
    const { chave, resumo: resumoDoSegredo, prefixo } = gerarChave('lg', 'regemcast');
    const feita = await this.ctx.comEscopoSistema('integracao.autorizacao.ligar', async (db) => {
      const [dona] = await db.select({ nome: conta.nome, status: conta.status }).from(conta).where(eq(conta.id, a.conta_id)).limit(1);
      if (!dona || dona.status === 'suspensa' || dona.status === 'cancelada') {
        throw new ErroProblema('conta-bloqueada', 'A conta que autorizou está suspensa ou cancelada. O dono da conta resolve no Regemcast.');
      }
      // Quem autorizou ainda é o dono ativo da conta: quem perdeu o papel no meio do caminho não liga nada.
      const [quemAutorizou] = await db
        .select({ papel: usuario.papel, status: usuario.status })
        .from(usuario)
        .where(and(eq(usuario.id, a.usuario_id ?? '00000000-0000-0000-0000-000000000000'), eq(usuario.contaId, a.conta_id)))
        .limit(1);
      if (quemAutorizou?.papel !== 'dono' || quemAutorizou.status !== 'ativo') throw new ErroProblema('autorizacao-invalida', CODIGO_INVALIDO);

      const agora = new Date();
      const [ativa] = await db
        .select({ id: integracaoLigacao.id, escopos: integracaoLigacao.escopos, classe: integracaoLigacao.classe, origemTokenId: integracaoLigacao.origemTokenId })
        .from(integracaoLigacao)
        .where(and(eq(integracaoLigacao.contaId, a.conta_id), eq(integracaoLigacao.aplicativo, quem.clientId), isNull(integracaoLigacao.revogadoEm)))
        .limit(1)
        .for('update');
      // A ligação que veio de um token (a troca automática) tem o id dele, e revogar o token derruba a ligação de mesmo
      // id: o clique não fica com ela. Ela cai, substituída, e nasce outra, da autorização. Sem isso, o aplicativo que
      // revoga o token antigo (ao passar a conta para a autorização nova), ou que refaz a troca automática, derrubava ou
      // trocava o segredo da ligação do clique.
      const substituida = ativa?.origemTokenId ? ativa : null;
      const gira = ativa !== undefined && substituida === null;

      let id: string;
      try {
        if (gira) {
          await db
            .update(integracaoLigacao)
            .set({ escopos, segredoHash: resumoDoSegredo, prefixo, segredoEm: agora, autorizacaoId: a.id })
            .where(and(eq(integracaoLigacao.id, ativa.id), isNull(integracaoLigacao.revogadoEm)));
          id = ativa.id;
        } else {
          if (substituida) {
            await db
              .update(integracaoLigacao)
              .set({ revogadoEm: agora, revogadoPor: SUBSTITUIDA_PELO_CLIQUE })
              .where(and(eq(integracaoLigacao.id, substituida.id), isNull(integracaoLigacao.revogadoEm)));
          }
          const [nova] = await db
            .insert(integracaoLigacao)
            .values({
              contaId: a.conta_id,
              aplicativo: quem.clientId,
              produto: quem.app.produto,
              classe: 'dms',
              nome: quem.app.nome,
              segredoHash: resumoDoSegredo,
              prefixo,
              escopos,
              autorizacaoId: a.id,
              criadoEm: agora,
              segredoEm: agora,
            })
            .returning({ id: integracaoLigacao.id });
          id = nova!.id;
        }
      } catch (erro) {
        // A corrida de duas trocas da mesma conta: o índice único deixa uma só ligação ativa (V21).
        if (codigoDoPostgres(erro) === '23505') {
          throw new ErroProblema('autorizacao-invalida', 'Outra autorização desta conta terminou agora mesmo. Peça a autorização de novo.');
        }
        throw erro;
      }
      await db.update(integracaoAutorizacao).set({ ligacaoId: id }).where(eq(integracaoAutorizacao.id, a.id));

      const anteriores = ativa ? escoposEfetivos(ativa.escopos, ativa.classe) : [];
      const tipo: TipoDeLigacaoNova = !ativa ? 'nova' : escopos.some((e) => !anteriores.includes(e)) ? 'mais' : 'renovada';
      // O autor é o aplicativo, com o nome dele, como na troca automática e nas ferramentas da porta.
      await comAutorDaIntegracao({ tokenId: id, produto: quem.app.produto, nome: quem.app.nome, classe: 'dms' }, () =>
        this.auditoria.registrar({
          contaId: a.conta_id,
          acao: gira ? 'integracao.ligacao_girada' : 'integracao.ligacao_criada',
          entidade: 'integracao_ligacao',
          entidadeId: id,
          detalhe: { aplicativo: quem.app.produto, escopos, via: 'clique', autorizacao: a.id, tipo, ...(substituida ? { substituiu: substituida.id } : {}) },
        }),
      );
      return { id, contaNome: dona.nome, agora, tipo };
    });

    void this.avisos.ligacaoPorClique(a.conta_id, {
      aplicativo: quem.app.nome,
      contaQuePede: a.conta_que_pede,
      escopos,
      tipo: feita.tipo,
      quando: feita.agora,
    });
    return { ligacao: chave, prefixo, conta_id: a.conta_id, conta: feita.contaNome, permissoes: escopos, segredo_em: feita.agora.toISOString() };
  }

  /** O código já usado chegou de novo: a ligação que ele criou cai, se ainda for dele. Transação própria (a recusa vem depois). */
  private async desligarPeloReuso(resumo: string, clientId: string): Promise<void> {
    await this.ctx.comEscopoSistema('integracao.autorizacao.reuso', async (db) => {
      const [a] = await db
        .select({ id: integracaoAutorizacao.id, contaId: integracaoAutorizacao.contaId, ligacaoId: integracaoAutorizacao.ligacaoId })
        .from(integracaoAutorizacao)
        .where(and(eq(integracaoAutorizacao.codigoHash, resumo), eq(integracaoAutorizacao.aplicativo, clientId), sql`${integracaoAutorizacao.codigoUsadoEm} is not null`))
        .limit(1);
      if (!a?.ligacaoId) return;
      const caiu = await db
        .update(integracaoLigacao)
        .set({ revogadoEm: new Date(), revogadoPor: 'código de autorização usado duas vezes' })
        .where(and(eq(integracaoLigacao.id, a.ligacaoId), eq(integracaoLigacao.autorizacaoId, a.id), isNull(integracaoLigacao.revogadoEm)))
        .returning({ id: integracaoLigacao.id });
      if (caiu.length) {
        await this.auditoria.registrar({
          contaId: a.contaId,
          atorTipo: 'sistema',
          acao: 'integracao.ligacao_revogada',
          entidade: 'integracao_ligacao',
          entidadeId: a.ligacaoId,
          detalhe: { motivo: 'codigo_reutilizado', autorizacao: a.id },
        });
      }
    });
  }
}

/** O código do Postgres de um erro do Drizzle (no `cause`) ou do `pg` (direto). */
function codigoDoPostgres(erro: unknown): string | undefined {
  const direto = (erro as { code?: unknown })?.code;
  if (typeof direto === 'string') return direto;
  const causa = (erro as { cause?: { code?: unknown } })?.cause?.code;
  return typeof causa === 'string' ? causa : undefined;
}
