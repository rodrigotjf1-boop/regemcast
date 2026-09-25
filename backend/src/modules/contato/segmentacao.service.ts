/**
 * Perfis da base: contagem por perfil, os números que o dono ajusta e a lista
 * criada a partir de um perfil (é assim que o perfil vira público de campanha,
 * sem mexer no fluxo de campanha).
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import { ContextoDb, type Db } from '../../db/contexto';
import { contatoLista, segmentacaoParametros } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import {
  PARAMETROS_PADRAO,
  SEGMENTOS,
  descreverSegmentos,
  expressaoSegmento,
  problemaNosParametros,
  type ParametrosSegmentacao,
  type Segmento,
} from './segmentacao';

/** Os números da conta, ou o padrão quando ela nunca ajustou. */
export async function parametrosDaConta(db: Db, contaId: string): Promise<ParametrosSegmentacao> {
  const [l] = await db
    .select()
    .from(segmentacaoParametros)
    .where(eq(segmentacaoParametros.contaId, contaId))
    .limit(1);
  return l
    ? { recenteDias: l.recenteDias, ativoDias: l.ativoDias, riscoDias: l.riscoDias, fielPedidos: l.fielPedidos }
    : { ...PARAMETROS_PADRAO };
}

export interface ResumoSegmentos {
  parametros: ParametrosSegmentacao;
  /**
   * Na ordem de exibição; só contatos que podem receber (sem descadastro).
   * O gasto e o ticket médio do perfil (o "M" do RFM) são `null` quando
   * ninguém ali tem valor gasto.
   */
  segmentos: {
    id: Segmento;
    nome: string;
    regra: string;
    total: number;
    gastoCentavos: number | null;
    ticketMedioCentavos: number | null;
  }[];
}

@Injectable()
export class SegmentacaoService {
  constructor(
    private readonly ctx: ContextoDb,
    private readonly auditoria: AuditoriaService,
  ) {}

  async resumo(contaId: string): Promise<ResumoSegmentos> {
    return this.ctx.comConta(contaId, async (db) => {
      const p = await parametrosDaConta(db, contaId);
      // O ticket usa só quem tem os dois números (pedidos e gasto): somar gasto
      // de uns com pedidos de outros daria um ticket que não existe.
      const r = await db.execute(sql`
        select ${expressaoSegmento(p)} as segmento, count(*)::int as total,
               sum(contato.total_gasto_centavos) filter (where contato.total_gasto_centavos > 0)::bigint as gasto,
               sum(contato.total_gasto_centavos) filter (where contato.total_gasto_centavos > 0 and contato.pedidos > 0)::bigint as gasto_com_pedidos,
               sum(contato.pedidos) filter (where contato.total_gasto_centavos > 0 and contato.pedidos > 0)::bigint as pedidos_com_gasto
          from contato
         where contato.conta_id = ${contaId} and contato.opt_out = false and contato.sem_whatsapp_em is null
         group by 1
      `);
      type Linha = {
        segmento: Segmento;
        total: number;
        gasto: string | null;
        gasto_com_pedidos: string | null;
        pedidos_com_gasto: string | null;
      };
      const porSegmento = new Map((r.rows as Linha[]).map((x) => [x.segmento, x]));
      const textos = descreverSegmentos(p);
      return {
        parametros: p,
        segmentos: SEGMENTOS.map((id) => {
          const x = porSegmento.get(id);
          const pedidos = Number(x?.pedidos_com_gasto ?? 0);
          return {
            id,
            ...textos[id],
            total: x?.total ?? 0,
            gastoCentavos: x?.gasto == null ? null : Number(x.gasto),
            ticketMedioCentavos: pedidos > 0 ? Math.round(Number(x?.gasto_com_pedidos ?? 0) / pedidos) : null,
          };
        }),
      };
    });
  }

  async salvarParametros(contaId: string, usuarioId: string, p: ParametrosSegmentacao): Promise<ResumoSegmentos> {
    const problema = problemaNosParametros(p);
    if (problema) throw new BadRequestException(problema);

    await this.ctx.comConta(contaId, async (db) => {
      await db
        .insert(segmentacaoParametros)
        .values({ contaId, ...p, atualizadoPor: usuarioId })
        .onConflictDoUpdate({ target: segmentacaoParametros.contaId, set: { ...p, atualizadoPor: usuarioId } });
      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioId,
        acao: 'segmentacao.parametros_alterados',
        entidade: 'segmentacao_parametros',
        detalhe: { ...p },
      });
    });
    return this.resumo(contaId);
  }

  /**
   * Cria uma lista com quem está hoje no perfil — uma foto, não uma lista viva:
   * a campanha precisa de um público que não mude enquanto está sendo enviada.
   */
  async criarLista(
    contaId: string,
    usuarioId: string,
    segmento: Segmento,
    nome?: string,
  ): Promise<{ id: string; nome: string; total: number }> {
    if (!SEGMENTOS.includes(segmento)) throw new BadRequestException('Perfil desconhecido.');

    return this.ctx.comConta(contaId, async (db) => {
      const p = await parametrosDaConta(db, contaId);
      const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const nomeLista = (nome?.trim() || `${descreverSegmentos(p)[segmento].nome} — ${hoje}`).slice(0, 120);

      const [lista] = await db
        .insert(contatoLista)
        .values({ contaId, nome: nomeLista, descricao: descreverSegmentos(p)[segmento].regra })
        .returning({ id: contatoLista.id });

      const r = await db.execute(sql`
        insert into contato_lista_item (conta_id, lista_id, contato_id)
        select contato.conta_id, ${lista!.id}, contato.id
          from contato
         where contato.conta_id = ${contaId}
           and contato.opt_out = false and contato.sem_whatsapp_em is null
           and ${expressaoSegmento(p)} = ${segmento}
        on conflict do nothing
      `);
      const total = r.rowCount ?? 0;

      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioId,
        acao: 'contato.lista.criada_do_perfil',
        entidade: 'contato_lista',
        entidadeId: lista!.id,
        detalhe: { segmento, total, parametros: { ...p } },
      });
      return { id: lista!.id, nome: nomeLista, total };
    });
  }
}
