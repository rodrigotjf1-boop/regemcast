/**
 * Públicos salvos (migration 053): as regras do público com nome, para usar de
 * novo. Guardam as REGRAS, não as pessoas — a contagem de cada um ("podem
 * receber hoje") é feita na hora, com `expressaoDasRegras`, a MESMA condição da
 * prévia e da montagem da campanha.
 *
 * Criar, renomear, editar as regras e duplicar: qualquer usuário da conta.
 * Excluir: só o dono (o controlador). Excluir não mexe em campanha: o id
 * gravado nela fica só para contar os usos.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { ContextoDb } from '../../db/contexto';
import { publicoSalvo } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { CriarPublicoSalvoDto, EditarPublicoSalvoDto } from './dto/regra-do-publico.dto';
import { contextoDasRegras } from './origem-do-publico';
import {
  CAMPOS,
  MAX_REGRAS,
  NOMES_DAS_COMPARACOES,
  descreverRegra,
  expressaoDasRegras,
  validarRegras,
  type RegraDoPublico,
} from './regras-do-publico';

/** Mais que isso a lista vira uma tela que ninguém percorre. */
export const MAX_PUBLICOS_SALVOS = 200;
const TAMANHO_DO_NOME = 80;

export interface PublicoSalvoParaTela {
  id: string;
  nome: string;
  regras: RegraDoPublico[];
  /** Uma frase por regra, pronta para mostrar. */
  resumo: string[];
  /** Quantos podem receber hoje; nulo quando uma regra não vale mais. */
  total: number | null;
  /** Por que não dá para usar (uma regra saiu da lista); nulo quando está tudo certo. */
  problema: string | null;
  usos: { campanhas: number; ultimaEm: Date | null };
  criadoEm: Date;
  atualizadoEm: Date;
}

type Linha = typeof publicoSalvo.$inferSelect;

/**
 * O nome sem diferença de maiúscula, para o índice único: calculado aqui, em
 * pt-BR — o `lower()` do banco depende do `lc_ctype` e, em "C", não baixa
 * "MÊS" para "mês" (ERR-059).
 */
export function chaveDoNome(nome: string): string {
  return nome.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
}

function nomeLimpo(nome: unknown): string {
  const n = typeof nome === 'string' ? nome.replace(/\s+/g, ' ').trim() : '';
  if (!n) throw new BadRequestException('Dê um nome ao público.');
  if (n.length > TAMANHO_DO_NOME) throw new BadRequestException(`O nome tem até ${TAMANHO_DO_NOME} letras.`);
  return n;
}

function regrasConferidas(regras: unknown): RegraDoPublico[] {
  const v = validarRegras(regras);
  if ('erro' in v) throw new BadRequestException(v.erro);
  return v.regras;
}

