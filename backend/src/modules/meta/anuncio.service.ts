/**
 * Conversas abertas por anúncio: a gravação, a leitura e o prazo de guarda.
 *
 * - `registrar` é chamado pelo webhook a cada aviso `messages`. Só grava quando
 *   a mensagem traz a origem de um anúncio E a conta tem um aplicativo
 *   conectado com a permissão de ler isso (`conversas.anuncio.ler`). Sem
 *   aplicativo, não há para que guardar — e nada é guardado. Vale para
 *   qualquer número da conta, guarde ele as conversas ou não: daqui não sai
 *   conteúdo de mensagem. NUNCA lança: a origem do anúncio não segura o resto
 *   do aviso (pedido de saída, status de campanha, conversa).
 * - `listar` é a leitura com cursor que a ferramenta do MCP entrega, dentro da
 *   conta do token.
 * - `apagarVencidas` tira, de hora em hora, o que passou do prazo de guarda.
 *
 * As regras (o que é uma abertura, o cursor, o formato do contrato) ficam em
 * `anuncio.regras.ts`.
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';

import { ContextoDb } from '../../db/contexto';
import { conversaAnuncio } from '../../db/schema';
import {
  aberturasPorAnuncio,
  ESCOPO_DE_LEITURA,
  GUARDA_DIAS,
  lerCursor,
  lerDesde,
  lerLimite,
  MARGEM_SEGUNDOS,
  montarPagina,
  type LinhaDeAbertura,
  type PaginaDoContrato,
} from './anuncio.regras';

const INTERVALO_MS = 60 * 60_000;

function mascararId(valor: string): string {
  return valor.length <= 4 ? '••••' : `••••${valor.slice(-4)}`;
}

@Injectable()
export class ConversaAnuncioService {
  private readonly log = new Logger('ConversaAnuncio');
  private rodando = false;

  constructor(private readonly ctx: ContextoDb) {}

  /** Guarda as mensagens do aviso que vieram de anúncio. Devolve quantas eram novas. */
  async registrar(phoneNumberId: string, value: unknown): Promise<number> {
    try {
      const aberturas = aberturasPorAnuncio(value);
      if (!aberturas.length) return 0;

      return await this.ctx.comEscopoSistema('meta.conversas.anuncio', async (db) => {
        const achado = await db.execute<{ id: string; conta_id: string; conectado: boolean }>(sql`
          select n.id, n.conta_id,
                 exists (
                   select 1 from integracao_token t
                    where t.conta_id = n.conta_id
                      and t.revogado_em is null
                      and t.escopos @> ${JSON.stringify([ESCOPO_DE_LEITURA])}::jsonb
                 ) as conectado
            from wa_numero n
           where n.phone_number_id = ${phoneNumberId}
           limit 1
        `);
        const numero = achado.rows[0];
        if (!numero) return 0;
        if (!numero.conectado) {
          this.log.log(
            `${aberturas.length} mensagem(ns) aberta(s) por anúncio no número ${mascararId(phoneNumberId)}; não guardada(s): a conta não tem aplicativo com a permissão.`,
          );
          return 0;
        }

        const novas = await db
          .insert(conversaAnuncio)
          .values(
            aberturas.map((a) => ({
              contaId: numero.conta_id,
              waNumeroId: numero.id,
              telefoneE164: a.telefone,
              wamid: a.wamid,
              abertaEm: a.abertaEm,
              origemTipo: a.origemTipo,
              origemId: a.origemId,
              ctwaClid: a.ctwaClid,
              origemUrl: a.origemUrl,
            })),
          )
          // A Meta reentrega o aviso: a mesma mensagem não entra duas vezes.
          .onConflictDoNothing({ target: [conversaAnuncio.contaId, conversaAnuncio.wamid] })
          .returning({ id: conversaAnuncio.id });
        if (novas.length) {
          this.log.log(`${novas.length} conversa(s) aberta(s) por anúncio guardada(s) no número ${mascararId(phoneNumberId)}.`);
        }
        return novas.length;
      });
    } catch (erro) {
      this.log.error(
        `A origem do anúncio não foi guardada (número ${mascararId(phoneNumberId)}): ${(erro as Error)?.message ?? String(erro)}`,
        (erro as Error)?.stack,
      );
      return 0;
    }
  }

  /**
   * As conversas abertas por anúncio da conta, na ordem em que entraram.
   * `cursor` continua de onde a leitura parou; `desde` limita a carga inicial
   * pela hora da mensagem.
   */
  async listar(
    contaId: string,
    filtro: { cursor?: string | null; limite?: number | null; desde?: string | null } = {},
  ): Promise<PaginaDoContrato> {
    const cursor = lerCursor(filtro.cursor);
    if (cursor === 'invalido') {
      throw new BadRequestException('O cursor não é válido. Recomece a leitura sem cursor.');
    }
    const desde = lerDesde(filtro.desde);
    if (desde === 'invalido') {
      throw new BadRequestException('O "desde" não é válido. Use um instante completo, com fuso: 2026-07-01T00:00:00Z.');
    }
    const limite = lerLimite(filtro.limite);

    return this.ctx.comConta(contaId, async (db) => {
      const r = await db.execute<{
        id: string;
        registrado: string;
        telefone: string;
        numero_da_loja: string | null;
        aberta_em: Date;
        origem_tipo: string;
        origem_id: string;
        ctwa_clid: string | null;
        origem_url: string | null;
      }>(sql`
        select a.id,
               to_char(a.registrado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as registrado,
               a.telefone_e164 as telefone,
               n.telefone_e164 as numero_da_loja,
               a.aberta_em, a.origem_tipo, a.origem_id, a.ctwa_clid, a.origem_url
          from conversa_anuncio a
          join wa_numero n on n.id = a.wa_numero_id
         where a.conta_id = ${contaId}
           and a.registrado_em <= now() - make_interval(secs => ${MARGEM_SEGUNDOS})
           ${desde ? sql`and a.aberta_em >= ${desde.toISOString()}::timestamptz` : sql``}
           ${cursor ? sql`and (a.registrado_em, a.id) > (${cursor.t}::timestamptz, ${cursor.i}::uuid)` : sql``}
         order by a.registrado_em, a.id
         limit ${limite + 1}
      `);
      const linhas: LinhaDeAbertura[] = r.rows.map((l) => ({
        id: l.id,
        registrado: l.registrado,
        telefone: l.telefone,
        numeroDaLoja: l.numero_da_loja,
        abertaEm: l.aberta_em,
        origemTipo: l.origem_tipo,
        origemId: l.origem_id,
        ctwaClid: l.ctwa_clid,
        origemUrl: l.origem_url,
      }));
      return montarPagina(linhas, limite, cursor);
    });
  }

  /** O prazo de guarda: o que entrou há mais de `GUARDA_DIAS` sai. */
  @Interval(INTERVALO_MS)
  async apagarVencidas(): Promise<number> {
    if (this.rodando) return 0;
    this.rodando = true;
    try {
      const apagadas = await this.ctx.comEscopoSistema('conversas.anuncio.retencao', async (db) => {
        const r = await db.execute(sql`
          delete from conversa_anuncio
           where registrado_em < now() - make_interval(days => ${GUARDA_DIAS})
        `);
        return r.rowCount ?? 0;
      });
      if (apagadas > 0) this.log.log(`Prazo de guarda: ${apagadas} conversa(s) aberta(s) por anúncio apagada(s).`);
      return apagadas;
    } catch (erro) {
      // Nunca deixa subir: exceção aqui derruba o agendador.
      this.log.error(`Prazo de guarda das conversas por anúncio falhou: ${(erro as Error)?.message ?? String(erro)}`);
      return 0;
    } finally {
      this.rodando = false;
    }
  }
}
