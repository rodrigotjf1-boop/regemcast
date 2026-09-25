/**
 * Blocos da base: dividir um conjunto de contatos em listas do mesmo tamanho.
 *
 * Para lista só com nome e número — a agenda exportada do celular, sem pedido
 * nenhum — os blocos são o jeito de organizar o envio: cabem no limite de envio
 * da Meta, viram "o envio de hoje" e deixam ver o resultado de um bloco antes
 * de mandar o próximo (aquecimento de lista fria).
 *
 * Cada bloco é uma `contato_lista` comum (com `divisao_id` e `bloco`), então a
 * campanha escolhe um bloco como escolhe qualquer lista. A divisão inteira é UM
 * comando no banco: 50 mil contatos, 50 blocos, uma ida.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';

import { DDDS, ESTADOS, dddsDaUf } from '../../common/ddd';
import { gemeoEmSql } from '../../common/telefone-sql';
import { ContextoDb, type Db } from '../../db/contexto';
import { conta, contatoLista, importacao, listaDivisao, waNumero } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { contaDosBlocos, opcoesDeBloco, type OpcoesDeBloco, type OrdemDosBlocos } from './blocos.regras';
import type { DividirEmBlocosDto } from './dto/divisao.dto';
import { SEGMENTOS, descreverSegmentos, expressaoSegmento, type Segmento } from './segmentacao';
import { parametrosDaConta } from './segmentacao.service';

/** Mais que isso vira uma tela de listas que ninguém percorre: escolha um bloco maior. */
export const MAX_BLOCOS = 500;

/** A ordem em que os contatos entram nos blocos. */
const ORDEM_SQL: Record<OrdemDosBlocos, SQL> = {
  importacao: sql`contato.criado_em, contato.id`,
  // Sorteio fica fixo depois de dividido: os blocos são uma foto.
  sorteio: sql`random()`,
  recentes: sql`contato.criado_em desc, contato.id`,
  // DDI + DDD juntos: o bloco sai com gente da mesma região, na ordem de chegada.
  regiao: sql`substr(contato.telefone_e164, 1, 4), contato.criado_em, contato.id`,
  valor: sql`contato.total_gasto_centavos desc nulls last, contato.ultimo_pedido_em desc nulls last, contato.criado_em, contato.id`,
};

interface Origem {
  /** Filtro sobre a tabela `contato` (sem alias: é o que `expressaoSegmento` espera). */
  filtro: SQL;
  nome: string;
  rotulo: string | null;
  origemId: string | null;
}

export interface UsoDoBloco {
  campanhaId: string;
  campanhaNome: string;
  status: string;
  em: Date;
  total: number;
  enviadas: number;
  entregues: number;
  lidas: number;
  falhas: number;
  /** Do bloco, quem pediu para sair depois que esta campanha começou. */
  sairam: number;
}

export interface BlocoDaDivisao {
  id: string;
  bloco: number;
  nome: string;
  /** Quem ainda pode receber (sem quem pediu para sair depois da divisão). */
  total: number;
  usos: UsoDoBloco[];
}

export interface DivisaoDeBlocos {
  id: string;
  nome: string;
  origem: string;
  origemRotulo: string | null;
  tamanho: number;
  ordem: string;
  soNuncaReceberam: boolean;
  totalContatos: number;
  totalBlocos: number;
  criadaEm: Date;
  blocos: BlocoDaDivisao[];
}

export interface RegiaoDaBase {
  uf: string;
  estado: string;
  total: number;
  ddds: { ddd: string; cidade: string; total: number }[];
}