/** Violação do índice único do nome (direta ou na `cause` do driver). */
function nomeRepetido(erro: unknown): boolean {
  const e = erro as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

const JA_EXISTE = 'Já existe um público salvo com este nome. Escolha outro.';

@Injectable()
export class PublicoSalvoService {
  constructor(
    private readonly ctx: ContextoDb,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Os campos, as comparações de cada tipo e o máximo de regras — a tela monta o editor só com isto. */
  catalogo() {
    return { campos: CAMPOS, comparacoes: NOMES_DAS_COMPARACOES, maxRegras: MAX_REGRAS };
  }

  async listar(contaId: string): Promise<{ publicos: PublicoSalvoParaTela[] }> {
    const linhas = await this.ctx.db
      .select()
      .from(publicoSalvo)
      .where(eq(publicoSalvo.contaId, contaId))
      .orderBy(publicoSalvo.nomeChave, publicoSalvo.id)
      .limit(MAX_PUBLICOS_SALVOS);
    return { publicos: await this.paraTela(contaId, linhas) };
  }

  async criar(contaId: string, usuarioId: string, dto: CriarPublicoSalvoDto): Promise<PublicoSalvoParaTela> {
    const nome = nomeLimpo(dto.nome);
    const regras = regrasConferidas(dto.regras);
    await this.conferirNomeLivre(contaId, nome, null);
    await this.conferirEspaco(contaId);
    const criado = await this.inserir(contaId, usuarioId, nome, regras);
    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuarioId,
      acao: 'publico_salvo.criado',
      entidade: 'publico_salvo',
      entidadeId: criado.id,
      detalhe: { nome, regras },
    });
    return (await this.paraTela(contaId, [criado]))[0]!;
  }

  async editar(contaId: string, usuarioId: string, id: string, dto: EditarPublicoSalvoDto): Promise<PublicoSalvoParaTela> {
    const atual = await this.buscar(contaId, id);
    // Ausente = mantém.
    const nome = dto.nome === undefined ? atual.nome : nomeLimpo(dto.nome);
    const regras = dto.regras === undefined ? null : regrasConferidas(dto.regras);
    if (nome !== atual.nome) await this.conferirNomeLivre(contaId, nome, id);
    let editado: Linha | undefined;
    try {
      [editado] = await this.ctx.db
        .update(publicoSalvo)
        .set({ nome, nomeChave: chaveDoNome(nome), ...(regras ? { regras } : {}), atualizadoEm: new Date() })
        .where(and(eq(publicoSalvo.id, id), eq(publicoSalvo.contaId, contaId)))
        .returning();
    } catch (erro) {
      if (nomeRepetido(erro)) throw new ConflictException(JA_EXISTE);
      throw erro;
    }
    if (!editado) throw new NotFoundException('Público salvo não encontrado. Ele pode ter sido excluído.');
    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuarioId,
      acao: 'publico_salvo.editado',
      entidade: 'publico_salvo',
      entidadeId: id,
      detalhe: {
        ...(nome !== atual.nome ? { nomeAntes: atual.nome, nome } : {}),
        ...(regras ? { regrasAntes: atual.regras, regras } : {}),
      },
    });
    return (await this.paraTela(contaId, [editado]))[0]!;
  }

  /** Uma cópia com o nome "Cópia de …" (e um número, se esse já existir). */
  async duplicar(contaId: string, usuarioId: string, id: string): Promise<PublicoSalvoParaTela> {
    const atual = await this.buscar(contaId, id);
    await this.conferirEspaco(contaId);
    const chaves = await this.ctx.db
      .select({ chave: publicoSalvo.nomeChave })
      .from(publicoSalvo)
      .where(eq(publicoSalvo.contaId, contaId));
    const usados = new Set(chaves.map((n) => n.chave));
    const base = `Cópia de ${atual.nome}`;
    let nome = base.slice(0, TAMANHO_DO_NOME);
    for (let i = 2; usados.has(chaveDoNome(nome)); i++) {
      const sufixo = ` (${i})`;
      nome = `${base.slice(0, TAMANHO_DO_NOME - sufixo.length)}${sufixo}`;
    }
    const criado = await this.inserir(contaId, usuarioId, nome, atual.regras as RegraDoPublico[]);
    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuarioId,
      acao: 'publico_salvo.duplicado',
      entidade: 'publico_salvo',
      entidadeId: criado.id,
      detalhe: { de: id, nome },
    });
    return (await this.paraTela(contaId, [criado]))[0]!;
  }

  /** Só as regras saem: a campanha que usou este público continua com quem recebeu. */
  async excluir(contaId: string, usuarioId: string, id: string): Promise<{ excluido: true }> {
    const [apagado] = await this.ctx.db
      .delete(publicoSalvo)
      .where(and(eq(publicoSalvo.id, id), eq(publicoSalvo.contaId, contaId)))
      .returning({ nome: publicoSalvo.nome, regras: publicoSalvo.regras });
    if (!apagado) throw new NotFoundException('Público salvo não encontrado. Ele pode ter sido excluído.');
    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuarioId,
      acao: 'publico_salvo.excluido',
      entidade: 'publico_salvo',
      entidadeId: id,
      detalhe: { nome: apagado.nome, regras: apagado.regras },
    });
    return { excluido: true };
  }

  // ------------------------------------------------------------------ interno

  private async buscar(contaId: string, id: string): Promise<Linha> {
    const [l] = await this.ctx.db
      .select()
      .from(publicoSalvo)
      .where(and(eq(publicoSalvo.id, id), eq(publicoSalvo.contaId, contaId)))
      .limit(1);
    if (!l) throw new NotFoundException('Público salvo não encontrado. Ele pode ter sido excluído.');
    return l;
  }

  private async inserir(contaId: string, usuarioId: string, nome: string, regras: RegraDoPublico[]): Promise<Linha> {
    try {
      const [l] = await this.ctx.db
        .insert(publicoSalvo)
        .values({ contaId, nome, nomeChave: chaveDoNome(nome), regras, criadoPor: usuarioId })
        .returning();
      return l!;
    } catch (erro) {
      // Dois salvando o mesmo nome ao mesmo tempo: o índice único decide.
      if (nomeRepetido(erro)) throw new ConflictException(JA_EXISTE);
      throw erro;
    }
  }

  /** O nome não se repete na conta (sem diferença de maiúscula). O índice único garante; aqui é a frase antes. */
  private async conferirNomeLivre(contaId: string, nome: string, menosId: string | null): Promise<void> {
    const [igual] = await this.ctx.db
      .select({ id: publicoSalvo.id })
      .from(publicoSalvo)
      .where(
        and(
          eq(publicoSalvo.contaId, contaId),
          eq(publicoSalvo.nomeChave, chaveDoNome(nome)),
          menosId ? sql`${publicoSalvo.id} <> ${menosId}` : sql`true`,
        ),
      )
      .limit(1);
    if (igual) throw new ConflictException(JA_EXISTE);
  }

  private async conferirEspaco(contaId: string): Promise<void> {
    const [r] = await this.ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(publicoSalvo)
      .where(eq(publicoSalvo.contaId, contaId));
    if ((r?.n ?? 0) >= MAX_PUBLICOS_SALVOS) {
      throw new BadRequestException(`A conta já tem ${MAX_PUBLICOS_SALVOS} públicos salvos. Exclua os que não usa mais.`);
    }
  }

  /**
   * A contagem de hoje e os usos de cada público, em duas idas ao banco: uma
   * com uma subconsulta por público (a mesma condição da campanha) e outra com
   * os usos agrupados.
   */
  private async paraTela(contaId: string, linhas: Linha[]): Promise<PublicoSalvoParaTela[]> {
    if (!linhas.length) return [];
    const conferidas = linhas.map((l) => ({ linha: l, v: validarRegras(l.regras) }));
    const validas = conferidas.filter((c): c is { linha: Linha; v: { regras: RegraDoPublico[] } } => 'regras' in c.v);

    const totais = new Map<string, number>();
    if (validas.length) {
      const ctx = await contextoDasRegras(this.ctx.db, contaId);
      const subconsultas = validas.map(
        (c) => sql`(select count(*)::int from contato
                     where contato.conta_id = ${contaId}
                       and contato.opt_out = false
                       and contato.sem_whatsapp_em is null
                       and ${expressaoDasRegras(c.v.regras, ctx)})`,
      );
      const r = await this.ctx.db.execute(sql`select array[${sql.join(subconsultas, sql`, `)}]::int[] as totais`);
      const lidos = ((r.rows[0] as { totais: number[] } | undefined)?.totais ?? []).map(Number);
      validas.forEach((c, i) => totais.set(c.linha.id, lidos[i] ?? 0));
    }

    const ids = linhas.map((l) => l.id);
    const u = await this.ctx.db.execute(sql`
      select publico_salvo_id as id, count(*)::int as campanhas, max(criado_em) as ultima
        from campanha
       where conta_id = ${contaId}
         and publico_salvo_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
       group by publico_salvo_id
    `);
    const usos = new Map(
      (u.rows as Array<{ id: string; campanhas: number; ultima: string | Date | null }>).map((x) => [
        x.id,
        { campanhas: Number(x.campanhas), ultimaEm: x.ultima ? new Date(x.ultima) : null },
      ]),
    );

    return conferidas.map(({ linha, v }) => {
      const regras = 'regras' in v ? v.regras : ((Array.isArray(linha.regras) ? linha.regras : []) as RegraDoPublico[]);
      return {
        id: linha.id,
        nome: linha.nome,
        regras,
        resumo: regras.map(descreverRegra),
        total: 'regras' in v ? (totais.get(linha.id) ?? 0) : null,
        problema: 'erro' in v ? `Uma regra não vale mais (${v.erro}). Edite as regras para usar este público.` : null,
        usos: usos.get(linha.id) ?? { campanhas: 0, ultimaEm: null },
        criadoEm: linha.criadoEm,
        atualizadoEm: linha.atualizadoEm,
      };
    });
  }
}
