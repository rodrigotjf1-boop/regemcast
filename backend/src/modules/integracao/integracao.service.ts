/**
 * Tokens de integração: emitir, listar, revogar e reconhecer quem chega.
 *
 * O token é a credencial de outro produto para entrar pela porta MCP
 * (`mcp.controller.ts`). Vale para uma conta, guarda só o hash e carrega os
 * escopos e a classe (`integracao.regras.ts`).
 *
 * - **Quem emite:** a distribuição, pelo console (piloto). O token em claro sai
 *   na resposta da emissão e em mais lugar nenhum.
 * - **Quem revoga:** a distribuição, ou o dono da conta em "Aplicativos
 *   conectados" — a decisão de expor a conta é dele.
 * - **Quem chega:** é reconhecido pelo hash, sem conta no contexto (o token é
 *   que diz de quem é). Por isso a leitura é em escopo de sistema, motivo A de
 *   `docs/rls.md`; daí em diante tudo roda em `comConta`.
 */
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional, UnauthorizedException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { ContextoDb } from '../../db/contexto';
import { auditoria, conta, integracaoAutorizacao, integracaoLigacao, integracaoToken } from '../../db/schema';
import { ErroProblema, gerarChave, resumoChave, type TokenDmsId } from '../../dms/integracao-dms';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { comAutorDaIntegracao } from '../auditoria/autor-integracao';
import { APLICATIVOS_DA_AUTORIZACAO, type ContaQuePede } from './autorizacao.regras';
import { AvisoDeLigacao } from './aviso-de-ligacao.service';
import {
  conferirEmissao,
  descreverEscopos,
  ehTokenDeIntegracao,
  escoposEfetivos,
  gerarToken,
  hashDoToken,
  prefixoVisivel,
  type ClasseDoToken,
  type DadosDaEmissao,
} from './integracao.regras';
import { LIGACAO_INVALIDA, ligacaoVale, permissoesDaLigacao, podeTrocar, TROCA_RECUSADA } from './ligacao.regras';

/** A conta suspensa ou cancelada, na via do DMS ID (a do `rct_it_` segue com a frase dela). */
const CONTA_BLOQUEADA = 'A conta desta ligação está suspensa ou cancelada. O dono da conta resolve no RegemCast.';

/** A ligação entregue na troca: o segredo em claro sai aqui e em mais lugar nenhum. */
export interface LigacaoEntregue {
  ligacao: string;
  prefixo: string;
  conta_id: string;
  conta: string;
  permissoes: string[];
  segredo_em: string;
}

/** Quem entrou pela porta: o que as ferramentas precisam saber. */
export interface IntegracaoAutenticada {
  tokenId: string;
  contaId: string;
  contaNome: string;
  /** O fuso da conta (IANA): é nele que valem as janelas e os períodos dela. */
  contaFuso: string;
  produto: string;
  classe: ClasseDoToken;
  nome: string;
  escopos: string[];
}

/** Um token como as telas mostram. Nunca o hash, nunca o token em claro. */
export interface TokenParaTela {
  id: string;
  produto: string;
  classe: ClasseDoToken;
  nome: string;
  prefixo: string;
  escopos: Array<{ id: string; rotulo: string; descricao: string }>;
  criadoPor: string | null;
  criadoEm: Date;
  ultimoUsoEm: Date | null;
  revogadoEm: Date | null;
  revogadoPor: string | null;
}

export interface TokenNoConsole extends TokenParaTela {
  contaId: string;
  contaNome: string;
}

/**
 * Um aplicativo como "Aplicativos conectados" mostra: o token (e a ligação que
 * veio dele, mesmo id) ou a ligação por clique, com a autorização que o dono
 * deu (o texto guardado é a prova) e o histórico tirado da auditoria.
 */
export interface AplicativoParaTela extends TokenParaTela {
  /** `distribuicao`: o token emitido pela DMS (e a ligação que nasceu dele); `clique`: autorizado pelo dono na página. */
  via: 'distribuicao' | 'clique';
  autorizacao: null | {
    em: Date;
    por: string;
    versao: number;
    texto: unknown;
    contaQuePede: ContaQuePede;
    outraEmpresa: boolean;
  };
  historico: { em: Date; texto: string }[];
}

