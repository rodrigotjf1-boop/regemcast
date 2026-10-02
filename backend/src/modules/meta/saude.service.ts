/**
 * A saúde da conta na Meta: lê o `health_status` da conta e de cada número,
 * mais a cobrança (moeda, fuso, forma de pagamento), guarda e monta o que a
 * tela mostra. As regras estão em `saude.regras.ts`; aqui ficam as chamadas à
 * Meta e o banco.
 *
 * Três caminhos leem, e os três gravam igual:
 *
 * - **a tela** (`GET /whatsapp/saude`): usa o que está guardado se foi lido há
 *   pouco; senão pergunta à Meta na hora;
 * - **o disparo** (`conferirAntesDeEnviar`): pergunta de novo e, se a Meta diz
 *   que a conta ou o número está bloqueado, recusa antes de mandar a primeira
 *   mensagem — em vez de descobrir pela recusa de cada uma;
 * - **o sistema** (a rotina de 30 minutos e o aviso `account_update`): sem
 *   conta no contexto, pela chave mestra.
 *
 * Nada aqui pode derrubar quem chama: a Meta fora do ar, o token vencido ou um
 * campo recusado viram "não consegui ler agora", e o que já estava guardado
 * continua valendo para a tela (nunca para barrar o disparo).
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';

import { env } from '../../config/env';
import { ContextoDb, type Db } from '../../db/contexto';
import { waConta, waNumero } from '../../db/schema';
import { AvisoService } from '../aviso/aviso.service';
import { decifrarToken } from './cripto';
import { ErroGraph, GraphService } from './graph.service';
import { linkDoPagamentoNaMeta } from './pagamento';
import {
  lerSaude,
  oQueImpedeOEnvio,
  saudeGuardada,
  saudeParaTela,
  type EstadoDeEnvio,
  type SaudeLida,
  type SaudeParaTela,
} from './saude.regras';

/** Na tela, a leitura guardada vale por este tempo. */
const VALIDADE_NA_TELA_MS = 10 * 60_000;
/** No disparo, só vale o que a Meta disse agora. */
const VALIDADE_NO_DISPARO_MS = 2 * 60_000;
/** O "Conferir agora" não pergunta à Meta mais de uma vez neste intervalo. */
const INTERVALO_DO_CONFERIR_MS = 20_000;

interface ContaLida {
  id: string;
  contaId: string;
  wabaId: string;
  businessId: string | null;
  tokenCifrado: string | null;
  tokenExpiraEm: Date | null;
  moeda: string | null;
  fuso: string | null;
  pagamentoId: string | null;
  saudeEstado: string | null;
  saude: unknown;
  saudeEm: Date | null;
}

interface NumeroLido {
  id: string;
  phoneNumberId: string;
  telefone: string | null;
  status: string;
  saudeEstado: string | null;
  saude: unknown;
}

/** O que a Meta respondeu numa volta. `conta: null` = não deu para ler; nada é gravado. */
interface Leitura {
  conta: SaudeLida | null;
  cobranca: { moeda: string | null; fuso: string | null; pagamentoId: string | null; verificacao: string | null } | null;
  numeros: Array<{ id: string; saude: SaudeLida | null }>;
  /** A autorização da conta caiu (190 e parentes): insistir não conserta. */
  credencial: boolean;
}

@Injectable()
export class SaudeService {
  private readonly log = new Logger('SaudeDaConta');

  constructor(
    private readonly ctx: ContextoDb,
    private readonly graph: GraphService,
    private readonly avisos: AvisoService,
  ) {}

