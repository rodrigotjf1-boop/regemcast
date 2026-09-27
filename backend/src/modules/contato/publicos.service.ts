/**
 * Públicos prontos: quantos há em cada um (com os limites da loja), os bairros
 * e os aniversariantes por mês — e a lista criada a partir de um público, a
 * foto que a campanha usa, como a dos perfis.
 *
 * Só conta quem pode receber (sem descadastro), igual ao disparo.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import { ContextoDb, type Db } from '../../db/contexto';
import { conta, contatoLista } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import {
  FRACAO_VIP,
  PUBLICOS_FIXOS,
  TAMANHO_MAXIMO_PRODUTO,
  TICKET_SQL,
  descreverPublico,
  emReais,
  expressaoPublico,
  termoDoLike,
  validarPublico,
  type LimitesDosPublicos,
  type Publico,
} from './publicos';
import { parametrosDaConta } from './segmentacao.service';

/** Quantos bairros a tela mostra — os mais frequentes. */
const MAX_BAIRROS = 40;
/** Quantos produtos a tela mostra — os que mais gente comprou, ou os que casam com a busca. */
export const MAX_PRODUTOS = 40;

/** Um produto da base: o nome como é mais escrito e quantos (que podem receber) já compraram. */
export interface ProdutoDaBase {
  nome: string;
  total: number;
}

export interface PublicoResumido {
  id: Publico;
  nome: string;
  regra: string;
  total: number;
  /** Quanto esse público já gastou, somado. */
  gastoCentavos: number;
}

export interface ResumoPublicos {
  limites: LimitesDosPublicos;
  /** Quantos (que podem receber) têm valor gasto, jeito de comprar e data de nascimento — para os avisos da tela. */
  comValor: number;
  comCompras: number;
  comNascimento: number;
  publicos: PublicoResumido[];
  bairros: { bairro: string; total: number }[];
  /** Com as conversas ligadas (coexistência), "Conversaram na última semana" faz sentido. */
  conversasLigadas: boolean;
  /** O mês de hoje no fuso da conta (1 a 12) e quantos fazem aniversário em cada mês. */
  mesAtual: number;
  aniversarios: { mes: number; total: number }[];
}

/**
 * Os limites da loja: o corte do VIP (percentil 90 do total gasto) e os terços
 * do ticket médio, arredondados para reais inteiros, e o dia de hoje no fuso
 * da conta (o cashback vale até o dia do vencimento). Uma consulta.
 */
export async function limitesDosPublicos(db: Db, contaId: string): Promise<LimitesDosPublicos> {
  const p = await parametrosDaConta(db, contaId);
  const r = await db.execute(sql`
    select
      (select percentile_disc(${1 - FRACAO_VIP}) within group (order by contato.total_gasto_centavos)
         from contato
        where contato.conta_id = ${contaId} and contato.opt_out = false and contato.sem_whatsapp_em is null and contato.total_gasto_centavos > 0) as vip,
      t.baixo, t.alto,
      (select (now() at time zone c.timezone)::date::text from conta c where c.id = ${contaId}) as hoje
      from (
        select percentile_disc(${1 / 3}) within group (order by ${TICKET_SQL}) as baixo,
               percentile_disc(${2 / 3}) within group (order by ${TICKET_SQL}) as alto
          from contato
         where contato.conta_id = ${contaId} and contato.opt_out = false and contato.sem_whatsapp_em is null and ${TICKET_SQL} > 0
      ) t
  `);
  const x = r.rows[0] as
    | { vip: string | number | null; baixo: string | number | null; alto: string | number | null; hoje: string | null }
    | undefined;
  const num = (v: string | number | null | undefined) => (v == null ? null : Number(v));
  const baixo = emReais(num(x?.baixo), 'perto');
  const alto = emReais(num(x?.alto), 'perto');
  return {
    vipCentavos: emReais(num(x?.vip), 'baixo'),
    ticketBaixoAteCentavos: baixo,
    // Com os tickets todos parecidos, o terço de cima começa onde o de baixo acaba.
    ticketAltoAcimaCentavos: alto == null || baixo == null ? alto : Math.max(alto, baixo),
    ativoDias: p.ativoDias,
    // Sem a conta (não acontece: a consulta roda dentro dela), o dia do servidor.
    hoje: x?.hoje ?? new Date().toISOString().slice(0, 10),
  };
}