/** O nome do aplicativo de um produto, como a tela e o e-mail mostram. */
function nomeDoProduto(produto: string): string {
  return Object.hasOwn(APLICATIVOS_DA_AUTORIZACAO, produto) ? APLICATIVOS_DA_AUTORIZACAO[produto]!.nome : produto.charAt(0).toUpperCase() + produto.slice(1);
}

/** Cada evento da auditoria que entra no histórico de um aplicativo, numa frase. Nulo = não entra. */
function fraseDoHistorico(e: { acao: string; atorTipo: string; atorNome: string | null; detalhe: unknown }): string | null {
  const d = (e.detalhe ?? {}) as Record<string, unknown>;
  // A auditoria só guarda o nome do ator quando é um aplicativo; para pessoa, o nome vai no detalhe (`por`).
  const quem = (typeof d.por === 'string' && d.por) || e.atorNome || 'alguém da conta';
  switch (e.acao) {
    case 'integracao.token_emitido':
      return 'Ligado pela DMS, a seu pedido.';
    case 'integracao.autorizacao_concedida':
      return `${quem} autorizou com a senha (texto versão ${String(d.textoVersao ?? 1)}).`;
    case 'integracao.ligacao_criada':
      return d.via === 'clique' ? null : 'Passou sozinho para a ligação nova, com as mesmas permissões.';
    case 'integracao.ligacao_girada':
      return d.via === 'clique' ? null : 'O aplicativo renovou a ligação, com as mesmas permissões.';
    case 'integracao.token_revogado':
    case 'integracao.ligacao_revogada':
      if (d.motivo === 'codigo_reutilizado') return 'Desligado: o código de autorização foi usado duas vezes.';
      if (d.pelo === 'proprio_aplicativo') return 'Desligado pelo próprio aplicativo.';
      if (e.atorTipo === 'distribuicao') return 'Desligado pela DMS.';
      return `Desligado por ${quem}.`;
    default:
      return null;
  }
}

const ACOES_DO_HISTORICO = [
  'integracao.token_emitido',
  'integracao.autorizacao_concedida',
  'integracao.ligacao_criada',
  'integracao.ligacao_girada',
  'integracao.token_revogado',
  'integracao.ligacao_revogada',
];

const CAMPOS = {
  id: integracaoToken.id,
  produto: integracaoToken.produto,
  classe: integracaoToken.classe,
  nome: integracaoToken.nome,
  prefixo: integracaoToken.prefixo,
  escopos: integracaoToken.escopos,
  criadoPor: integracaoToken.criadoPor,
  criadoEm: integracaoToken.criadoEm,
  ultimoUsoEm: integracaoToken.ultimoUsoEm,
  revogadoEm: integracaoToken.revogadoEm,
  revogadoPor: integracaoToken.revogadoPor,
};

function paraTela(l: {
  id: string;
  produto: string;
  classe: string;
  nome: string;
  prefixo: string;
  escopos: unknown;
  criadoPor: string | null;
  criadoEm: Date;
  ultimoUsoEm: Date | null;
  revogadoEm: Date | null;
  revogadoPor: string | null;
}): TokenParaTela {
  return {
    id: l.id,
    produto: l.produto,
    classe: l.classe as ClasseDoToken,
    nome: l.nome,
    prefixo: l.prefixo,
    escopos: descreverEscopos(escoposEfetivos(l.escopos, l.classe)),
    criadoPor: l.criadoPor,
    criadoEm: l.criadoEm,
    ultimoUsoEm: l.ultimoUsoEm,
    revogadoEm: l.revogadoEm,
    revogadoPor: l.revogadoPor,
  };
}

@Injectable()
export class IntegracaoService {
  constructor(
    private readonly ctx: ContextoDb,
    private readonly auditoria: AuditoriaService,
    /** O aviso ao dono quando a troca automática cria a ligação (decisão F2-3). */
    @Optional() private readonly avisoDeLigacao?: AvisoDeLigacao,
  ) {}

  // ------------------------------------------------------------- distribuição

