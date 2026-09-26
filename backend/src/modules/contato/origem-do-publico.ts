/**
 * De onde sai um público: uma lista, uma importação, a base inteira, um
 * perfil, um estado (pelo DDD) ou um público pronto — como condição sobre a
 * tabela `contato` (sem alias: é o que `expressaoSegmento` e
 * `expressaoPublico` esperam).
 *
 * Um lugar só para os blocos (dividir em blocos) e para a campanha ("Quem
 * recebe → Da base"): o número que uma tela conta é o que a outra entrega.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';

import { ESTADOS, dddsDaUf } from '../../common/ddd';
import type { Db } from '../../db/contexto';
import { contatoLista, importacao } from '../../db/schema';
import { descreverPublico, expressaoPublico } from './publicos';
import { limitesDosPublicos, publicoValido } from './publicos.service';
import { SEGMENTOS, descreverSegmentos, expressaoSegmento, type Segmento } from './segmentacao';
import { parametrosDaConta } from './segmentacao.service';

export const ORIGENS_DO_PUBLICO = ['lista', 'importacao', 'base', 'perfil', 'regiao', 'publico'] as const;
export type OrigemDoPublico = (typeof ORIGENS_DO_PUBLICO)[number];

/** O que a tela pede. `origemId` é a lista ou a importação. */
export interface PedidoDeOrigem {
  origem: OrigemDoPublico;
  origemId?: string | null;
  segmento?: string | null;
  uf?: string | null;
  publico?: string | null;
  publicoValor?: string | null;
}

export interface Origem {
  /** Condição sobre a tabela `contato`, sem alias. */
  filtro: SQL;
  /** O nome como a tela mostra: "Base inteira", o arquivo, o perfil, o público. */
  nome: string;
  /** O que identifica a escolha (o perfil, o estado, `publico:valor`). */
  rotulo: string | null;
  origemId: string | null;
}

/** O nome da importação: o arquivo, ou o jeito como os números entraram. */
export function nomeDaImportacao(i: { arquivoNome: string | null; formato: string }): string {
  return i.arquivoNome || (i.formato === 'texto' ? 'Números colados' : 'Importação');
}

/** A condição de "quem veio desta importação", sobre `contato` — a mesma da contagem e da escolha. */
export function filtroDaImportacao(importacaoId: string, listaId: string | null): SQL {
  // Quem o arquivo trouxe de novo e, se a importação foi para uma lista,
  // também quem já estava na base e entrou nela.
  const naLista = listaId
    ? sql` or exists (select 1 from contato_lista_item li where li.lista_id = ${listaId} and li.contato_id = contato.id)`
    : sql``;
  return sql`(contato.importacao_id = ${importacaoId}${naLista})`;
}

export async function origemDoPublico(db: Db, contaId: string, pedido: PedidoDeOrigem): Promise<Origem> {
  switch (pedido.origem) {
    case 'lista': {
      if (!pedido.origemId) throw new BadRequestException('Escolha a lista.');
      const [l] = await db
        .select({ id: contatoLista.id, nome: contatoLista.nome })
        .from(contatoLista)
        .where(and(eq(contatoLista.id, pedido.origemId), eq(contatoLista.contaId, contaId)))
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
      if (!pedido.origemId) throw new BadRequestException('Escolha a importação.');
      const [i] = await db
        .select({ id: importacao.id, arquivoNome: importacao.arquivoNome, formato: importacao.formato, listaId: importacao.listaId })
        .from(importacao)
        .where(and(eq(importacao.id, pedido.origemId), eq(importacao.contaId, contaId)))
        .limit(1);
      if (!i) throw new NotFoundException('Importação não encontrada.');
      const nome = nomeDaImportacao(i);
      return { filtro: filtroDaImportacao(i.id, i.listaId), nome, rotulo: nome, origemId: i.id };
    }
    case 'base':
      return { filtro: sql`true`, nome: 'Base inteira', rotulo: null, origemId: null };
    case 'perfil': {
      const segmento = pedido.segmento as Segmento;
      if (!SEGMENTOS.includes(segmento)) throw new BadRequestException('Perfil desconhecido.');
      const p = await parametrosDaConta(db, contaId);
      const nome = descreverSegmentos(p)[segmento].nome;
      return { filtro: sql`${expressaoSegmento(p)} = ${segmento}`, nome, rotulo: segmento, origemId: null };
    }
    case 'regiao': {
      const uf = (pedido.uf ?? '').toUpperCase();
      const ddds = dddsDaUf(uf);
      if (!ddds.length) throw new BadRequestException('Estado desconhecido.');
      return {
        // Entre parênteses: quem combinar com outra condição não mistura o `and` daqui.
        filtro: sql`(contato.telefone_e164 like '55%' and substr(contato.telefone_e164, 3, 2) in (${sql.join(
          ddds.map((d) => sql`${d}`),
          sql`, `,
        )}))`,
        nome: ESTADOS[uf] ?? uf,
        rotulo: uf,
        origemId: null,
      };
    }
    case 'publico': {
      const { publico, valor } = publicoValido(pedido.publico ?? undefined, pedido.publicoValor);
      const l = await limitesDosPublicos(db, contaId);
      return {
        filtro: expressaoPublico(publico, valor, l),
        nome: descreverPublico(publico, valor, l).nome,
        rotulo: valor ? `${publico}:${valor}` : publico,
        origemId: null,
      };
    }
  }
}
