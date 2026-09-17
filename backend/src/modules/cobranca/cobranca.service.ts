/**
 * Assinatura paga: contratar, trocar, cancelar e processar os avisos do
 * Mercado Pago.
 *
 * ## Quem manda em quê
 *
 * - O Mercado Pago é a fonte da verdade do DINHEIRO: se a assinatura foi
 *   autorizada, se a fatura do mês foi paga ou recusada.
 * - Nós somos a fonte da verdade do SERVIÇO: qual plano vale, o ciclo, se os
 *   disparos podem sair.
 *
 * Por isso um aviso (webhook) nunca é lido pelo corpo: ele só diz "algo mudou
 * no recurso X". O estado é SEMPRE relido na API do Mercado Pago. Um aviso
 * forjado, mesmo que passasse na assinatura, não teria como inventar um
 * pagamento aprovado.
 *
 * ## Troca de plano
 *
 * - Para cima: vale na hora (mais disparos já neste ciclo). O Mercado Pago passa
 *   a cobrar o valor novo a partir da próxima fatura.
 * - Para baixo: vale na virada do ciclo — o cliente já pagou o mês pelo plano
 *   maior e não perde os disparos que comprou.
 *
 * ## Idempotência
 *
 * O Mercado Pago reenvia o mesmo aviso várias vezes. Cada aviso entra em
 * `evento_mercadopago` com (tópico, recurso, request-id) único; repetido e já
 * processado é ignorado. E o processamento em si é repetível: relê o estado e
 * grava o mesmo resultado.
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { env } from '../../config/env';
import { ContextoDb, type Db } from '../../db/contexto';
import { assinatura, cobranca, eventoMercadopago, plano, usoCiclo } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { motivoDeBloqueio, retomarPausadasPorTeto } from '../campanha/campanha.service';
import { avisoAutentico, motivoDaRecusa, paraCentavos, statusDaFatura } from './mercadopago';
import { MercadoPagoService } from './mercadopago.service';

export interface PlanoOferta {
  id: string;
  codigo: string;
  nome: string;
  disparosMes: number;
  precoCentavos: number;
}

export interface SituacaoCobranca {
  /** cortesia | ativa | inadimplente | cancelada */
  status: string;
  gratisAte: string | null;
  cicloInicio: string;
  cicloFim: string;
  inadimplenteDesde: string | null;
  /** Quando os disparos param, se nada for pago. Nulo = não há corte previsto. */
  disparosParamEm: string | null;
  /** Os disparos já estão parados por falta de pagamento. */
  bloqueado: boolean;
  carenciaDias: number;
  planoAtual: PlanoOferta | null;
  planoProximoCiclo: PlanoOferta | null;
  /** Estado da assinatura no Mercado Pago: pending | authorized | paused | cancelled. */
  mpStatus: string | null;
  /** Contratação iniciada e não paga: link para concluir. */
  checkoutPendente: { url: string; plano: PlanoOferta | null } | null;
  /** O servidor tem o Mercado Pago configurado. */
  cobrancaDisponivel: boolean;
  uso: { disparos: number; teto: number | null };
  planos: PlanoOferta[];
  cobrancas: {
    id: string;
    valorCentavos: number;
    status: string;
    meio: string | null;
    vencimento: string | null;
    pagoEm: string | null;
    motivo: string | null;
    plano: string | null;
    criadoEm: string;
  }[];
}

export type ResultadoContratacao =
  | { modo: 'checkout'; checkoutUrl: string }
  | { modo: 'trocado'; plano: string }
  | { modo: 'agendado'; plano: string; vigenteEm: string }
  | { modo: 'mantido'; plano: string };

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

@Injectable()
export class CobrancaService {
  private readonly log = new Logger('Cobranca');