  /**
   * Emite um token para uma conta. Devolve o token em claro UMA vez — ele não
   * é guardado e não dá para ler de novo.
   */
  async emitir(contaId: string, dados: DadosDaEmissao, operador: string): Promise<{ token: string; emitido: TokenNoConsole }> {
    const conferido = conferirEmissao(dados);
    if ('erro' in conferido) throw new BadRequestException(conferido.erro);

    const token = gerarToken();
    const emitido = await this.ctx.comEscopoSistema('integracao.token.emitir', async (db) => {
      const [dona] = await db.select({ id: conta.id, nome: conta.nome }).from(conta).where(eq(conta.id, contaId)).limit(1);
      if (!dona) throw new NotFoundException('Conta não encontrada.');

      const [criado] = await db
        .insert(integracaoToken)
        .values({
          contaId,
          produto: conferido.produto,
          classe: conferido.classe,
          nome: conferido.nome,
          tokenHash: hashDoToken(token),
          prefixo: prefixoVisivel(token),
          escopos: conferido.escopos,
          criadoPor: operador,
        })
        .returning(CAMPOS);
      return { ...paraTela(criado!), contaId, contaNome: dona.nome };
    });

    // Fora da transação da emissão: o rastro na conta não pode desfazer o token já entregue.
    await this.auditoria.registrarForaDeContexto({
      contaId,
      atorTipo: 'distribuicao',
      acao: 'integracao.token_emitido',
      entidade: 'integracao_token',
      entidadeId: emitido.id,
      detalhe: { produto: conferido.produto, classe: conferido.classe, nome: conferido.nome, escopos: conferido.escopos, operador },
    });
    return { token, emitido };
  }

  /** Todos os tokens, de todas as contas, os mais novos primeiro. */
  async listarTodos(): Promise<TokenNoConsole[]> {
    return this.ctx.comEscopoSistema('integracao.token.listar', async (db) => {
      const linhas = await db
        .select({ ...CAMPOS, contaId: integracaoToken.contaId, contaNome: conta.nome })
        .from(integracaoToken)
        .innerJoin(conta, eq(conta.id, integracaoToken.contaId))
        .orderBy(desc(integracaoToken.criadoEm))
        .limit(500);
      return linhas.map((l) => ({ ...paraTela(l), contaId: l.contaId, contaNome: l.contaNome }));
    });
  }

  /** A distribuição revoga. Revogar de novo não muda nada. */
  async revogarPeloConsole(id: string, operador: string): Promise<{ contaId: string; nome: string }> {
    const revogado = await this.ctx.comEscopoSistema('integracao.token.revogar', async (db) => {
      const [alvo] = await db
        .select({ id: integracaoToken.id, contaId: integracaoToken.contaId, nome: integracaoToken.nome, revogadoEm: integracaoToken.revogadoEm })
        .from(integracaoToken)
        .where(eq(integracaoToken.id, id))
        .limit(1);
      if (!alvo) throw new NotFoundException('Token não encontrado.');
      if (!alvo.revogadoEm) {
        const agora = new Date();
        const por = `${operador} (distribuição)`;
        await db
          .update(integracaoToken)
          .set({ revogadoEm: agora, revogadoPor: por })
          .where(and(eq(integracaoToken.id, id), isNull(integracaoToken.revogadoEm)));
        // A ligação que veio deste token (mesmo id) cai junto: revogar um revoga o outro.
        await db
          .update(integracaoLigacao)
          .set({ revogadoEm: agora, revogadoPor: por })
          .where(and(eq(integracaoLigacao.id, id), isNull(integracaoLigacao.revogadoEm)));
      }
      return { contaId: alvo.contaId, nome: alvo.nome, jaEstava: Boolean(alvo.revogadoEm) };
    });

    if (!revogado.jaEstava) {
      await this.auditoria.registrarForaDeContexto({
        contaId: revogado.contaId,
        atorTipo: 'distribuicao',
        acao: 'integracao.token_revogado',
        entidade: 'integracao_token',
        entidadeId: id,
        detalhe: { nome: revogado.nome, operador },
      });
    }
    return { contaId: revogado.contaId, nome: revogado.nome };
  }

  // ------------------------------------------------------------------- conta