@Injectable()
export class DivisaoService {
  constructor(
    private readonly ctx: ContextoDb,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Os tamanhos liberados hoje, pelo limite de envio da conta. */
  async opcoes(contaId: string): Promise<OpcoesDeBloco> {
    return this.ctx.comConta(contaId, (db) => this.opcoesNo(db, contaId));
  }

  private async opcoesNo(db: Db, contaId: string): Promise<OpcoesDeBloco> {
    const [n] = await db
      .select({ limite: waNumero.tierLimite, nome: waNumero.tierNome })
      .from(waNumero)
      .where(and(eq(waNumero.contaId, contaId), eq(waNumero.status, 'registrado')))
      .orderBy(sql`${waNumero.tierEm} desc nulls last`)
      .limit(1);
    // O nome do degrau é o que diz que o limite foi lido: `null` no limite com
    // nome é "sem teto"; sem nome é "ainda não sabemos".
    return opcoesDeBloco(n?.limite ?? null, Boolean(n?.nome));
  }

  async dividir(contaId: string, usuarioId: string, dto: DividirEmBlocosDto): Promise<DivisaoDeBlocos> {
    const criada = await this.ctx.comConta(contaId, async (db) => {
      const opcoes = await this.opcoesNo(db, contaId);
      if (dto.tamanho > opcoes.maximo) {
        throw new BadRequestException(
          opcoes.limiteConhecido
            ? `Seu número pode falar com ${opcoes.maximo.toLocaleString('pt-BR')} pessoas diferentes por dia hoje. Blocos maiores ficam disponíveis quando a Meta aumentar o limite.`
            : `O limite de envio do seu número ainda não foi lido. Por enquanto, blocos de até ${opcoes.maximo.toLocaleString('pt-BR')} contatos.`,
        );
      }

      const origem = await this.origem(db, contaId, dto);
      const nunca = dto.soNuncaReceberam
        ? sql`and not exists (
            select 1 from campanha_destinatario d
             where d.conta_id = contato.conta_id
               and d.enviada_em is not null
               and d.telefone_e164 in (contato.telefone_e164, ${gemeoEmSql(sql`contato.telefone_e164`)})
          )`
        : sql``;
      const filtro = sql`contato.conta_id = ${contaId} and contato.opt_out = false and ${origem.filtro} ${nunca}`;

      // Contar antes: sem ninguém, ou com blocos demais, não se cria nada.
      const [{ qtd }] = (await db.execute(sql`select count(*)::int as qtd from contato where ${filtro}`)).rows as {
        qtd: number;
      }[];
      if (!qtd) {
        throw new BadRequestException(
          dto.soNuncaReceberam
            ? 'Ninguém para dividir: todos já receberam campanha ou pediram para sair.'
            : 'Ninguém para dividir: a origem está vazia ou todos pediram para sair.',
        );
      }
      const { blocos } = contaDosBlocos(qtd, dto.tamanho);
      if (blocos > MAX_BLOCOS) {
        throw new BadRequestException(
          `Isso daria ${blocos.toLocaleString('pt-BR')} blocos — o máximo é ${MAX_BLOCOS}. Escolha um bloco maior.`,
        );
      }

      const [c] = await db.select({ fuso: conta.timezone }).from(conta).where(eq(conta.id, contaId)).limit(1);
      const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: c?.fuso });
      const nome = `${(dto.nome?.trim() || origem.nome).slice(0, 80)} — ${hoje}`;
      const descricao = `Bloco de ${dto.tamanho.toLocaleString('pt-BR')} contatos, dividido em ${hoje}.`;

      /*
       * Um comando só. A base é MATERIALIZADA: a ordem (e o sorteio) é fixada
       * uma vez e serve às duas pontas — a contagem de blocos e os itens.
       */
      const r = await db.execute(sql`
        with base as materialized (
          select contato.id, row_number() over (order by ${ORDEM_SQL[dto.ordem]}) as n
            from contato
           where ${filtro}
        ),
        total as (select count(*)::int as qtd from base),
        divisao as (
          insert into lista_divisao (conta_id, nome, origem, origem_id, origem_rotulo, tamanho, ordem,
                                     so_nunca_receberam, total_contatos, total_blocos, criada_por)
          select ${contaId}, ${nome}, ${dto.origem}, ${origem.origemId}::uuid, ${origem.rotulo}, ${dto.tamanho}::int,
                 ${dto.ordem}, ${Boolean(dto.soNuncaReceberam)}, t.qtd,
                 ((t.qtd + ${dto.tamanho}::int - 1) / ${dto.tamanho}::int), ${usuarioId}::uuid
            from total t
           where t.qtd > 0
          returning id, total_blocos
        ),
        blocos as (
          insert into contato_lista (conta_id, nome, descricao, divisao_id, bloco)
          select ${contaId}, ${nome} || ' · bloco ' || lpad(b::text, greatest(2, length(d.total_blocos::text)), '0')
                 || ' de ' || d.total_blocos, ${descricao}, d.id, b
            from divisao d, generate_series(1, d.total_blocos) b
          returning id, bloco
        ),
        itens as (
          insert into contato_lista_item (conta_id, lista_id, contato_id)
          select ${contaId}, bl.id, base.id
            from base
            join blocos bl on bl.bloco = ((base.n - 1) / ${dto.tamanho}::int) + 1
          returning 1
        )
        select (select id from divisao) as id,
               (select total_blocos from divisao) as blocos,
               (select count(*) from itens)::int as itens
      `);
      const linha = r.rows[0] as { id: string | null; blocos: number | null; itens: number } | undefined;
      if (!linha?.id) {
        // A base esvaziou entre a contagem e a divisão (todos pediram para sair).
        throw new BadRequestException('Ninguém para dividir: a origem ficou vazia.');
      }

      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioId,
        acao: 'contato.divisao.criada',
        entidade: 'lista_divisao',
        entidadeId: linha.id,
        detalhe: {
          origem: dto.origem,
          origemRotulo: origem.rotulo,
          tamanho: dto.tamanho,
          ordem: dto.ordem,
          soNuncaReceberam: Boolean(dto.soNuncaReceberam),
          contatos: linha.itens,
          blocos: linha.blocos,
        },
      });
      return linha.id;
    });

    const [divisao] = await this.listar(contaId, criada);
    return divisao!;
  }

  /** De onde saem os contatos, com o nome que os blocos vão ter. */
  private async origem(db: Db, contaId: string, dto: DividirEmBlocosDto): Promise<Origem> {
    switch (dto.origem) {
      case 'lista': {
        const [l] = await db
          .select({ id: contatoLista.id, nome: contatoLista.nome })
          .from(contatoLista)
          .where(and(eq(contatoLista.id, dto.origemId!), eq(contatoLista.contaId, contaId)))
          .limit(1);
        if (!l) throw new NotFoundException('Lista não encontrada.');
        return {
          filtro: sql`exists (select 1 from contato_lista_item i where i.lista_id = ${l.id} and i.contato_id = contato.id)`,
          nome: l.nome,
          rotulo: l.nome,
          origemId: l.id,
        };
      }
      case 'importacao': {
        const [i] = await db
          .select({ id: importacao.id, arquivoNome: importacao.arquivoNome, formato: importacao.formato, listaId: importacao.listaId })
          .from(importacao)
          .where(and(eq(importacao.id, dto.origemId!), eq(importacao.contaId, contaId)))
          .limit(1);
        if (!i) throw new NotFoundException('Importação não encontrada.');
        // Quem o arquivo trouxe de novo e, se a importação foi para uma lista,
        // também quem já estava na base e entrou nela.
        const naLista = i.listaId
          ? sql` or exists (select 1 from contato_lista_item li where li.lista_id = ${i.listaId} and li.contato_id = contato.id)`
          : sql``;
        const nome = i.arquivoNome || (i.formato === 'texto' ? 'Números colados' : 'Importação');
        return { filtro: sql`(contato.importacao_id = ${i.id}${naLista})`, nome, rotulo: nome, origemId: i.id };
      }
      case 'base':
        return { filtro: sql`true`, nome: 'Base inteira', rotulo: null, origemId: null };
      case 'perfil': {
        const segmento = dto.segmento as Segmento;
        if (!SEGMENTOS.includes(segmento)) throw new BadRequestException('Perfil desconhecido.');
        const p = await parametrosDaConta(db, contaId);
        const nome = descreverSegmentos(p)[segmento].nome;
        return { filtro: sql`${expressaoSegmento(p)} = ${segmento}`, nome, rotulo: segmento, origemId: null };
      }
      case 'regiao': {
        const uf = (dto.uf ?? '').toUpperCase();
        const ddds = dddsDaUf(uf);
        if (!ddds.length) throw new BadRequestException('Estado desconhecido.');
        return {
          filtro: sql`contato.telefone_e164 like '55%' and substr(contato.telefone_e164, 3, 2) in (${sql.join(
            ddds.map((d) => sql`${d}`),
            sql`, `,
          )})`,
          nome: ESTADOS[uf] ?? uf,
          rotulo: uf,
          origemId: null,
        };
      }
    }
  }

  /**
   * As divisões da conta (as 50 mais recentes), cada uma com os blocos e o que
   * aconteceu com cada bloco em campanha — é o que deixa aquecer uma lista
   * fria: ver o resultado de um bloco antes de mandar o próximo.
   */
  async listar(contaId: string, so?: string): Promise<DivisaoDeBlocos[]> {
    return this.ctx.comConta(contaId, async (db) => {
      const divisoes = await db
        .select()
        .from(listaDivisao)
        .where(so ? and(eq(listaDivisao.contaId, contaId), eq(listaDivisao.id, so)) : eq(listaDivisao.contaId, contaId))
        .orderBy(desc(listaDivisao.criadaEm))
        .limit(50);
      if (!divisoes.length) return [];

      const ids = sql.join(
        divisoes.map((d) => sql`${d.id}::uuid`),
        sql`, `,
      );

      const blocos = (
        await db.execute(sql`
          select l.id, l.divisao_id, l.bloco, l.nome,
                 count(c.id) filter (where c.opt_out = false)::int as total
            from contato_lista l
            left join contato_lista_item i on i.lista_id = l.id
            left join contato c on c.id = i.contato_id
           where l.conta_id = ${contaId} and l.divisao_id in (${ids})
           group by l.id
           order by l.bloco
        `)
      ).rows as { id: string; divisao_id: string; bloco: number; nome: string; total: number }[];

      const usos = (
        await db.execute(sql`
          with alvo as (
            select cp.id, cp.lista_id, cp.nome, cp.status, coalesce(cp.iniciada_em, cp.criado_em) as em
              from campanha cp
             where cp.conta_id = ${contaId}
               and cp.lista_id in (select l.id from contato_lista l where l.conta_id = ${contaId} and l.divisao_id in (${ids}))
          )
          select a.id, a.lista_id, a.nome, a.status, a.em,
                 (select count(*) from campanha_destinatario d where d.campanha_id = a.id)::int as total,
                 (select count(*) from campanha_destinatario d where d.campanha_id = a.id and d.status in ('enviada', 'entregue', 'lida'))::int as enviadas,
                 (select count(*) from campanha_destinatario d where d.campanha_id = a.id and d.status in ('entregue', 'lida'))::int as entregues,
                 (select count(*) from campanha_destinatario d where d.campanha_id = a.id and d.status = 'lida')::int as lidas,
                 (select count(*) from campanha_destinatario d
                   where d.campanha_id = a.id and d.status = 'falhou' and coalesce(d.erro_titulo, '') <> 'Pediu para sair')::int as falhas,
                 (select count(*) from contato_lista_item i join contato c on c.id = i.contato_id
                   where i.lista_id = a.lista_id and c.opt_out = true and c.opt_out_em >= a.em)::int as sairam
            from alvo a
           order by a.em
        `)
      ).rows as {
        id: string;
        lista_id: string;
        nome: string;
        status: string;
        em: string | Date;
        total: number;
        enviadas: number;
        entregues: number;
        lidas: number;
        falhas: number;
        sairam: number;
      }[];

      return divisoes.map((d) => ({
        id: d.id,
        nome: d.nome,
        origem: d.origem,
        origemRotulo: d.origemRotulo,
        tamanho: d.tamanho,
        ordem: d.ordem,
        soNuncaReceberam: d.soNuncaReceberam,
        totalContatos: d.totalContatos,
        totalBlocos: d.totalBlocos,
        criadaEm: d.criadaEm,
        blocos: blocos
          .filter((b) => b.divisao_id === d.id)
          .map((b) => ({
            id: b.id,
            bloco: b.bloco,
            nome: b.nome,
            total: b.total,
            usos: usos
              .filter((u) => u.lista_id === b.id)
              .map((u) => ({
                campanhaId: u.id,
                campanhaNome: u.nome,
                status: u.status,
                em: new Date(u.em),
                total: u.total,
                enviadas: u.enviadas,
                entregues: u.entregues,
                lidas: u.lidas,
                falhas: u.falhas,
                sairam: u.sairam,
              })),
          })),
      }));
    });
  }

  /**
   * Apaga a divisão e os blocos dela. Só se nenhuma campanha usou os blocos:
   * a campanha aponta para a lista, e o histórico dela perderia de onde saiu.
   */
  async apagar(contaId: string, usuarioId: string, id: string): Promise<void> {
    await this.ctx.comConta(contaId, async (db) => {
      const [d] = await db
        .select({ id: listaDivisao.id, nome: listaDivisao.nome })
        .from(listaDivisao)
        .where(and(eq(listaDivisao.id, id), eq(listaDivisao.contaId, contaId)))
        .limit(1);
      if (!d) throw new NotFoundException('Divisão não encontrada.');

      const [{ usadas }] = (
        await db.execute(sql`
          select count(*)::int as usadas from campanha cp
           where cp.conta_id = ${contaId}
             and cp.lista_id in (select l.id from contato_lista l where l.divisao_id = ${id})
        `)
      ).rows as { usadas: number }[];
      if (usadas > 0) {
        throw new ConflictException(
          'Blocos desta divisão já foram usados em campanha, então ela fica no histórico. Para outro tamanho, divida de novo.',
        );
      }

      await db.delete(listaDivisao).where(and(eq(listaDivisao.id, id), eq(listaDivisao.contaId, contaId)));
      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioId,
        acao: 'contato.divisao.apagada',
        entidade: 'lista_divisao',
        entidadeId: id,
        detalhe: { nome: d.nome },
      });
    });
  }

  /** Quantos contatos por estado e DDD — só quem pode receber. */
  async regioes(contaId: string): Promise<{ regioes: RegiaoDaBase[]; semRegiao: number }> {
    return this.ctx.comConta(contaId, async (db) => {
      const linhas = (
        await db.execute(sql`
          select case when telefone_e164 like '55%' then substr(telefone_e164, 3, 2) end as ddd, count(*)::int as total
            from contato
           where conta_id = ${contaId} and opt_out = false
           group by 1
        `)
      ).rows as { ddd: string | null; total: number }[];

      const porUf = new Map<string, RegiaoDaBase>();
      let semRegiao = 0;
      for (const l of linhas) {
        const regiao = l.ddd ? DDDS[l.ddd] : undefined;
        if (!l.ddd || !regiao) {
          semRegiao += l.total;
          continue;
        }
        const r = porUf.get(regiao.uf) ?? { uf: regiao.uf, estado: ESTADOS[regiao.uf] ?? regiao.uf, total: 0, ddds: [] };
        r.total += l.total;
        r.ddds.push({ ddd: l.ddd, cidade: regiao.cidade, total: l.total });
        porUf.set(regiao.uf, r);
      }
      const regioes = [...porUf.values()]
        .map((r) => ({ ...r, ddds: r.ddds.sort((a, b) => b.total - a.total) }))
        .sort((a, b) => b.total - a.total);
      return { regioes, semRegiao };
    });
  }
}
