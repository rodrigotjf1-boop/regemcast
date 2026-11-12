/**
 * O aviso assinado a quem pediu (Hub DMS, F5 parte B, PR 3; decisão F5-7): o registro pela porta MCP e a entrega.
 * (Não confundir com o módulo `aviso`, que é o aviso no celular de quem usa o Regemcast.)
 *
 * - Registrar, ler e remover rodam na transação da ferramenta (a conta da credencial).
 * - A entrega é da rotina (`AvisoAssinadoJob`), fora de qualquer request: reserva os devidos numa escrita curta em
 *   escopo de sistema, manda cada um FORA de transação (nenhuma conexão de banco presa durante a chamada de rede) e
 *   grava o desfecho numa escrita curta e condicional. O `webhook-id` é o id da linha, o mesmo em todas as tentativas.
 * - Antes de cada envio, a credencial do produto na conta tem de seguir valendo, com a permissão do aviso (Padrão §9:
 *   a ligação revogada não recebe o que estava na fila), e a parada do hub segura o envio sem contar falha.
 * - Cada tentativa vai ao registro do hub: para quem, o tipo, o resultado e só a origem do destino. Nunca o conteúdo.
 *
 * Detalhe em `docs/aprovacao-de-disparos.md`.
 */
import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { env } from '../../config/env';
import { ContextoDb } from '../../db/contexto';
import { cabecalhosAviso, ferramentaDoAviso, origemDoDestino, resultadoDoAviso, type AvisoRegistrado } from '../../dms/integracao-dms';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { HubService } from '../hub/hub.service';
import { cifrarToken, decifrarToken } from '../meta/cripto';
import {
  basesDoProduto,
  conferirRegistro,
  corpoDoAviso,
  entregue,
  FALHAS_PARA_PAUSAR,
  PAUSADO_POR_FALHAS,
  PRAZO_DO_ENVIO_MS,
  proximaTentativa,
  SEM_AVISO,
  SEM_CREDENCIAL,
  SO_DMS_AVISO,
  TIPO_ACAO_ALTERADA,
} from './aviso-assinado.regras';

/** A permissão que o aviso `acao.alterada` exige da credencial do produto na conta (a do pedido de disparo). */
export const PERMISSAO_DO_AVISO = 'campanhas.disparar';

/** Quantos avisos cada rodada da rotina reserva. */
const LOTE = 20;

/** Quem registra: a conta e o produto da credencial que chamou a porta. */
export interface QuemRegistra {
  contaId: string;
  produto: string;
  classe: 'dms' | 'externo';
  /** O prefixo visível da credencial que registrou (para a auditoria; nunca o segredo). */
  prefixo: string | null;
}

/** O aviso como a porta mostra: nunca o segredo. */
export type SituacaoDoAviso = {
  registrado: boolean;
  url?: string;
  registrado_em?: string;
  pausado?: boolean;
  pausa_motivo?: string;
  ultimo_envio_em?: string;
  ultimo_status?: number;
  na_fila?: number;
  tipos: string[];
};

/** O que a rotina reservou para mandar. */
type Devido = {
  id: string;
  conta_id: string;
  produto: string;
  tipo: string;
  recurso_id: string;
  mudou_em: string;
  tentativas: number;
};

/** O envio (os testes trocam): devolve o status, ou nulo quando não houve resposta. */
export type Enviar = (url: string, cabecalhos: Record<string, string>, corpo: string) => Promise<{ status: number | null; erro: string | null }>;

/** O envio padrão: POST, sem seguir redirecionamento (o endereço foi conferido no registro), com prazo. Não lança. */
export const enviarPadrao: Enviar = async (url, cabecalhos, corpo) => {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...cabecalhos },
      body: corpo,
      redirect: 'manual',
      signal: AbortSignal.timeout(PRAZO_DO_ENVIO_MS),
    });
    await r.body?.cancel().catch(() => undefined);
    return { status: r.status, erro: entregue(r.status) ? null : `o destino respondeu ${r.status}` };
  } catch (e) {
    return { status: null, erro: String((e as Error)?.message ?? e).slice(0, 300) };
  }
};

@Injectable()
export class AvisoAssinadoService {
  private readonly log = new Logger('AvisoAssinado');

  /** O envio (os testes trocam). */
  enviar: Enviar = enviarPadrao;
  /** O relógio (os testes avançam). */
  agora: () => Date = () => new Date();

