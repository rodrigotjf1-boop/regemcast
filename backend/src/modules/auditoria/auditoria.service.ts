/**
 * Trilha de auditoria — append-only.
 *
 * A tabela é imutável por permissão (o role da aplicação não tem update/delete)
 * E por trigger, então este service só sabe inserir e ler. Não existe caminho
 * de correção: registro errado é corrigido com um registro novo.
 *
 * Duas portas de entrada, de propósito:
 *
 *   `registrar`              — grava DENTRO da transação corrente. Se falhar,
 *                              PROPAGA e derruba a operação junto. É o padrão:
 *                              a operação e a prova dela vivem no mesmo commit.
 *   `registrarForaDeContexto`— abre transação própria, em escopo de sistema, e
 *                              NÃO propaga. Para quem não pode falhar por causa
 *                              da auditoria (login recusado, webhook, job de
 *                              fila) ou quem grava depois do contexto fechar.
 *
 * A diferença existe porque no Regem o `registrar` engole toda exceção em
 * silêncio: quando a gravação falha, o rastro simplesmente não aparece e ninguém
 * descobre — nem a operação falha, nem o log diz nada. Aqui, quem engole é
 * explícito no nome do método e sempre loga o MOTIVO REAL (nome, mensagem,
 * code e detail do Postgres).
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { isIP } from 'node:net';

import { ContextoDb, type Db } from '../../db/contexto';
import { auditoria } from '../../db/schema';
import { autorDaIntegracao } from './autor-integracao';

export interface EntradaAuditoria {
  /** Ausente herda a conta do contexto corrente (ver comentário em `montar`). */
  contaId?: string | null;
  atorTipo?: 'usuario' | 'sistema' | 'distribuicao' | 'integracao';
  atorUsuarioId?: string | null;
  /** Verbo no formato `entidade.acao`, ex.: 'usuario.login', 'conta.criada'. */
  acao: string;
  entidade?: string;
  entidadeId?: string;
  detalhe?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

export interface ItemAuditoria {
  /** `bigserial` no banco: vai como string no JSON para não perder precisão. */
  id: string;
  atorTipo: string;
  atorUsuarioId: string | null;
  acao: string;
  entidade: string | null;
  entidadeId: string | null;
  detalhe: unknown;
  ip: string | null;
  userAgent: string | null;
  criadoEm: Date;
}

export interface PaginaAuditoria {
  itens: ItemAuditoria[];
  proximoCursor: string | null;
}

export interface FiltroAuditoria {
  contaId: string;
  limite: number;
  /** Id da última linha da página anterior. */
  cursor?: string;
  acao?: string;
}

/** `user_agent` vem do cliente; cortamos para não guardar texto sem limite. */
const MAX_USER_AGENT = 512;

@Injectable()
export class AuditoriaService {
  private readonly log = new Logger('Auditoria');

  constructor(private readonly ctx: ContextoDb) {}

  /**
   * Grava na transação corrente. Falha aqui derruba a operação inteira — é o
   * comportamento desejado para mutação relevante: sem prova, sem efeito.
   */
  async registrar(entrada: EntradaAuditoria): Promise<void> {
    await this.inserir(this.ctx.db, entrada);
  }

  /**
   * Grava em transação própria e engole a falha (logando o motivo real). Use
   * quando a auditoria não pode derrubar a operação — ou quando não há
   * transação aberta, como em job de fila e webhook.
   */
  async registrarForaDeContexto(entrada: EntradaAuditoria): Promise<void> {
    try {
      await this.ctx.comEscopoSistema('auditoria', (db) => this.inserir(db, entrada));
    } catch (erro) {
      // Nunca logamos `detalhe`: ele carrega dado do cliente (telefone, e-mail).
      const e = erro as Error & { code?: string; detail?: string };
      this.log.error(
        `Não gravei a auditoria "${entrada.acao}": ` +
          `${e?.name ?? 'Erro'}: ${e?.message ?? String(erro)}` +
          (e?.code ? ` (code ${e.code})` : '') +
          (e?.detail ? ` — ${e.detail}` : ''),
        e?.stack,
      );
    }
  }