  /**
   * "Aplicativos conectados": os tokens da conta (com a ligação que veio de cada
   * um, mesmo id) e as ligações por clique, ativos primeiro, com a autorização do
   * dono e o histórico da auditoria. Roda na transação do pedido.
   */
  async daConta(contaId: string): Promise<AplicativoParaTela[]> {
    const tokens = await this.ctx.db
      .select(CAMPOS)
      .from(integracaoToken)
      .where(eq(integracaoToken.contaId, contaId))
      .orderBy(desc(integracaoToken.criadoEm))
      .limit(100);
    const ligacoes = await this.ctx.db
      .select({
        id: integracaoLigacao.id,
        produto: integracaoLigacao.produto,
        classe: integracaoLigacao.classe,
        nome: integracaoLigacao.nome,
        prefixo: integracaoLigacao.prefixo,
        escopos: integracaoLigacao.escopos,
        origemTokenId: integracaoLigacao.origemTokenId,
        autorizacaoId: integracaoLigacao.autorizacaoId,
        criadoEm: integracaoLigacao.criadoEm,
        ultimoUsoEm: integracaoLigacao.ultimoUsoEm,
        revogadoEm: integracaoLigacao.revogadoEm,
        revogadoPor: integracaoLigacao.revogadoPor,
      })
      .from(integracaoLigacao)
      .where(eq(integracaoLigacao.contaId, contaId))
      .orderBy(desc(integracaoLigacao.criadoEm))
      .limit(100);

    const idsDeAutorizacao = ligacoes.map((l) => l.autorizacaoId).filter((id): id is string => Boolean(id));
    const autorizacoes = idsDeAutorizacao.length
      ? await this.ctx.db
          .select({
            id: integracaoAutorizacao.id,
            criadoEm: integracaoAutorizacao.criadoEm,
            usuarioNome: integracaoAutorizacao.usuarioNome,
            textoVersao: integracaoAutorizacao.textoVersao,
            texto: integracaoAutorizacao.texto,
            contaQuePede: integracaoAutorizacao.contaQuePede,
            outraEmpresa: integracaoAutorizacao.outraEmpresa,
          })
          .from(integracaoAutorizacao)
          .where(and(eq(integracaoAutorizacao.contaId, contaId), inArray(integracaoAutorizacao.id, idsDeAutorizacao)))
      : [];
    const autorizacaoPorId = new Map(autorizacoes.map((a) => [a.id, a]));

    // O histórico de cada aplicativo é o que a auditoria registrou sobre ele: o token, a ligação e as autorizações dela.
    const idsDaAuditoria = [...new Set([...tokens.map((t) => t.id), ...ligacoes.map((l) => l.id), ...idsDeAutorizacao])];
    const eventos = idsDaAuditoria.length
      ? await this.ctx.db
          .select({
            entidadeId: auditoria.entidadeId,
            acao: auditoria.acao,
            atorTipo: auditoria.atorTipo,
            atorNome: auditoria.atorNome,
            detalhe: auditoria.detalhe,
            criadoEm: auditoria.criadoEm,
          })
          .from(auditoria)
          .where(and(eq(auditoria.contaId, contaId), inArray(auditoria.entidadeId, idsDaAuditoria), inArray(auditoria.acao, ACOES_DO_HISTORICO)))
          .orderBy(desc(auditoria.criadoEm))
          .limit(300)
      : [];
    const historicoDe = (ids: (string | null | undefined)[]) =>
      eventos
        .filter((e) => e.entidadeId !== null && ids.includes(e.entidadeId))
        .map((e) => ({ em: e.criadoEm, texto: fraseDoHistorico(e) }))
        .filter((h): h is { em: Date; texto: string } => h.texto !== null);
    const autorizacaoDe = (id: string | null) => {
      const a = id ? autorizacaoPorId.get(id) : undefined;
      return a
        ? { em: a.criadoEm, por: a.usuarioNome, versao: a.textoVersao, texto: a.texto, contaQuePede: a.contaQuePede as ContaQuePede, outraEmpresa: a.outraEmpresa }
        : null;
    };

    const ligacaoPorId = new Map(ligacoes.map((l) => [l.id, l]));
    const doToken: AplicativoParaTela[] = tokens.map((t) => {
      const l = ligacaoPorId.get(t.id);
      const base = paraTela(t);
      if (!l) return { ...base, via: 'distribuicao', autorizacao: null, historico: historicoDe([t.id]) };
      // O token e a ligação que veio dele são um aplicativo só: as permissões e o último uso valem pela ligação.
      const ultimoUso = [t.ultimoUsoEm, l.ultimoUsoEm].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      return {
        ...base,
        escopos: l.revogadoEm ? base.escopos : descreverEscopos(escoposEfetivos(l.escopos, l.classe)),
        ultimoUsoEm: ultimoUso,
        via: 'distribuicao',
        autorizacao: autorizacaoDe(l.autorizacaoId),
        historico: historicoDe([t.id, l.autorizacaoId]),
      };
    });
    const porClique: AplicativoParaTela[] = ligacoes
      .filter((l) => !l.origemTokenId && !tokens.some((t) => t.id === l.id))
      .map((l) => {
        const autorizacao = autorizacaoDe(l.autorizacaoId);
        return {
          id: l.id,
          produto: l.produto,
          classe: l.classe as ClasseDoToken,
          nome: l.nome,
          prefixo: l.prefixo,
          escopos: descreverEscopos(escoposEfetivos(l.escopos, l.classe)),
          criadoPor: autorizacao?.por ?? null,
          criadoEm: l.criadoEm,
          ultimoUsoEm: l.ultimoUsoEm,
          revogadoEm: l.revogadoEm,
          revogadoPor: l.revogadoPor,
          via: 'clique',
          autorizacao,
          historico: historicoDe([l.id, l.autorizacaoId]),
        };
      });

    return [...doToken, ...porClique].sort(
      (a, b) => Number(Boolean(a.revogadoEm)) - Number(Boolean(b.revogadoEm)) || b.criadoEm.getTime() - a.criadoEm.getTime(),
    );
  }