  constructor(
    private readonly ctx: ContextoDb,
    private readonly auditoria: AuditoriaService,
    private readonly hub: HubService,
  ) {}

  // -------------------------------------------------------------- a porta

  /** Registra (ou troca) o endereço e o segredo do produto nesta conta. Registrar de novo religa o que estava pausado. */
  async registrar(quem: QuemRegistra, r: { url: unknown; segredo: unknown }): Promise<SituacaoDoAviso> {
    if (quem.classe !== 'dms') throw new ForbiddenException(SO_DMS_AVISO);
    const conferido = conferirRegistro(r, basesDoProduto(quem.produto, env.aviso?.bases ?? {}));
    if (!conferido.ok) throw new BadRequestException(conferido.mensagem);
    const cifrado = cifrarToken(String(r.segredo), env.integracoes.chave);
    await this.ctx.db.execute(sql`
      insert into integracao_aviso (conta_id, produto, url, segredo_cifrado)
      values (${quem.contaId}, ${quem.produto}, ${conferido.url}, ${cifrado})
      on conflict (conta_id, produto) do update
         set url = excluded.url, segredo_cifrado = excluded.segredo_cifrado, atualizado_em = now(),
             falhas_seguidas = 0, falhando_desde = null, pausado_em = null, pausa_motivo = null
    `);
    await this.auditoria.registrar({
      contaId: quem.contaId,
      atorTipo: 'integracao',
      acao: 'integracao.aviso_registrado',
      entidade: 'integracao_aviso',
      detalhe: { produto: quem.produto, destino: origemDoDestino(conferido.url) ?? null, prefixo: quem.prefixo },
    });
    return this.ler(quem);
  }

  /** O aviso do produto nesta conta, sem o segredo. */
  async ler(quem: Pick<QuemRegistra, 'contaId' | 'produto'>): Promise<SituacaoDoAviso> {
    const r = await this.ctx.db.execute<{
      url: string;
      atualizado_em: string;
      pausado_em: string | null;
      pausa_motivo: string | null;
      ultimo_envio_em: string | null;
      ultimo_status: number | null;
      na_fila: number;
    }>(sql`
      select a.url, a.atualizado_em, a.pausado_em, a.pausa_motivo, a.ultimo_envio_em, a.ultimo_status,
             (select count(*)::int from aviso_saida s
               where s.conta_id = a.conta_id and s.produto = a.produto and s.entregue_em is null and s.desistido_em is null) as na_fila
        from integracao_aviso a
       where a.conta_id = ${quem.contaId} and a.produto = ${quem.produto}
    `);
    const l = r.rows[0];
    if (!l) return { registrado: false, tipos: [TIPO_ACAO_ALTERADA] };
    return {
      registrado: true,
      url: l.url,
      registrado_em: new Date(l.atualizado_em).toISOString(),
      pausado: l.pausado_em !== null,
      ...(l.pausa_motivo ? { pausa_motivo: l.pausa_motivo } : {}),
      ...(l.ultimo_envio_em ? { ultimo_envio_em: new Date(l.ultimo_envio_em).toISOString() } : {}),
      ...(l.ultimo_status !== null && l.ultimo_status !== undefined ? { ultimo_status: Number(l.ultimo_status) } : {}),
      na_fila: Number(l.na_fila ?? 0),
      tipos: [TIPO_ACAO_ALTERADA],
    };
  }

  /** Para de avisar: apaga o endereço e o segredo; o que estava na fila não sai mais. Sem registro: nada muda. */
  async remover(quem: QuemRegistra): Promise<{ removido: boolean }> {
    const r = await this.ctx.db.execute<{ id: string }>(sql`
      delete from integracao_aviso where conta_id = ${quem.contaId} and produto = ${quem.produto} returning id
    `);
    if (!r.rows.length) return { removido: false };
    await this.ctx.db.execute(sql`
      update aviso_saida set desistido_em = now(), ultimo_erro = ${SEM_AVISO}
       where conta_id = ${quem.contaId} and produto = ${quem.produto} and entregue_em is null and desistido_em is null
    `);
    await this.auditoria.registrar({
      contaId: quem.contaId,
      atorTipo: 'integracao',
      acao: 'integracao.aviso_removido',
      entidade: 'integracao_aviso',
      detalhe: { produto: quem.produto, prefixo: quem.prefixo },
    });
    return { removido: true };
  }

  // ------------------------------------------------------------- a entrega