  /** Trilha da conta, mais recente primeiro, paginada por cursor. */
  async listar(filtro: FiltroAuditoria): Promise<PaginaAuditoria> {
    const condicoes: SQL[] = [eq(auditoria.contaId, filtro.contaId)];

    if (filtro.acao) condicoes.push(eq(auditoria.acao, filtro.acao));

    if (filtro.cursor !== undefined) {
      // O DTO já valida o formato; a checagem aqui existe porque o service
      // também é chamado de dentro do backend, e cursor inválido precisa virar
      // 400 em vez de um 500 de conversão.
      if (!/^\d{1,19}$/.test(filtro.cursor)) {
        throw new BadRequestException(
          'O cursor precisa ser o id da última linha da página anterior.',
        );
      }
      condicoes.push(lt(auditoria.id, BigInt(filtro.cursor)));
    }

    // Ordena por id, não por criado_em: o id é monotônico e não empata, então
    // o cursor nunca pula nem repete linha gravada no mesmo instante.
    // Pedimos um a mais só para saber se existe página seguinte.
    const linhas = await this.ctx.db
      .select({
        id: auditoria.id,
        atorTipo: auditoria.atorTipo,
        atorUsuarioId: auditoria.atorUsuarioId,
        acao: auditoria.acao,
        entidade: auditoria.entidade,
        entidadeId: auditoria.entidadeId,
        detalhe: auditoria.detalhe,
        ip: auditoria.ip,
        userAgent: auditoria.userAgent,
        criadoEm: auditoria.criadoEm,
      })
      .from(auditoria)
      .where(and(...condicoes))
      .orderBy(desc(auditoria.id))
      .limit(filtro.limite + 1);

    const temMais = linhas.length > filtro.limite;
    const pagina = temMais ? linhas.slice(0, filtro.limite) : linhas;

    return {
      itens: pagina.map((l) => ({ ...l, id: String(l.id) })),
      proximoCursor: temMais ? String(pagina[pagina.length - 1]!.id) : null,
    };
  }

  private async inserir(db: Db, entrada: EntradaAuditoria): Promise<void> {
    await db.insert(auditoria).values(this.montar(entrada));
  }

  private montar(entrada: EntradaAuditoria) {
    const doContexto = this.ctx.contaId;

    // Em escopo de conta a policy é `with check (conta_id = rc_conta_atual())`:
    // gravar com conta_id nulo ou de outra conta é rejeitado pela RLS. Herdar a
    // conta do contexto não é conveniência, é o que faz o insert passar — e
    // conta divergente vira erro explicado aqui, em vez de um 42501 cru.
    if (doContexto && entrada.contaId && entrada.contaId !== doContexto) {
      throw new Error(
        'Tentativa de auditar em outra conta: o contexto está na conta ' +
          `${doContexto}. Abra o contexto da conta certa antes de registrar.`,
      );
    }

    // Dentro de uma ferramenta do MCP, o que o serviço registra como "usuário"
    // sem dizer qual é, na verdade, do aplicativo conectado: sai com o autor
    // `integracao` e o nome do token (`autor-integracao.ts`). O que já vem com
    // uma pessoa, ou como sistema ou distribuição, fica como veio.
    const integracao = autorDaIntegracao();
    const daIntegracao = Boolean(integracao) && !entrada.atorUsuarioId && (entrada.atorTipo ?? 'usuario') === 'usuario';

    return {
      contaId: entrada.contaId ?? doContexto ?? null,
      atorTipo: daIntegracao ? 'integracao' : (entrada.atorTipo ?? 'usuario'),
      atorUsuarioId: entrada.atorUsuarioId ?? null,
      ...(daIntegracao ? { atorNome: `${integracao!.nome} (${integracao!.produto})`.slice(0, 200) } : {}),
      acao: entrada.acao,
      entidade: entrada.entidade ?? null,
      entidadeId: entrada.entidadeId ?? null,
      // A coluna é `not null default '{}'`; explicitar evita depender do default.
      detalhe: daIntegracao
        ? { ...(entrada.detalhe ?? {}), integracao: { produto: integracao!.produto, classe: integracao!.classe, tokenId: integracao!.tokenId } }
        : (entrada.detalhe ?? {}),
      // A coluna é `inet`: string fora do formato estouraria o insert e levaria
      // a operação inteira embora. Vale mais perder o IP do que o registro.
      ip: entrada.ip && isIP(entrada.ip) ? entrada.ip : null,
      userAgent: entrada.userAgent ? entrada.userAgent.slice(0, MAX_USER_AGENT) : null,
    };
  }
}