  /**
   * A saúde para a tela. `atualizar` força a pergunta à Meta (o botão "Conferir
   * agora"); sem ele, a leitura guardada vale por 10 minutos.
   */
  async daConta(contaId: string, opcoes: { atualizar?: boolean } = {}): Promise<SaudeParaTela | { conectado: false }> {
    let lido = await this.ler(this.ctx.db, eq(waConta.contaId, contaId));
    if (!lido) return { conectado: false };

    const validade = opcoes.atualizar ? INTERVALO_DO_CONFERIR_MS : VALIDADE_NA_TELA_MS;
    if (this.vencida(lido.conta.saudeEm, validade)) {
      await this.atualizar(this.ctx.db, lido.conta, lido.numeros);
      lido = (await this.ler(this.ctx.db, eq(waConta.contaId, contaId))) ?? lido;
    }
    return this.montar(lido.conta, lido.numeros);
  }

  /**
   * Antes de disparar ou retomar: se a Meta diz AGORA que a conta ou o número
   * está bloqueado, recusa com o motivo e o que fazer — a primeira mensagem
   * teria essa resposta, e as seguintes também.
   *
   * Só barra com leitura fresca. Sem resposta da Meta, o disparo segue: quem
   * decide é ela, na primeira mensagem (e a campanha pausa na primeira recusa).
   */
  async conferirAntesDeEnviar(contaId: string): Promise<void> {
    let lido = await this.ler(this.ctx.db, eq(waConta.contaId, contaId));
    if (!lido) return;

    if (this.vencida(lido.conta.saudeEm, VALIDADE_NO_DISPARO_MS)) {
      if (!lido.conta.tokenCifrado) return;
      const { conta, numeros } = lido;
      const leitura = await this.consultarMeta(conta, numeros);
      if (!leitura.conta) return;
      // Em transação PRÓPRIA: a recusa logo abaixo desfaz a transação do pedido,
      // e a leitura tem de ficar. Sem isto a tela continuava com o estado velho
      // e o aviso de "bloqueou agora" saía de novo a cada tentativa de disparo.
      await this.ctx.comConta(contaId, (db) => this.gravar(db, conta, numeros, leitura));
      lido = (await this.ler(this.ctx.db, eq(waConta.contaId, contaId))) ?? lido;
    }

    const impede = oQueImpedeOEnvio(this.montar(lido.conta, lido.numeros));
    if (!impede) return;
    throw new BadRequestException(
      `Não dá para enviar agora. ${impede.titulo}. ${impede.acao ?? ''} Os detalhes estão em WhatsApp, no menu.`.replace(/\s+/g, ' '),
    );
  }

  /**
   * Relê a saúde de uma conta pela chave mestra — a rotina de 30 minutos e o
   * aviso de mudança na conta, que chegam sem conta no contexto. Nenhuma
   * transação fica aberta durante a chamada à Meta. Devolve se a autorização
   * caiu, para a rotina não insistir.
   */
  async atualizarDoSistema(filtro: { waContaId: string } | { wabaId: string }): Promise<{ leu: boolean; credencial: boolean }> {
    const onde = 'waContaId' in filtro ? eq(waConta.id, filtro.waContaId) : eq(waConta.wabaId, filtro.wabaId);
    const lido = await this.ctx.comEscopoSistema('meta.saude.ler', (db) => this.ler(db, onde));
    if (!lido?.conta.tokenCifrado) return { leu: false, credencial: false };

    const leitura = await this.consultarMeta(lido.conta, lido.numeros);
    if (!leitura.conta) return { leu: false, credencial: leitura.credencial };

    await this.ctx.comEscopoSistema('meta.saude.gravar', (db) => this.gravar(db, lido.conta, lido.numeros, leitura));
    return { leu: true, credencial: false };
  }

  // ------------------------------------------------------------------ apoio

  private vencida(lidaEm: Date | null, validadeMs: number): boolean {
    return !lidaEm || Date.now() - lidaEm.getTime() > validadeMs;
  }