  /**
   * Uma rodada da rotina: reserva os devidos (empurra a próxima tentativa para daqui a 2 minutos, para outro processo
   * não pegar o mesmo) e entrega um por um. Não lança.
   */
  async entregarDevidos(): Promise<{ reservados: number; entregues: number }> {
    let devidos: Devido[] = [];
    try {
      devidos = await this.ctx.comEscopoSistema('aviso.entregar.reservar', async (db) => {
        const r = await db.execute<Devido>(sql`
          with devidos as (
            select s.id from aviso_saida s
             where s.entregue_em is null and s.desistido_em is null and s.proxima_em <= now()
             order by s.proxima_em
             limit ${LOTE}
             for update skip locked
          )
          update aviso_saida s set proxima_em = now() + interval '2 minutes'
            from devidos d
           where s.id = d.id
          returning s.id, s.conta_id, s.produto, s.tipo, s.recurso_id, s.mudou_em::text as mudou_em, s.tentativas
        `);
        return r.rows;
      });
    } catch (erro) {
      this.log.warn(`Avisos não reservados agora: ${String((erro as Error)?.message ?? erro)}`);
      return { reservados: 0, entregues: 0 };
    }
    let entregues = 0;
    for (const d of devidos) {
      try {
        if (await this.entregarUm(d)) entregues += 1;
      } catch (erro) {
        this.log.warn(`Aviso ${d.id} não entregue agora: ${String((erro as Error)?.message ?? erro)}`);
      }
    }
    return { reservados: devidos.length, entregues };
  }

