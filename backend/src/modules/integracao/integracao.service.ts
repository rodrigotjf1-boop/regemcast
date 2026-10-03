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
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { ContextoDb } from '../../db/contexto';
import { conta, integracaoToken } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import {
  conferirEmissao,
  descreverEscopos,
  escoposEfetivos,
  gerarToken,
  hashDoToken,
  prefixoVisivel,
  type ClasseDoToken,
  type DadosDaEmissao,
} from './integracao.regras';

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
        await db
          .update(integracaoToken)
          .set({ revogadoEm: new Date(), revogadoPor: `${operador} (distribuição)` })
          .where(and(eq(integracaoToken.id, id), isNull(integracaoToken.revogadoEm)));
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

  /** "Aplicativos conectados": os tokens da conta, ativos primeiro. Roda na transação do pedido. */
  async daConta(contaId: string): Promise<TokenParaTela[]> {
    const linhas = await this.ctx.db
      .select(CAMPOS)
      .from(integracaoToken)
      .where(eq(integracaoToken.contaId, contaId))
      .orderBy(sql`${integracaoToken.revogadoEm} is not null`, desc(integracaoToken.criadoEm))
      .limit(100);
    return linhas.map(paraTela);
  }

  /** O dono da conta desliga um aplicativo. O token para de valer na chamada seguinte. */
  async revogarPelaConta(contaId: string, usuario: { id: string; nome: string }, id: string): Promise<TokenParaTela[]> {
    const [alvo] = await this.ctx.db
      .select({ id: integracaoToken.id, nome: integracaoToken.nome, produto: integracaoToken.produto, revogadoEm: integracaoToken.revogadoEm })
      .from(integracaoToken)
      .where(and(eq(integracaoToken.id, id), eq(integracaoToken.contaId, contaId)))
      .limit(1);
    // 404 e não 403: não confirma a existência de token de outra conta.
    if (!alvo) throw new NotFoundException('Aplicativo não encontrado.');

    if (!alvo.revogadoEm) {
      await this.ctx.db
        .update(integracaoToken)
        .set({ revogadoEm: new Date(), revogadoPor: usuario.nome })
        .where(and(eq(integracaoToken.id, id), eq(integracaoToken.contaId, contaId), isNull(integracaoToken.revogadoEm)));
      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuario.id,
        acao: 'integracao.token_revogado',
        entidade: 'integracao_token',
        entidadeId: id,
        detalhe: { nome: alvo.nome, produto: alvo.produto },
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
    const [mudou] = await this.ctx.db
      .update(integracaoToken)
      .set({ revogadoEm: agora, revogadoPor: `o próprio aplicativo (${quem.produto})` })
      .where(and(eq(integracaoToken.id, quem.tokenId), eq(integracaoToken.contaId, quem.contaId), isNull(integracaoToken.revogadoEm)))
      .returning({ revogadoEm: integracaoToken.revogadoEm });
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
}