  private async ler(db: Db, onde: ReturnType<typeof eq>): Promise<{ conta: ContaLida; numeros: NumeroLido[] } | null> {
    const [conta] = await db
      .select({
        id: waConta.id,
        contaId: waConta.contaId,
        wabaId: waConta.wabaId,
        businessId: waConta.businessId,
        tokenCifrado: waConta.tokenCifrado,
        tokenExpiraEm: waConta.tokenExpiraEm,
        moeda: waConta.moeda,
        fuso: waConta.fuso,
        pagamentoId: waConta.pagamentoId,
        saudeEstado: waConta.saudeEstado,
        saude: waConta.saude,
        saudeEm: waConta.saudeEm,
      })
      .from(waConta)
      .where(onde)
      .orderBy(asc(waConta.criadoEm))
      .limit(1);
    if (!conta) return null;

    const numeros = await db
      .select({
        id: waNumero.id,
        phoneNumberId: waNumero.phoneNumberId,
        telefone: waNumero.telefoneE164,
        status: waNumero.status,
        saudeEstado: waNumero.saudeEstado,
        saude: waNumero.saude,
      })
      .from(waNumero)
      .where(and(eq(waNumero.waContaId, conta.id), eq(waNumero.status, 'registrado')));

    return { conta, numeros };
  }

  /** Pergunta à Meta e grava, no contexto de quem chamou. Devolve se a conta foi lida. */
  private async atualizar(db: Db, conta: ContaLida, numeros: NumeroLido[]): Promise<boolean> {
    if (!conta.tokenCifrado) return false;
    const leitura = await this.consultarMeta(conta, numeros);
    if (!leitura.conta) return false;
    await this.gravar(db, conta, numeros, leitura);
    return true;
  }

  /**
   * As chamadas à Meta de uma volta: a saúde da conta (a que importa), a
   * cobrança (à parte — campo recusado ali não pode esconder a saúde) e a saúde
   * de cada número. Nenhuma falha sobe.
   */
  private async consultarMeta(conta: ContaLida, numeros: NumeroLido[]): Promise<Leitura> {
    const vazia: Leitura = { conta: null, cobranca: null, numeros: [], credencial: false };
    let token: string;
    try {
      token = decifrarToken(conta.tokenCifrado!, env.meta.tokenChave);
    } catch (erro) {
      this.log.error(`Não consegui decifrar o token da WABA ${this.mascarar(conta.wabaId)}: ${String(erro)}`);
      return vazia;
    }

    let saudeDaConta: SaudeLida | null;
    try {
      const bruto = await this.graph.saudeDe(conta.wabaId, token);
      saudeDaConta = lerSaude(bruto);
      if (!saudeDaConta) {
        this.log.warn(
          `A Meta respondeu uma saúde que não reconhecemos para a WABA ${this.mascarar(conta.wabaId)}: ${JSON.stringify(bruto ?? null).slice(0, 300)}. Nada foi gravado.`,
        );
        return vazia;
      }
    } catch (erro) {
      const credencial = erro instanceof ErroGraph && erro.classe === 'credencial';
      this.log.warn(
        `Não consegui ler a saúde da WABA ${this.mascarar(conta.wabaId)}: ${erro instanceof ErroGraph ? erro.detalheParaLog : String(erro)}`,
      );
      return { ...vazia, credencial };
    }

    let cobranca: Leitura['cobranca'] = null;
    try {
      const c = await this.graph.cobrancaDaWaba(conta.wabaId, token);
      const so = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      cobranca = {
        moeda: so(c.currency),
        fuso: so(c.timezone_id),
        pagamentoId: so(c.primary_funding_id),
        verificacao: so(c.business_verification_status),
      };
    } catch (erro) {
      this.log.warn(
        `Não consegui ler a cobrança da WABA ${this.mascarar(conta.wabaId)}: ${erro instanceof ErroGraph ? erro.detalheParaLog : String(erro)}`,
      );
    }

    const dosNumeros: Leitura['numeros'] = [];
    for (const n of numeros) {
      try {
        dosNumeros.push({ id: n.id, saude: lerSaude(await this.graph.saudeDe(n.phoneNumberId, token)) });
      } catch (erro) {
        this.log.warn(
          `Não consegui ler a saúde do número ${this.mascarar(n.phoneNumberId)}: ${erro instanceof ErroGraph ? erro.detalheParaLog : String(erro)}`,
        );
        dosNumeros.push({ id: n.id, saude: null });
      }
    }

    return { conta: saudeDaConta, cobranca, numeros: dosNumeros, credencial: false };
  }