  /** Um aviso: confere o registro, a credencial e a parada; manda; grava o desfecho. Devolve se foi entregue. */
  private async entregarUm(d: Devido): Promise<boolean> {
    const alvo = await this.ctx.comEscopoSistema('aviso.entregar.conferir', async (db) => {
      const r = await db.execute<{ url: string; segredo_cifrado: string; pausado_em: string | null; conta_nome: string | null; prefixo: string | null }>(sql`
        select a.url, a.segredo_cifrado, a.pausado_em, c.nome as conta_nome,
               coalesce(
                 (select g.prefixo from integracao_ligacao g
                   where g.conta_id = a.conta_id and g.produto = a.produto and g.revogado_em is null and g.classe = 'dms'
                     and g.escopos ? ${PERMISSAO_DO_AVISO}
                   order by g.criado_em desc limit 1),
                 (select t.prefixo from integracao_token t
                   where t.conta_id = a.conta_id and t.produto = a.produto and t.revogado_em is null and t.classe = 'dms'
                     and t.escopos ? ${PERMISSAO_DO_AVISO}
                   order by t.criado_em desc limit 1)) as prefixo
          from integracao_aviso a join conta c on c.id = a.conta_id
         where a.conta_id = ${d.conta_id} and a.produto = ${d.produto}
      `);
      return r.rows[0] ?? null;
    });

    // Sem registro (removido), pausado ou sem credencial que valha: o aviso não sai, e não sai mais.
    if (!alvo) return this.desistir(d, SEM_AVISO);
    if (alvo.pausado_em) return this.desistir(d, PAUSADO_POR_FALHAS);
    if (!alvo.prefixo) return this.desistir(d, SEM_CREDENCIAL);

    const ocorridoEm = this.agora();
    const tentativa = Number(d.tentativas) + 1;
    const registro = (resultado: AvisoRegistrado['resultado'], status: number | null, duracaoMs: number): AvisoRegistrado => ({
      codigo: `${d.id}:${tentativa}`,
      ocorrido_em: ocorridoEm.toISOString(),
      aplicativo: d.produto,
      ligacao_prefixo: alvo.prefixo ?? undefined,
      conta: d.conta_id,
      ...(alvo.conta_nome ? { conta_nome: alvo.conta_nome } : {}),
      tipo: d.tipo,
      destino: origemDoDestino(alvo.url),
      resultado,
      ...(status !== null ? { status_http: status } : {}),
      duracao_ms: duracaoMs,
      tentativa,
    });

    // A parada do hub (o aplicativo, a ligação ou o tipo): espera sem contar falha, e sai quando a parada acabar.
    if (this.hub.parado({ aplicativo: d.produto, ligacaoPrefixo: alvo.prefixo, ferramenta: ferramentaDoAviso(d.tipo) })) {
      await this.ctx.comEscopoSistema('aviso.entregar.desfecho', (db) =>
        db.execute(sql`update aviso_saida set proxima_em = now() + interval '1 minute' where id = ${d.id} and entregue_em is null`),
      );
      this.hub.registrarAviso(registro('pausado', null, 0));
      return false;
    }

    let segredo: string;
    try {
      segredo = decifrarToken(alvo.segredo_cifrado, env.integracoes.chave);
    } catch {
      // A chave das integrações mudou: não é falha do destino. Pausa o registro (registrar de novo religa).
      await this.pausar(d, 'O segredo guardado não abre mais neste servidor. Registre o aviso de novo.');
      return this.desistir(d, 'O segredo guardado não abre mais neste servidor.');
    }

    const corpo = corpoDoAviso(d.tipo, d.recurso_id);
    const inicio = Date.now();
    const r = await this.enviar(alvo.url, cabecalhosAviso(segredo, d.id, corpo, ocorridoEm), corpo);
    const duracao = Date.now() - inicio;
    const ok = entregue(r.status);
    this.hub.registrarAviso(registro(resultadoDoAviso(r.status), r.status, duracao));

    return this.ctx.comEscopoSistema('aviso.entregar.desfecho', async (db) => {
      if (ok) {
        // Fecha só se o pedido não mudou de novo depois da reserva; se mudou, sai outra vez (o aviso é só gatilho).
        const fechou = await db.execute(sql`
          update aviso_saida set entregue_em = now(), ultimo_status = ${r.status}, ultimo_erro = null, tentativas = tentativas + 1
           where id = ${d.id} and entregue_em is null and mudou_em = ${d.mudou_em}::timestamptz
          returning id
        `);
        if (!fechou.rows.length) {
          await db.execute(sql`
            update aviso_saida set proxima_em = now(), tentativas = 0, ultimo_status = ${r.status}, ultimo_erro = null
             where id = ${d.id} and entregue_em is null
          `);
        }
        await db.execute(sql`
          update integracao_aviso
             set falhas_seguidas = 0, falhando_desde = null, ultimo_envio_em = now(), ultimo_status = ${r.status}
           where conta_id = ${d.conta_id} and produto = ${d.produto}
        `);
        return true;
      }
      const agora = this.agora();
      const proxima = proximaTentativa(tentativa, agora);
      await db.execute(sql`
        update aviso_saida
           set tentativas = ${tentativa}, ultimo_status = ${r.status}, ultimo_erro = ${r.erro},
               proxima_em = ${(proxima ?? agora).toISOString()}::timestamptz,
               desistido_em = ${proxima ? null : agora.toISOString()}::timestamptz
         where id = ${d.id} and entregue_em is null
      `);
      const a = await db.execute<{ falhas_seguidas: number }>(sql`
        update integracao_aviso
           set falhas_seguidas = falhas_seguidas + 1, falhando_desde = coalesce(falhando_desde, now()),
               ultimo_envio_em = now(), ultimo_status = ${r.status}
         where conta_id = ${d.conta_id} and produto = ${d.produto}
        returning falhas_seguidas
      `);
      if (Number(a.rows[0]?.falhas_seguidas ?? 0) >= FALHAS_PARA_PAUSAR) {
        await db.execute(sql`
          update integracao_aviso set pausado_em = now(), pausa_motivo = ${PAUSADO_POR_FALHAS}
           where conta_id = ${d.conta_id} and produto = ${d.produto} and pausado_em is null
        `);
        this.log.warn(`Aviso de ${d.produto} na conta ${d.conta_id} pausado depois de ${FALHAS_PARA_PAUSAR} falhas seguidas.`);
      }
      return false;
    });
  }

  private async desistir(d: Devido, motivo: string): Promise<false> {
    await this.ctx.comEscopoSistema('aviso.entregar.desfecho', (db) =>
      db.execute(sql`
        update aviso_saida set desistido_em = now(), ultimo_erro = ${motivo.slice(0, 300)}
         where id = ${d.id} and entregue_em is null and desistido_em is null
      `),
    );
    return false;
  }

  private async pausar(d: Devido, motivo: string): Promise<void> {
    await this.ctx.comEscopoSistema('aviso.entregar.desfecho', (db) =>
      db.execute(sql`
        update integracao_aviso set pausado_em = now(), pausa_motivo = ${motivo.slice(0, 300)}
         where conta_id = ${d.conta_id} and produto = ${d.produto} and pausado_em is null
      `),
    );
  }
}