  constructor(
    private readonly ctx: ContextoDb,
    private readonly mp: MercadoPagoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ----------------------------------------------------------- tela do cliente

  async situacao(contaId: string): Promise<SituacaoCobranca> {
    const db = this.ctx.db;

    const [a] = await db.select().from(assinatura).where(eq(assinatura.contaId, contaId)).limit(1);
    if (!a) throw new NotFoundException('Esta conta ainda não tem assinatura. Fale com o suporte do RegemCast.');

    const planosTodos = await db.select().from(plano);
    const porId = new Map(planosTodos.map((p) => [p.id, p]));
    const oferta = (id: string | null | undefined): PlanoOferta | null => {
      const p = id ? porId.get(id) : undefined;
      return p ? { id: p.id, codigo: p.codigo, nome: p.nome, disparosMes: p.disparosMes, precoCentavos: p.precoCentavos } : null;
    };

    const [uso] = await db
      .select({ disparos: usoCiclo.disparos })
      .from(usoCiclo)
      .where(and(eq(usoCiclo.contaId, contaId), eq(usoCiclo.cicloInicio, a.cicloInicio)))
      .limit(1);

    const linhas = await db
      .select()
      .from(cobranca)
      .where(eq(cobranca.contaId, contaId))
      .orderBy(desc(cobranca.criadoEm))
      .limit(24);

    const carencia = env.mercadoPago.carenciaDias;
    const somaDias = (d: Date, dias: number) => new Date(d.getTime() + dias * 86_400_000);
    let disparosParamEm: Date | null = null;
    if (a.status === 'cortesia' && a.gratisAte && a.mpStatus !== 'authorized') disparosParamEm = somaDias(a.gratisAte, carencia);
    if (a.status === 'inadimplente') disparosParamEm = somaDias(a.inadimplenteDesde ?? new Date(), carencia);
    if (a.status === 'ativa' && (a.mpStatus === 'cancelled' || a.mpStatus === 'paused')) disparosParamEm = a.cicloFim;

    const bloqueado = (await motivoDeBloqueio(db, contaId)) !== null;

    return {
      status: a.status,
      gratisAte: iso(a.gratisAte),
      cicloInicio: iso(a.cicloInicio)!,
      cicloFim: iso(a.cicloFim)!,
      inadimplenteDesde: iso(a.inadimplenteDesde),
      disparosParamEm: iso(disparosParamEm),
      bloqueado,
      carenciaDias: carencia,
      planoAtual: oferta(a.planoId),
      planoProximoCiclo: oferta(a.planoProximoCicloId),
      mpStatus: a.mpStatus,
      checkoutPendente:
        a.mpStatus === 'pending' && a.mpCheckoutUrl ? { url: a.mpCheckoutUrl, plano: oferta(a.planoContratadoId) } : null,
      cobrancaDisponivel: this.mp.configurado(),
      uso: { disparos: Number(uso?.disparos ?? 0), teto: oferta(a.planoId)?.disparosMes ?? null },
      planos: planosTodos
        .filter((p) => p.publico && p.ativo && p.precoCentavos > 0)
        .sort((x, y) => x.ordem - y.ordem)
        .map((p) => oferta(p.id)!),
      cobrancas: linhas.map((c) => ({
        id: c.id,
        valorCentavos: c.valorCentavos,
        status: c.status,
        meio: c.meio,
        vencimento: iso(c.vencimento),
        pagoEm: iso(c.pagoEm),
        motivo: c.motivo,
        plano: oferta(c.planoId)?.nome ?? null,
        criadoEm: iso(c.criadoEm)!,
      })),
    };
  }

  /** Contrata ou troca de plano. Só o dono chega aqui (DonoGuard). */
  async contratar(
    contaId: string,
    atual: UsuarioAutenticado,
    planoId: string,
    emailPagador?: string,
  ): Promise<ResultadoContratacao> {
    const db = this.ctx.db;

    const [novo] = await db.select().from(plano).where(eq(plano.id, planoId)).limit(1);
    if (!novo || !novo.publico || !novo.ativo || novo.precoCentavos <= 0) {
      throw new BadRequestException('Este plano não está disponível para contratação.');
    }

    const [a] = await db.select().from(assinatura).where(eq(assinatura.contaId, contaId)).limit(1);
    if (!a) throw new NotFoundException('Esta conta ainda não tem assinatura. Fale com o suporte do RegemCast.');

    // ------ já paga pelo Mercado Pago: é troca de plano, não contratação nova
    if (a.mpAssinaturaId && a.mpStatus === 'authorized') {
      const [vigente] = await db.select().from(plano).where(eq(plano.id, a.planoId)).limit(1);

      if (novo.id === a.planoId) {
        if (!a.planoProximoCicloId) throw new BadRequestException(`Você já está no plano ${novo.nome}.`);
        // Desistiu de uma redução agendada: volta a cobrar o valor do plano atual.
        await this.mp.alterarValor(a.mpAssinaturaId, novo.precoCentavos);
        await db
          .update(assinatura)
          .set({ planoProximoCicloId: null, planoContratadoId: novo.id })
          .where(eq(assinatura.id, a.id));
        await this.auditar(contaId, atual, 'assinatura.reducao_desfeita', { plano: novo.codigo });
        return { modo: 'mantido', plano: novo.nome };
      }

      await this.mp.alterarValor(a.mpAssinaturaId, novo.precoCentavos);

      if (!vigente || novo.precoCentavos >= vigente.precoCentavos) {
        await db
          .update(assinatura)
          .set({ planoId: novo.id, planoContratadoId: novo.id, planoProximoCicloId: null })
          .where(eq(assinatura.id, a.id));
        // Mais disparos agora: quem estava parado pelo teto volta à fila.
        await retomarPausadasPorTeto(db, [contaId], ['teto_plano']);
        await this.auditar(contaId, atual, 'assinatura.plano_aumentado', { de: vigente?.codigo, para: novo.codigo });
        return { modo: 'trocado', plano: novo.nome };
      }

      await db
        .update(assinatura)
        .set({ planoProximoCicloId: novo.id, planoContratadoId: novo.id })
        .where(eq(assinatura.id, a.id));
      await this.auditar(contaId, atual, 'assinatura.reducao_agendada', { de: vigente.codigo, para: novo.codigo });
      return { modo: 'agendado', plano: novo.nome, vigenteEm: a.cicloFim.toISOString() };
    }

    // ------ contratação nova (ou refeita)
    if (a.mpAssinaturaId && a.mpStatus === 'pending') {
      // Contratação anterior não concluída: cancela para não existirem duas
      // assinaturas pendentes que poderiam ser pagas as duas.
      await this.mp.cancelar(a.mpAssinaturaId).catch((erro) => {
        this.log.warn(`Não consegui cancelar a assinatura pendente ${a.mpAssinaturaId}: ${(erro as Error)?.message}`);
      });
    }

    const email = (emailPagador ?? '').trim().toLowerCase() || atual.email;
    const criada = await this.mp.criarAssinatura({
      motivo: `RegemCast ${novo.nome} — ${novo.disparosMes.toLocaleString('pt-BR')} disparos por mês`,
      referencia: a.id,
      emailPagador: email,
      valorCentavos: novo.precoCentavos,
      urlRetorno: `${env.rede.appUrl.replace(/\/+$/, '')}/plano?retorno=mercadopago`,
    });

    if (!criada.init_point) {
      throw new BadRequestException('O Mercado Pago não devolveu o link de pagamento. Tente de novo.');
    }

    await db
      .update(assinatura)
      .set({
        mpAssinaturaId: criada.id,
        mpStatus: criada.status ?? 'pending',
        mpCheckoutUrl: criada.init_point,
        planoContratadoId: novo.id,
      })
      .where(eq(assinatura.id, a.id));

    await this.auditar(contaId, atual, 'assinatura.checkout_iniciado', { plano: novo.codigo });
    return { modo: 'checkout', checkoutUrl: criada.init_point };
  }

  /**
   * Cancela a renovação. O plano segue valendo até o fim do ciclo pago; na
   * virada, a assinatura vira `cancelada` e os disparos param.
   */
  async cancelar(contaId: string, atual: UsuarioAutenticado): Promise<{ vigenteAte: string | null }> {
    const db = this.ctx.db;
    const [a] = await db.select().from(assinatura).where(eq(assinatura.contaId, contaId)).limit(1);
    if (!a?.mpAssinaturaId || (a.mpStatus !== 'authorized' && a.mpStatus !== 'pending')) {
      throw new BadRequestException('Não há assinatura ativa do Mercado Pago para cancelar.');
    }

    await this.mp.cancelar(a.mpAssinaturaId);
    await db
      .update(assinatura)
      .set({ mpStatus: 'cancelled', mpCheckoutUrl: null, planoProximoCicloId: null })
      .where(eq(assinatura.id, a.id));

    await this.auditar(contaId, atual, 'assinatura.cancelada_pelo_cliente', { mpStatusAnterior: a.mpStatus });
    return { vigenteAte: a.mpStatus === 'authorized' ? a.cicloFim.toISOString() : null };
  }

  // ------------------------------------------------------- avisos (webhook)

  /**
   * Processa um aviso do Mercado Pago.
   *
   * - `rejeitado`: a assinatura do aviso não conferiu. Gravado, nunca processado.
   * - `duplicado`: o mesmo aviso já foi processado.
   * - `ok` / `ignorado`: processado (ou tópico que não nos interessa).
   *
   * Falha ao processar LANÇA: o controller responde erro e o Mercado Pago tenta
   * de novo mais tarde — o processamento é repetível.
   */
  async processarAviso(dados: {
    topico: string;
    dataId: string;
    requestId?: string;
    xSignature?: string;
  }): Promise<'ok' | 'ignorado' | 'duplicado' | 'rejeitado'> {
    const autentico = avisoAutentico({
      xSignature: dados.xSignature,
      xRequestId: dados.requestId,
      dataId: dados.dataId,
      segredo: env.mercadoPago.webhookSegredo,
    });

    const eventoId = await this.ctx.comEscopoSistema('cobranca.aviso.registrar', async (db) => {
      const r = await db.execute(sql`
        insert into evento_mercadopago (topico, recurso_id, request_id, assinatura_ok)
        values (${dados.topico}, ${dados.dataId}, ${dados.requestId ?? null}, ${autentico})
        on conflict (topico, recurso_id, request_id) where request_id is not null do nothing
        returning id
      `);
      if (r.rows.length) return Number((r.rows[0] as { id: number }).id);

      const [existente] = await db
        .select({ id: eventoMercadopago.id, processadoEm: eventoMercadopago.processadoEm })
        .from(eventoMercadopago)
        .where(
          and(
            eq(eventoMercadopago.topico, dados.topico),
            eq(eventoMercadopago.recursoId, dados.dataId),
            eq(eventoMercadopago.requestId, dados.requestId ?? ''),
          ),
        )
        .limit(1);
      return existente?.processadoEm ? null : existente?.id ?? null;
    });

    if (eventoId === null) return 'duplicado';

    if (!autentico) {
      await this.marcarEvento(eventoId, 'assinatura do aviso não confere');
      this.log.warn(`Aviso do Mercado Pago com assinatura inválida (${dados.topico} ${dados.dataId}) — ignorado.`);
      return 'rejeitado';
    }

    try {
      let resultado: 'ok' | 'ignorado' = 'ignorado';
      if (dados.topico === 'subscription_preapproval') {
        await this.sincronizarAssinatura(dados.dataId);
        resultado = 'ok';
      } else if (dados.topico === 'subscription_authorized_payment') {
        await this.sincronizarFatura(dados.dataId);
        resultado = 'ok';
      }
      await this.marcarEvento(eventoId, null);
      return resultado;
    } catch (erro) {
      await this.marcarEvento(eventoId, (erro as Error)?.message ?? String(erro));
      throw erro;
    }
  }

  /** Relê a assinatura no Mercado Pago e aplica aqui. */
  async sincronizarAssinatura(mpId: string): Promise<void> {
    const pre = await this.mp.lerAssinatura(mpId);

    await this.ctx.comEscopoSistema('cobranca.sincronizar_assinatura', async (db) => {
      const a = await this.buscarPorMp(db, pre.id, pre.external_reference);
      if (!a) {
        this.log.warn(`Assinatura ${pre.id} do Mercado Pago não corresponde a nenhuma conta — ignorada.`);
        return;
      }

      // Aviso atrasado de uma contratação antiga que foi substituída: só vale
      // se ELA foi a paga (authorized) — aí passa a ser a assinatura da conta.
      if (a.mpAssinaturaId && a.mpAssinaturaId !== pre.id && pre.status !== 'authorized') return;

      if (pre.status === 'authorized') {
        await this.ativar(db, a, pre.id);
        return;
      }

      await db
        .update(assinatura)
        .set({
          mpAssinaturaId: pre.id,
          mpStatus: pre.status,
          mpCheckoutUrl: pre.status === 'pending' ? a.mpCheckoutUrl : null,
        })
        .where(eq(assinatura.id, a.id));
    });
  }

  /** Relê a fatura do mês no Mercado Pago e grava a cobrança. */
  async sincronizarFatura(faturaId: string): Promise<void> {
    const f = await this.mp.lerFatura(faturaId);
    const status = statusDaFatura(f);

    await this.ctx.comEscopoSistema('cobranca.sincronizar_fatura', async (db) => {
      const a = await this.buscarPorMp(db, f.preapproval_id ?? '', f.external_reference);
      if (!a) {
        this.log.warn(`Fatura ${faturaId} de assinatura desconhecida (${f.preapproval_id}) — ignorada.`);
        return;
      }

      const motivo = status === 'recusada' ? motivoDaRecusa(f.payment?.status_detail) : null;

      await db.execute(sql`
        insert into cobranca (conta_id, assinatura_id, plano_id, mp_fatura_id, mp_pagamento_id,
                              valor_centavos, status, meio, vencimento, pago_em, motivo)
        values (${a.contaId}, ${a.id}, ${a.planoContratadoId ?? a.planoId}, ${String(f.id)},
                ${f.payment?.id ? String(f.payment.id) : null}, ${paraCentavos(f.transaction_amount)},
                ${status}, ${f.payment_method_id ?? null}, ${f.debit_date ?? null},
                ${status === 'aprovada' ? sql`now()` : null}, ${motivo})
        on conflict (mp_fatura_id) where mp_fatura_id is not null do update
           set status = excluded.status,
               mp_pagamento_id = coalesce(excluded.mp_pagamento_id, cobranca.mp_pagamento_id),
               meio = coalesce(excluded.meio, cobranca.meio),
               motivo = excluded.motivo,
               pago_em = coalesce(cobranca.pago_em, excluded.pago_em)
      `);

      if (status === 'aprovada') {
        await this.ativar(db, a, f.preapproval_id ?? a.mpAssinaturaId ?? '');
        return;
      }

      if (status === 'recusada' && a.status === 'ativa') {
        await db
          .update(assinatura)
          .set({ status: 'inadimplente', inadimplenteDesde: sql`coalesce(${assinatura.inadimplenteDesde}, now())` })
          .where(eq(assinatura.id, a.id));
        await this.auditoria.registrar({
          contaId: a.contaId,
          atorTipo: 'sistema',
          acao: 'assinatura.inadimplente',
          entidade: 'assinatura',
          entidadeId: a.id,
          detalhe: { fatura: String(f.id), motivo },
        });
      }
    });
  }

  // ------------------------------------------------------------------ apoio

  /**
   * Pagamento confirmado: plano contratado passa a valer, inadimplência some e
   * os disparos parados voltam. Quem vinha do grátis ou de um atraso começa um
   * ciclo novo a partir de agora — é o mês que acabou de pagar.
   */
  private async ativar(db: Db, a: typeof assinatura.$inferSelect, mpId: string): Promise<void> {
    const cicloNovo = a.status !== 'ativa';

    await db
      .update(assinatura)
      .set({
        status: 'ativa',
        mpStatus: 'authorized',
        mpAssinaturaId: mpId || a.mpAssinaturaId,
        mpCheckoutUrl: null,
        planoId: a.planoProximoCicloId ? a.planoId : (a.planoContratadoId ?? a.planoId),
        inadimplenteDesde: null,
        ...(cicloNovo ? { cicloInicio: sql`now()`, cicloFim: sql`now() + interval '1 month'` } : {}),
      })
      .where(eq(assinatura.id, a.id));

    const retomadas = await retomarPausadasPorTeto(db, [a.contaId], ['teto_plano', 'inadimplencia']);

    if (a.status !== 'ativa') {
      await this.auditoria.registrar({
        contaId: a.contaId,
        atorTipo: 'sistema',
        acao: 'assinatura.ativada',
        entidade: 'assinatura',
        entidadeId: a.id,
        detalhe: { statusAnterior: a.status, cicloNovo, campanhasRetomadas: retomadas },
      });
    }
  }

  private async buscarPorMp(db: Db, mpId: string, referencia?: string) {
    if (mpId) {
      const [porMp] = await db.select().from(assinatura).where(eq(assinatura.mpAssinaturaId, mpId)).limit(1);
      if (porMp) return porMp;
    }
    // A referência externa é o id da NOSSA assinatura — cobre o aviso que chega
    // antes de termos gravado o id do Mercado Pago.
    if (referencia && /^[0-9a-f-]{36}$/i.test(referencia)) {
      const [porRef] = await db.select().from(assinatura).where(eq(assinatura.id, referencia)).limit(1);
      return porRef ?? null;
    }
    return null;
  }

  private async marcarEvento(id: number, erro: string | null): Promise<void> {
    await this.ctx.comEscopoSistema('cobranca.aviso.marcar', (db) =>
      db
        .update(eventoMercadopago)
        .set(erro ? { erro: erro.slice(0, 500) } : { processadoEm: sql`now()`, erro: null })
        .where(eq(eventoMercadopago.id, id)),
    );
  }

  private async auditar(
    contaId: string,
    atual: UsuarioAutenticado,
    acao: string,
    detalhe: Record<string, unknown>,
  ): Promise<void> {
    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: atual.id,
      acao,
      entidade: 'assinatura',
      detalhe,
    });
  }
}
