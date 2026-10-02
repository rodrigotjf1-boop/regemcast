/**
 * As tarifas da Meta, cadastradas no console de distribuição.
 *
 * O preço de cada mensagem entregue é da Meta e muda no primeiro dia de um
 * trimestre. Ele entra aqui pela mão do operador, a partir do arquivo oficial
 * de tarifas — e não por código: valor de terceiro cravado em código envelhece
 * calado, e a estimativa de custo passaria a mentir sem ninguém perceber.
 *
 * Três cuidados:
 *
 * - **Tarifa não se apaga.** A de ontem é o que calcula o gasto de ontem.
 *   Valor novo entra como linha nova, com a data em que passa a valer.
 * - **O que muda numa linha é só o valor e a fonte** — para corrigir erro de
 *   digitação. A moeda, o país, a categoria e a data são a identidade dela.
 * - **Nada de ponto flutuante.** O valor entra e sai como texto e a conta é em
 *   micros (`orcamento/tarifa.regras.ts`).
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import { ContextoDb } from '../../db/contexto';
import { tarifaMeta } from '../../db/schema';
import { conferirTarifa, microsParaNumeric, numericParaMicros, paraMicros, type DadosDaTarifa } from '../orcamento/tarifa.regras';

export interface TarifaNoConsole {
  id: string;
  moeda: string;
  ddi: string;
  categoria: string;
  /** O preço de uma mensagem entregue, como o banco guarda: "0.321700". */
  valor: string;
  /** `AAAA-MM-DD`: o primeiro dia em que o valor vale. */
  vigenteDe: string;
  fonte: string | null;
  criadoPor: string | null;
  /** É a tarifa que vale HOJE para a moeda, o país e a categoria dela. */
  vigente: boolean;
}

@Injectable()
export class DistribuicaoTarifasService {
  constructor(private readonly ctx: ContextoDb) {}

  /** Todas as tarifas, a de hoje de cada grupo marcada, as mais novas primeiro. */
  async listar(): Promise<TarifaNoConsole[]> {
    return this.ctx.comEscopoSistema('distribuicao.tarifas.listar', async (db) => {
      const r = await db.execute(sql`
        select t.id, t.moeda, t.ddi, t.categoria, t.valor::text as valor, t.vigente_de::text as vigente_de,
               t.fonte, t.criado_por,
               t.vigente_de = (
                 select max(x.vigente_de) from tarifa_meta x
                  where x.moeda = t.moeda and x.ddi = t.ddi and x.categoria = t.categoria
                    and x.vigente_de <= current_date
               ) as vigente
          from tarifa_meta t
         order by t.moeda, t.ddi, t.categoria, t.vigente_de desc
      `);
      return (r.rows as Record<string, unknown>[]).map((l) => ({
        id: String(l.id),
        moeda: String(l.moeda),
        ddi: String(l.ddi),
        categoria: String(l.categoria),
        valor: String(l.valor),
        vigenteDe: String(l.vigente_de),
        fonte: l.fonte == null ? null : String(l.fonte),
        criadoPor: l.criado_por == null ? null : String(l.criado_por),
        vigente: l.vigente === true,
      }));
    });
  }

  async criar(dados: DadosDaTarifa, operador: string): Promise<{ id: string; valor: string }> {
    const t = conferirTarifa(dados);
    if ('erro' in t) throw new BadRequestException(t.erro);

    return this.ctx.comEscopoSistema('distribuicao.tarifas.criar', async (db) => {
      try {
        const [criada] = await db
          .insert(tarifaMeta)
          .values({
            moeda: t.moeda,
            ddi: t.ddi,
            categoria: t.categoria,
            valor: microsParaNumeric(t.valorMicros),
            vigenteDe: t.vigenteDe,
            fonte: t.fonte,
            criadoPor: operador.slice(0, 120),
          })
          .returning({ id: tarifaMeta.id });
        return { id: criada!.id, valor: microsParaNumeric(t.valorMicros) };
      } catch (erro) {
        if ((erro as { code?: string })?.code === '23505') {
          throw new ConflictException(
            `Já existe uma tarifa de ${t.categoria} para ${t.moeda} e o país ${t.ddi} valendo a partir de ${t.vigenteDe}. Para corrigir o valor, edite essa linha.`,
          );
        }
        throw erro;
      }
    });
  }

  /** Corrige o valor ou a fonte de uma tarifa. O resto é a identidade dela e não muda. */
  async atualizar(id: string, dados: { valor?: unknown; fonte?: unknown }): Promise<{ antes: { valor: string; fonte: string | null }; valor: string }> {
    const patch: Partial<typeof tarifaMeta.$inferInsert> = {};
    if (dados.valor !== undefined) {
      const micros = paraMicros(dados.valor);
      if (micros === null) {
        throw new BadRequestException('Confira o valor: é o preço de UMA mensagem, com até seis casas — por exemplo 0,0350.');
      }
      patch.valor = microsParaNumeric(micros);
    }
    if (dados.fonte !== undefined) patch.fonte = String(dados.fonte ?? '').trim().slice(0, 200) || null;
    if (Object.keys(patch).length === 0) throw new BadRequestException('Informe o que alterar: o valor ou a fonte.');

    return this.ctx.comEscopoSistema('distribuicao.tarifas.atualizar', async (db) => {
      const [antes] = await db.select({ valor: tarifaMeta.valor, fonte: tarifaMeta.fonte }).from(tarifaMeta).where(eq(tarifaMeta.id, id)).limit(1);
      if (!antes) throw new NotFoundException('Tarifa não encontrada.');
      await db.update(tarifaMeta).set(patch).where(eq(tarifaMeta.id, id));
      return {
        antes: { valor: microsParaNumeric(numericParaMicros(antes.valor)), fonte: antes.fonte },
        valor: patch.valor ?? microsParaNumeric(numericParaMicros(antes.valor)),
      };
    });
  }
}