  /**
   * O dono da conta desliga um aplicativo: o token (e a ligação que veio dele) ou
   * a ligação por clique. Para de valer na chamada seguinte.
   */
  async revogarPelaConta(contaId: string, usuario: { id: string; nome: string }, id: string): Promise<AplicativoParaTela[]> {
    const [token] = await this.ctx.db
      .select({ id: integracaoToken.id, nome: integracaoToken.nome, produto: integracaoToken.produto, revogadoEm: integracaoToken.revogadoEm })
      .from(integracaoToken)
      .where(and(eq(integracaoToken.id, id), eq(integracaoToken.contaId, contaId)))
      .limit(1);
    const [ligacao] = await this.ctx.db
      .select({ id: integracaoLigacao.id, nome: integracaoLigacao.nome, produto: integracaoLigacao.produto, revogadoEm: integracaoLigacao.revogadoEm })
      .from(integracaoLigacao)
      .where(and(eq(integracaoLigacao.id, id), eq(integracaoLigacao.contaId, contaId)))
      .limit(1);
    // 404 e não 403: não confirma a existência de aplicativo de outra conta.
    if (!token && !ligacao) throw new NotFoundException('Aplicativo não encontrado.');

    const agora = new Date();
    if (token && !token.revogadoEm) {
      await this.ctx.db
        .update(integracaoToken)
        .set({ revogadoEm: agora, revogadoPor: usuario.nome })
        .where(and(eq(integracaoToken.id, id), eq(integracaoToken.contaId, contaId), isNull(integracaoToken.revogadoEm)));
      await this.ctx.db
        .update(integracaoLigacao)
        .set({ revogadoEm: agora, revogadoPor: usuario.nome })
        .where(and(eq(integracaoLigacao.id, id), eq(integracaoLigacao.contaId, contaId), isNull(integracaoLigacao.revogadoEm)));
      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuario.id,
        acao: 'integracao.token_revogado',
        entidade: 'integracao_token',
        entidadeId: id,
        detalhe: { nome: token.nome, produto: token.produto, por: usuario.nome },
      });
    } else if (ligacao && !ligacao.revogadoEm) {
      await this.ctx.db
        .update(integracaoLigacao)
        .set({ revogadoEm: agora, revogadoPor: usuario.nome })
        .where(and(eq(integracaoLigacao.id, id), eq(integracaoLigacao.contaId, contaId), isNull(integracaoLigacao.revogadoEm)));
      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuario.id,
        acao: 'integracao.ligacao_revogada',
        entidade: 'integracao_ligacao',
        entidadeId: id,
        detalhe: { nome: ligacao.nome, produto: ligacao.produto, por: usuario.nome },
      });
    }
    return this.daConta(contaId);
  }

  /**
   * O próprio aplicativo desliga o token dele (a ferramenta `integracao_revogar`):
   * é o "desconectar" do outro lado. Roda na conta do token, e a trilha registra
   * o autor `integracao` (a porta MCP define o autor). Repetir não muda nada.
   */
  async revogarPeloProprio(quem: Pick<IntegracaoAutenticada, 'tokenId' | 'contaId' | 'nome' | 'produto'>): Promise<Date> {
    const agora = new Date();
    const por = `o próprio aplicativo (${quem.produto})`;
    // Pelas duas vias o id é o mesmo: a ligação que veio de um token herda o id dele. Cai o token e cai a ligação.
    const [doToken] = await this.ctx.db
      .update(integracaoToken)
      .set({ revogadoEm: agora, revogadoPor: por })
      .where(and(eq(integracaoToken.id, quem.tokenId), eq(integracaoToken.contaId, quem.contaId), isNull(integracaoToken.revogadoEm)))
      .returning({ revogadoEm: integracaoToken.revogadoEm });
    const [daLigacao] = await this.ctx.db
      .update(integracaoLigacao)
      .set({ revogadoEm: agora, revogadoPor: por })
      .where(and(eq(integracaoLigacao.id, quem.tokenId), eq(integracaoLigacao.contaId, quem.contaId), isNull(integracaoLigacao.revogadoEm)))
      .returning({ revogadoEm: integracaoLigacao.revogadoEm });
    const mudou = doToken ?? daLigacao;
    if (mudou) {
      await this.auditoria.registrar({
        contaId: quem.contaId,
        acao: 'integracao.token_revogado',
        entidade: 'integracao_token',
        entidadeId: quem.tokenId,
        detalhe: { nome: quem.nome, produto: quem.produto, pelo: 'proprio_aplicativo' },
      });
    }
    return mudou?.revogadoEm ?? agora;
  }

  // ------------------------------------------------------------------- porta

  /**
   * Reconhece quem chega pela porta MCP. Recusa com 401 o token que não existe
   * ou foi revogado — a mesma resposta para os dois, para não dizer a quem
   * sonda qual token já existiu — e com 403 o de conta suspensa ou cancelada.
   *
   * Anota o último uso no máximo uma vez por minuto: uma escrita por chamada
   * seria o banco trabalhando para o relógio.
   */
  async autenticar(token: string): Promise<IntegracaoAutenticada> {
    const hash = hashDoToken(token);
    return this.ctx.comEscopoSistema('integracao.token.autenticar', async (db) => {
      const [l] = await db
        .select({
          id: integracaoToken.id,
          contaId: integracaoToken.contaId,
          produto: integracaoToken.produto,
          classe: integracaoToken.classe,
          nome: integracaoToken.nome,
          escopos: integracaoToken.escopos,
          revogadoEm: integracaoToken.revogadoEm,
          contaNome: conta.nome,
          contaFuso: conta.timezone,
          contaStatus: conta.status,
        })
        .from(integracaoToken)
        .innerJoin(conta, eq(conta.id, integracaoToken.contaId))
        .where(eq(integracaoToken.tokenHash, hash))
        .limit(1);

      if (!l || l.revogadoEm) throw new UnauthorizedException('Token de integração inválido ou revogado.');
      if (l.contaStatus === 'suspensa' || l.contaStatus === 'cancelada') {
        throw new ForbiddenException('A conta deste token está suspensa ou cancelada.');
      }

      await db.execute(sql`
        update integracao_token set ultimo_uso_em = now()
         where id = ${l.id} and (ultimo_uso_em is null or ultimo_uso_em < now() - interval '1 minute')
      `);

      return {
        tokenId: l.id,
        contaId: l.contaId,
        contaNome: l.contaNome,
        contaFuso: l.contaFuso,
        produto: l.produto,
        classe: l.classe as ClasseDoToken,
        nome: l.nome,
        escopos: escoposEfetivos(l.escopos, l.classe),
      };
    });
  }

  // ---------------------------------------------------- porta, via do DMS ID

  /**
   * Reconhece a ligação de quem chega pela via do DMS ID, com o token já
   * conferido (`DmsIdService.conferir`). Ligação ausente, inexistente, revogada,
   * de cliente de fora ou de outro aplicativo: 401 `ligacao-invalida`, a MESMA
   * resposta para todos. Conta suspensa ou cancelada: 403 `conta-bloqueada`.
   *
   * O `tokenId` devolvido é o id da ligação, que é o do token de onde ela veio:
   * o limite por minuto, a idempotência e a revogação seguem a mesma chave pelas
   * duas vias. Valem as permissões que a ligação tem E o token também.
   */
  async autenticarLigacao(
    segredo: string | null,
    doToken: Pick<TokenDmsId, 'aplicativo' | 'permissoes'>,
    aplicativos: Readonly<Record<string, string>>,
  ): Promise<IntegracaoAutenticada> {
    if (!segredo) throw new ErroProblema('ligacao-invalida', LIGACAO_INVALIDA);
    const resumo = resumoChave(segredo);
    return this.ctx.comEscopoSistema('integracao.ligacao.autenticar', async (db) => {
      const [l] = await db
        .select({
          id: integracaoLigacao.id,
          contaId: integracaoLigacao.contaId,
          aplicativo: integracaoLigacao.aplicativo,
          produto: integracaoLigacao.produto,
          classe: integracaoLigacao.classe,
          nome: integracaoLigacao.nome,
          escopos: integracaoLigacao.escopos,
          origemTokenId: integracaoLigacao.origemTokenId,
          revogadoEm: integracaoLigacao.revogadoEm,
          contaNome: conta.nome,
          contaFuso: conta.timezone,
          contaStatus: conta.status,
        })
        .from(integracaoLigacao)
        .innerJoin(conta, eq(conta.id, integracaoLigacao.contaId))
        .where(eq(integracaoLigacao.segredoHash, resumo))
        .limit(1);

      if (!ligacaoVale(l, doToken.aplicativo, aplicativos)) throw new ErroProblema('ligacao-invalida', LIGACAO_INVALIDA);
      if (l.contaStatus === 'suspensa' || l.contaStatus === 'cancelada') throw new ErroProblema('conta-bloqueada', CONTA_BLOQUEADA);

      await db.execute(sql`
        update integracao_ligacao set ultimo_uso_em = now()
         where id = ${l.id} and (ultimo_uso_em is null or ultimo_uso_em < now() - interval '1 minute')
      `);
      // "Aplicativos conectados" mostra o token de onde a ligação veio: o último uso dele acompanha a via nova.
      if (l.origemTokenId) {
        await db.execute(sql`
          update integracao_token set ultimo_uso_em = now()
           where id = ${l.origemTokenId} and (ultimo_uso_em is null or ultimo_uso_em < now() - interval '1 minute')
        `);
      }

      return {
        tokenId: l.id,
        contaId: l.contaId,
        contaNome: l.contaNome,
        contaFuso: l.contaFuso,
        produto: l.produto,
        classe: l.classe as ClasseDoToken,
        nome: l.nome,
        escopos: permissoesDaLigacao(l, doToken.permissoes),
      };
    });
  }

  /**
   * A troca automática (decisão F2-3): o aplicativo do DMS ID manda o token
   * dele e o `rct_it_` que já usa naquela conta, e recebe o segredo da ligação.
   * A ligação herda o id, a conta, o produto, o nome e as permissões do token.
   *
   * Repetir a troca GIRA o segredo: o anterior para de valer na hora, e quem
   * chama guarda o da última resposta. Duas trocas ao mesmo tempo esperam uma
   * pela outra (trava na linha do token). Token inexistente, revogado, de cliente
   * de fora ou de outro produto: a mesma recusa (`ligacao-invalida`).
   */
  async trocarPorLigacao(tokenIntegracao: unknown, aplicativo: string, aplicativos: Readonly<Record<string, string>>): Promise<LigacaoEntregue> {
    if (!ehTokenDeIntegracao(tokenIntegracao)) throw new ErroProblema('ligacao-invalida', TROCA_RECUSADA);
    const hash = hashDoToken(tokenIntegracao);
    const { chave, resumo, prefixo } = gerarChave('lg', 'regemcast');

    const feita = await this.ctx.comEscopoSistema('integracao.ligacao.trocar', async (db) => {
      const [t] = await db
        .select({
          id: integracaoToken.id,
          contaId: integracaoToken.contaId,
          produto: integracaoToken.produto,
          classe: integracaoToken.classe,
          nome: integracaoToken.nome,
          escopos: integracaoToken.escopos,
          criadoEm: integracaoToken.criadoEm,
          revogadoEm: integracaoToken.revogadoEm,
          contaNome: conta.nome,
          contaStatus: conta.status,
        })
        .from(integracaoToken)
        .innerJoin(conta, eq(conta.id, integracaoToken.contaId))
        .where(eq(integracaoToken.tokenHash, hash))
        .limit(1)
        .for('update', { of: integracaoToken });

      if (!t || !podeTrocar(t, aplicativo, aplicativos)) throw new ErroProblema('ligacao-invalida', TROCA_RECUSADA);
      if (t.contaStatus === 'suspensa' || t.contaStatus === 'cancelada') throw new ErroProblema('conta-bloqueada', CONTA_BLOQUEADA);

      const escopos = escoposEfetivos(t.escopos, t.classe);
      const agora = new Date();
      const [existente] = await db
        .select({ revogadoEm: integracaoLigacao.revogadoEm })
        .from(integracaoLigacao)
        .where(eq(integracaoLigacao.id, t.id))
        .limit(1);
      // Ligação revogada não volta pela troca, nem com o token ainda ativo.
      if (existente?.revogadoEm) throw new ErroProblema('ligacao-invalida', TROCA_RECUSADA);

      if (existente) {
        await db
          .update(integracaoLigacao)
          .set({ aplicativo, nome: t.nome, escopos, segredoHash: resumo, prefixo, segredoEm: agora })
          .where(and(eq(integracaoLigacao.id, t.id), isNull(integracaoLigacao.revogadoEm)));
      } else {
        await db.insert(integracaoLigacao).values({
          id: t.id,
          contaId: t.contaId,
          aplicativo,
          produto: t.produto,
          classe: t.classe,
          nome: t.nome,
          segredoHash: resumo,
          prefixo,
          escopos,
          origemTokenId: t.id,
          criadoEm: t.criadoEm,
          segredoEm: agora,
        });
      }
      return { id: t.id, contaId: t.contaId, contaNome: t.contaNome, produto: t.produto, nome: t.nome, escopos, criada: !existente, agora, liberadoEm: t.criadoEm };
    });

    // Fora da transação da troca: o rastro na conta não pode desfazer o segredo já entregue. O autor é o
    // aplicativo, com o nome do token, como nas ferramentas da porta.
    await comAutorDaIntegracao({ tokenId: feita.id, produto: feita.produto, nome: feita.nome, classe: 'dms' }, () =>
      this.auditoria.registrarForaDeContexto({
        contaId: feita.contaId,
        acao: feita.criada ? 'integracao.ligacao_criada' : 'integracao.ligacao_girada',
        entidade: 'integracao_ligacao',
        entidadeId: feita.id,
        detalhe: { aplicativo, escopos: feita.escopos },
      }),
    );
    // A ligação nasceu agora de um token antigo: o dono fica sabendo que a forma mudou (o alcance, não).
    if (feita.criada) {
      void this.avisoDeLigacao?.ligacaoMigrada(feita.contaId, {
        aplicativo: nomeDoProduto(feita.produto),
        escopos: feita.escopos,
        liberadoEm: feita.liberadoEm,
        desde: feita.agora,
      });
    }
    return {
      ligacao: chave,
      prefixo,
      conta_id: feita.contaId,
      conta: feita.contaNome,
      permissoes: feita.escopos,
      segredo_em: feita.agora.toISOString(),
    };
  }
}