/** Valida o par público/valor e devolve o par normalizado — ou recusa com a frase para a tela. */
export function publicoValido(publico: string | undefined, valor: string | null | undefined) {
  const v = validarPublico(publico, valor);
  if ('erro' in v) throw new BadRequestException(v.erro);
  return v;
}

@Injectable()
export class PublicosService {
  constructor(
    private readonly ctx: ContextoDb,
    private readonly auditoria: AuditoriaService,
  ) {}

  async resumo(contaId: string): Promise<ResumoPublicos> {
    return this.ctx.comConta(contaId, async (db) => {
      const l = await limitesDosPublicos(db, contaId);

      // Um comando para todos os públicos fixos: contagem e gasto de cada um.
      const colunas = PUBLICOS_FIXOS.map((p) => {
        const e = expressaoPublico(p, null, l);
        return sql`count(*) filter (where ${e})::int as ${sql.identifier(p)},
                   coalesce(sum(contato.total_gasto_centavos) filter (where ${e}), 0)::bigint as ${sql.identifier(`${p}_gasto`)}`;
      });
      const r = await db.execute(sql`
        select ${sql.join(colunas, sql`, `)},
               count(*) filter (where contato.total_gasto_centavos > 0)::int as com_valor,
               count(*) filter (where contato.tipo_preferido is not null)::int as com_compras,
               count(*) filter (where contato.data_nascimento is not null)::int as com_nascimento
          from contato
         where contato.conta_id = ${contaId} and contato.opt_out = false and contato.sem_whatsapp_em is null
      `);
      const linha = (r.rows[0] ?? {}) as Record<string, string | number>;

      // Um bairro por grupo sem ligar para maiúscula, mostrado na grafia mais
      // usada (de preferência com inicial maiúscula) — não na que a ordenação
      // do banco puser primeiro.
      const bairros = (
        await db.execute(sql`
          select k.bairro, g.total
            from (
              select lower(contato.bairro) as chave, count(*)::int as total
                from contato
               where contato.conta_id = ${contaId} and contato.opt_out = false and contato.sem_whatsapp_em is null and contato.bairro is not null
               group by 1
            ) g
            cross join lateral (
              select c2.bairro
                from contato c2
               where c2.conta_id = ${contaId} and c2.opt_out = false and c2.sem_whatsapp_em is null and lower(c2.bairro) = g.chave
               group by c2.bairro
               order by count(*) desc, (c2.bairro ~ '^[[:upper:]]') desc, c2.bairro
               limit 1
            ) k
           order by g.total desc, k.bairro
           limit ${MAX_BAIRROS}
        `)
      ).rows as { bairro: string; total: number }[];

      const porMes = new Map(
        (
          (
            await db.execute(sql`
              select extract(month from contato.data_nascimento)::int as mes, count(*)::int as total
                from contato
               where contato.conta_id = ${contaId} and contato.opt_out = false and contato.sem_whatsapp_em is null and contato.data_nascimento is not null
               group by 1
            `)
          ).rows as { mes: number; total: number }[]
        ).map((x) => [x.mes, x.total]),
      );

      const conversasLigadas = Boolean(
        (
          (
            await db.execute(sql`
              select exists (
                select 1 from wa_numero where conta_id = ${contaId} and integrar_conversas = true
              ) as ligadas
            `)
          ).rows[0] as { ligadas?: boolean } | undefined
        )?.ligadas,
      );

      const [c] = await db.select({ fuso: conta.timezone }).from(conta).where(eq(conta.id, contaId)).limit(1);
      const mesAtual = Number(
        new Date().toLocaleString('en-US', { month: 'numeric', timeZone: c?.fuso || 'America/Sao_Paulo' }),
      );

      return {
        limites: l,
        comValor: Number(linha.com_valor ?? 0),
        comCompras: Number(linha.com_compras ?? 0),
        comNascimento: Number(linha.com_nascimento ?? 0),
        publicos: PUBLICOS_FIXOS.map((id) => ({
          id,
          ...descreverPublico(id, null, l),
          total: Number(linha[id] ?? 0),
          gastoCentavos: Number(linha[`${id}_gasto`] ?? 0),
        })),
        bairros,
        conversasLigadas,
        mesAtual,
        aniversarios: Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, total: porMes.get(i + 1) ?? 0 })),
      };
    });
  }

  /**
   * Os produtos que mais gente já comprou (só quem pode receber, como o
   * público) — ou, com `busca`, os que têm o termo no nome. O número de cada
   * um é o do público "Já compraram…": clicar filtra exatamente essa gente.
   * A grafia mostrada é a mais usada entre os contatos (empate: a mais
   * recente, depois a com inicial maiúscula), não a que a ordenação do banco
   * puser primeiro.
   */
  async produtos(contaId: string, busca?: string): Promise<{ produtos: ProdutoDaBase[] }> {
    const termo = (busca ?? '').replace(/\s+/g, ' ').trim();
    if (termo.length > TAMANHO_MAXIMO_PRODUTO) {
      throw new BadRequestException(`Busque com até ${TAMANHO_MAXIMO_PRODUTO} letras.`);
    }
    // Minúscula pelo banco, a mesma função que fez a `chave`.
    const filtro = termo ? sql`and p.chave like lower(${`%${termoDoLike(termo)}%`}) escape '\\'` : sql``;

    return this.ctx.comConta(contaId, async (db) => {
      const r = await db.execute(sql`
        select n.nome, g.total
          from (
            select p.chave, count(*)::int as total
              from contato_produto p
              join contato on contato.id = p.contato_id
             where p.conta_id = ${contaId}
               and contato.opt_out = false and contato.sem_whatsapp_em is null
               ${filtro}
             group by p.chave
             order by total desc, p.chave
             limit ${MAX_PRODUTOS}
          ) g
          cross join lateral (
            select p2.nome
              from contato_produto p2
             where p2.conta_id = ${contaId} and p2.chave = g.chave
             group by p2.nome
             order by count(*) desc, max(p2.ultima_em) desc, (p2.nome ~ '^[[:upper:]]') desc, p2.nome
             limit 1
          ) n
         order by g.total desc, n.nome
      `);
      return {
        produtos: (r.rows as { nome: string; total: number | string }[]).map((x) => ({
          nome: x.nome,
          total: Number(x.total),
        })),
      };
    });
  }

  /**
   * Cria uma lista com quem está hoje no público — uma foto, não uma lista
   * viva: a campanha precisa de um público que não mude enquanto é enviada.
   */
  async criarLista(
    contaId: string,
    usuarioId: string,
    publicoPedido: string,
    valorPedido: string | null | undefined,
    nome?: string,
  ): Promise<{ id: string; nome: string; total: number }> {
    const { publico, valor } = publicoValido(publicoPedido, valorPedido);

    return this.ctx.comConta(contaId, async (db) => {
      const l = await limitesDosPublicos(db, contaId);
      const texto = descreverPublico(publico, valor, l);
      const [c] = await db.select({ fuso: conta.timezone }).from(conta).where(eq(conta.id, contaId)).limit(1);
      const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: c?.fuso || 'America/Sao_Paulo' });
      const nomeLista = (nome?.trim() || `${texto.nome} — ${hoje}`).slice(0, 120);

      const [lista] = await db
        .insert(contatoLista)
        .values({ contaId, nome: nomeLista, descricao: texto.regra })
        .returning({ id: contatoLista.id });

      const r = await db.execute(sql`
        insert into contato_lista_item (conta_id, lista_id, contato_id)
        select contato.conta_id, ${lista!.id}, contato.id
          from contato
         where contato.conta_id = ${contaId}
           and contato.opt_out = false and contato.sem_whatsapp_em is null
           and ${expressaoPublico(publico, valor, l)}
        on conflict do nothing
      `);
      const total = r.rowCount ?? 0;

      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioId,
        acao: 'contato.lista.criada_do_publico',
        entidade: 'contato_lista',
        entidadeId: lista!.id,
        detalhe: { publico, valor, total, limites: { ...l } },
      });
      return { id: lista!.id, nome: nomeLista, total };
    });
  }
}