  private async gravar(db: Db, conta: ContaLida, numeros: NumeroLido[], leitura: Leitura): Promise<void> {
    const agora = new Date();
    const cobrancaLida = leitura.cobranca !== null || saudeGuardada(conta.saude)?.cobrancaLida === true;
    // Virou bloqueado AGORA (não "continua bloqueado"): comparado antes de gravar.
    const contaBloqueou = leitura.conta!.estado === 'bloqueado' && conta.saudeEstado !== 'bloqueado';
    const numeroBloqueou = leitura.numeros.some(
      (lido) => lido.saude?.estado === 'bloqueado' && numeros.find((n) => n.id === lido.id)?.saudeEstado !== 'bloqueado',
    );

    await db
      .update(waConta)
      .set({
        saudeEstado: leitura.conta!.estado,
        saude: { entidades: leitura.conta!.entidades, cobrancaLida },
        saudeEm: agora,
        ...(leitura.cobranca
          ? {
              moeda: leitura.cobranca.moeda,
              fuso: leitura.cobranca.fuso,
              pagamentoId: leitura.cobranca.pagamentoId,
              verificacaoNegocio: leitura.cobranca.verificacao,
            }
          : {}),
      })
      .where(eq(waConta.id, conta.id));

    for (const lido of leitura.numeros) {
      if (!lido.saude) continue;
      await db
        .update(waNumero)
        .set({ saudeEstado: lido.saude.estado, saude: { entidades: lido.saude.entidades }, saudeEm: agora })
        .where(eq(waNumero.id, lido.id));
    }

    // Um aviso por virada.
    if (contaBloqueou || numeroBloqueou) {
      void this.avisos.avisar(conta.contaId, 'campanhas', {
        titulo: 'Sua conta não pode enviar agora',
        corpo: 'A Meta bloqueou o envio desta conta do WhatsApp. Abra WhatsApp no Regemcast para ver o motivo e o que fazer.',
        dados: { tela: 'whatsapp' },
      });
      this.log.warn(`A Meta bloqueou o envio da WABA ${this.mascarar(conta.wabaId)} (conta ${conta.contaId}).`);
    }
  }

  private montar(conta: ContaLida, numeros: NumeroLido[]): SaudeParaTela {
    const guardada = saudeGuardada(conta.saude);
    const estado = conta.saudeEstado as EstadoDeEnvio | null;
    return saudeParaTela({
      conta: guardada && estado && conta.saudeEm ? { estado, entidades: guardada.entidades, lidaEm: conta.saudeEm } : null,
      numeros: numeros.map((n) => {
        const doNumero = saudeGuardada(n.saude);
        return {
          phoneNumberId: n.phoneNumberId,
          telefone: n.telefone,
          saude: doNumero && n.saudeEstado ? { estado: n.saudeEstado as EstadoDeEnvio, entidades: doNumero.entidades } : null,
        };
      }),
      cobranca: {
        lida: guardada?.cobrancaLida === true,
        moeda: conta.moeda,
        fuso: conta.fuso,
        pagamentoId: conta.pagamentoId,
        url: linkDoPagamentoNaMeta(conta.wabaId, conta.businessId),
      },
      tokenExpiraEm: conta.tokenExpiraEm,
      agora: new Date(),
    });
  }

  private mascarar(valor: string): string {
    return valor.length <= 4 ? '••••' : `••••${valor.slice(-4)}`;
  }
}
