/**
 * Catálogo de planos, editado pelo console de distribuição.
 *
 * Preço e teto mudam sem deploy — é decisão comercial, não de código. Três
 * cuidados:
 *
 * - **O código não muda.** É a identidade do plano (auditoria, integração com o
 *   gateway). Renomear é trocar o `nome`.
 * - **Aumentar o teto devolve à fila** as campanhas pausadas por falta de
 *   disparos das contas nesse plano. Senão o cliente teria o limite maior e a
 *   campanha continuaria parada até alguém clicar em "retomar".
 * - **Desativar não mexe em quem já tem o plano.** Só tira das opções novas.
 *   Trocar o plano de uma conta em uso por baixo dela é decisão de cobrança.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import { ContextoDb } from '../../db/contexto';
import { plano } from '../../db/schema';
import { retomarPausadasPorTeto } from '../campanha/campanha.service';

export interface PlanoNoConsole {
  id: string;
  codigo: string;
  nome: string;
  disparosMes: number;
  precoCentavos: number;
  ativo: boolean;
  publico: boolean;
  ordem: number;
  /** Quantas contas usam este plano hoje. */
  contas: number;
}

export interface DadosPlano {
  codigo?: string;
  nome?: string;
  disparosMes?: number;
  precoCentavos?: number;
  ativo?: boolean;
  publico?: boolean;
  ordem?: number;
}

@Injectable()
export class DistribuicaoPlanosService {
  constructor(private readonly ctx: ContextoDb) {}

  async listar(): Promise<PlanoNoConsole[]> {
    return this.ctx.comEscopoSistema('distribuicao.planos.listar', async (db) => {
      const r = await db.execute(sql`
        select p.id, p.codigo, p.nome, p.disparos_mes, p.preco_centavos, p.ativo, p.publico, p.ordem,
               (select count(*) from conta c
                  left join assinatura a on a.conta_id = c.id
                 where coalesce(a.plano_id, c.plano_id) = p.id) as contas
          from plano p
         order by p.ordem, p.criado_em
      `);
      return (r.rows as Record<string, unknown>[]).map((l) => ({
        id: String(l.id),
        codigo: String(l.codigo),
        nome: String(l.nome),
        disparosMes: Number(l.disparos_mes),
        precoCentavos: Number(l.preco_centavos),
        ativo: Boolean(l.ativo),
        publico: Boolean(l.publico),
        ordem: Number(l.ordem),
        contas: Number(l.contas),
      }));
    });
  }

  async criar(dados: DadosPlano): Promise<{ id: string }> {
    const codigo = (dados.codigo ?? '').trim().toLowerCase();
    if (!/^[a-z0-9_]{2,40}$/.test(codigo)) {
      throw new BadRequestException('O código usa só letras minúsculas, números e _ (2 a 40 caracteres).');
    }
    this.conferir(dados, true);

    return this.ctx.comEscopoSistema('distribuicao.planos.criar', async (db) => {
      try {
        const [criado] = await db
          .insert(plano)
          .values({
            codigo,
            nome: dados.nome!.trim(),
            disparosMes: dados.disparosMes!,
            precoCentavos: dados.precoCentavos!,
            ativo: dados.ativo ?? true,
            publico: dados.publico ?? true,
            ordem: dados.ordem ?? 0,
          })
          .returning({ id: plano.id });
        return { id: criado!.id };
      } catch (erro) {
        if ((erro as { code?: string })?.code === '23505') {
          throw new ConflictException(`Já existe um plano com o código "${codigo}".`);
        }
        throw erro;
      }
    });
  }

  async atualizar(id: string, dados: DadosPlano): Promise<{ antes: PlanoNoConsole; retomadas: number }> {
    if (dados.codigo !== undefined) {
      throw new BadRequestException('O código do plano não muda. Para renomear, altere o nome.');
    }
    this.conferir(dados, false);

    return this.ctx.comEscopoSistema('distribuicao.planos.atualizar', async (db) => {
      const [antes] = await db.select().from(plano).where(eq(plano.id, id)).limit(1);
      if (!antes) throw new NotFoundException('Plano não encontrado.');

      const patch: Partial<typeof plano.$inferInsert> = {};
      if (dados.nome !== undefined) patch.nome = dados.nome.trim();
      if (dados.disparosMes !== undefined) patch.disparosMes = dados.disparosMes;
      if (dados.precoCentavos !== undefined) patch.precoCentavos = dados.precoCentavos;
      if (dados.ativo !== undefined) patch.ativo = dados.ativo;
      if (dados.publico !== undefined) patch.publico = dados.publico;
      if (dados.ordem !== undefined) patch.ordem = dados.ordem;

      if (Object.keys(patch).length === 0) {
        throw new BadRequestException('Informe o que alterar.');
      }

      await db.update(plano).set(patch).where(eq(plano.id, id));

      // Teto maior: quem estava parado por falta de disparos neste plano volta à fila.
      let retomadas = 0;
      if (dados.disparosMes !== undefined && dados.disparosMes > antes.disparosMes) {
        const contas = await db.execute(sql`
          select c.id from conta c left join assinatura a on a.conta_id = c.id
           where coalesce(a.plano_id, c.plano_id) = ${id}
        `);
        const ids = (contas.rows as { id: string }[]).map((l) => l.id);
        if (ids.length) retomadas = await retomarPausadasPorTeto(db, ids);
      }

      return {
        antes: {
          id: antes.id,
          codigo: antes.codigo,
          nome: antes.nome,
          disparosMes: antes.disparosMes,
          precoCentavos: antes.precoCentavos,
          ativo: antes.ativo,
          publico: antes.publico,
          ordem: antes.ordem,
          contas: 0,
        },
        retomadas,
      };
    });
  }

  private conferir(d: DadosPlano, criando: boolean): void {
    const exigir = (campo: keyof DadosPlano, frase: string) => {
      if (criando && d[campo] === undefined) throw new BadRequestException(frase);
    };
    exigir('nome', 'Informe o nome do plano.');
    exigir('disparosMes', 'Informe quantos disparos por mês o plano tem.');
    exigir('precoCentavos', 'Informe o preço do plano.');

    if (d.nome !== undefined && (d.nome.trim().length < 2 || d.nome.trim().length > 60)) {
      throw new BadRequestException('O nome do plano precisa ter de 2 a 60 caracteres.');
    }
    if (d.disparosMes !== undefined && (!Number.isInteger(d.disparosMes) || d.disparosMes < 0 || d.disparosMes > 10_000_000)) {
      throw new BadRequestException('Disparos por mês precisa ser um número inteiro entre 0 e 10 milhões.');
    }
    if (d.precoCentavos !== undefined && (!Number.isInteger(d.precoCentavos) || d.precoCentavos < 0 || d.precoCentavos > 100_000_000)) {
      throw new BadRequestException('O preço precisa ser um valor em centavos entre 0 e R$ 1.000.000,00.');
    }
    if (d.ordem !== undefined && !Number.isInteger(d.ordem)) {
      throw new BadRequestException('A ordem precisa ser um número inteiro.');
    }
  }
}
