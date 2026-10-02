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
  CAMPOS_DA_COBRANCA,
  lerSaude,
  oQueImpedeOEnvio,
  saudeGuardada,
  saudeParaTela,
  type CampoDaCobranca,
  type CampoRecusado,
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
/** Campo da cobrança que a Meta recusou só volta a ser pedido depois disto. */
const ESPERA_DO_CAMPO_RECUSADO_MS = 24 * 3_600_000;

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

/**
 * A cobrança como foi lida: o valor de cada campo que a Meta deixou ler, e os
 * que ela recusou. Campo recusado não é "vazio" — é "não sei".
 */
interface CobrancaLida {
  valores: Partial<Record<CampoDaCobranca, string | null>>;
  lidos: CampoDaCobranca[];
  recusada: CampoRecusado[];
  recusadaEm: Date | null;
}

/** O que a Meta respondeu numa volta. `conta: null` = não deu para ler a saúde. */
interface Leitura {
  conta: SaudeLida | null;
  /** Nulo = a cobrança não foi lida nesta volta (fica valendo a anterior). */
  cobranca: CobrancaLida | null;
  numeros: Array<{ id: string; saude: SaudeLida | null }>;
  /** A autorização da conta caiu (190 e parentes): insistir não conserta. */
  credencial: boolean;
  /** Com que código a leitura da saúde falhou. Só quando `conta` é nulo. */
  falha: { codigo: number | null } | null;
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
      if (!leitura.conta) {
        await this.ctx.comConta(contaId, (db) => this.gravarFalha(db, conta, leitura));
        return;
      }
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
    if (!leitura.conta) {
      await this.ctx.comEscopoSistema('meta.saude.gravar', (db) => this.gravarFalha(db, lido.conta, leitura));
      return { leu: false, credencial: leitura.credencial };
    }

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
    if (!leitura.conta) {
      await this.gravarFalha(db, conta, leitura);
      return false;
    }
    await this.gravar(db, conta, numeros, leitura);
    return true;
  }

  /**
   * Guarda que a última conferência falhou, e com que código — sem a frase da
   * Meta. É o que deixa a tela dizer "a conexão caiu" (190) ou "a Meta não
   * respondeu (código N)" em vez de um "ainda não conferimos" que nunca muda.
   * Não mexe na última leitura boa.
   */
  private async gravarFalha(db: Db, conta: ContaLida, leitura: Leitura): Promise<void> {
    if (!leitura.falha) return;
    const atual = conta.saude && typeof conta.saude === 'object' ? (conta.saude as Record<string, unknown>) : {};
    await db
      .update(waConta)
      .set({
        saude: {
          ...atual,
          entidades: Array.isArray(atual.entidades) ? atual.entidades : [],
          ultimaFalha: { codigo: leitura.falha.codigo, em: new Date().toISOString() },
        },
      })
      .where(eq(waConta.id, conta.id));
  }

  /**
   * As chamadas à Meta de uma volta: a saúde da conta (a que importa), a
   * cobrança (à parte — campo recusado ali não pode esconder a saúde) e a saúde
   * de cada número. Nenhuma falha sobe.
   */
  private async consultarMeta(conta: ContaLida, numeros: NumeroLido[]): Promise<Leitura> {
    const vazia: Leitura = { conta: null, cobranca: null, numeros: [], credencial: false, falha: null };
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
      return { ...vazia, credencial, falha: { codigo: erro instanceof ErroGraph ? erro.codigo : null } };
    }

    const cobranca = await this.lerCobranca(conta, token);

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

    return { conta: saudeDaConta, cobranca, numeros: dosNumeros, credencial: false, falha: null };
  }

  /**
   * A cobrança, campo a campo quando preciso.
   *
   * A Meta recusa a chamada INTEIRA quando a autorização não alcança um dos
   * campos (foi o que aconteceu na primeira leitura real, em 02/10/2026): pedir
   * os quatro juntos e desistir deixava a tela sem a moeda por causa de um
   * campo que nem era ela. Então: os quatro juntos; recusou, um de cada vez. O
   * que ela recusa fica anotado e só volta a ser pedido no dia seguinte.
   *
   * Nulo = nada foi lido nem recusado (rede, tempo esgotado): vale a leitura
   * anterior.
   */
  private async lerCobranca(conta: ContaLida, token: string): Promise<CobrancaLida | null> {
    const anterior = saudeGuardada(conta.saude);
    const recusadaHaPouco =
      anterior?.cobrancaRecusadaEm && Date.now() - anterior.cobrancaRecusadaEm.getTime() < ESPERA_DO_CAMPO_RECUSADO_MS
        ? anterior.cobrancaRecusada
        : [];
    const pedir = CAMPOS_DA_COBRANCA.filter((c) => !recusadaHaPouco.some((r) => r.campo === c));
    const lida: CobrancaLida = {
      valores: {},
      lidos: [],
      recusada: [...recusadaHaPouco],
      recusadaEm: recusadaHaPouco.length ? (anterior?.cobrancaRecusadaEm ?? null) : null,
    };
    if (!pedir.length) return lida;

    const so = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const guardar = (campos: readonly CampoDaCobranca[], r: Record<string, unknown>) => {
      for (const c of campos) {
        lida.valores[c] = so(r[c]);
        lida.lidos.push(c);
      }
    };
    /** A Meta respondeu, e recusou: é dela, não da rede. */
    const recusou = (erro: unknown): erro is ErroGraph => erro instanceof ErroGraph && erro.status >= 400 && erro.status < 500;

    try {
      guardar(pedir, await this.graph.cobrancaDaWaba(conta.wabaId, token, pedir));
      return lida;
    } catch (erro) {
      if (!recusou(erro)) {
        this.log.warn(`Não consegui ler a cobrança da WABA ${this.mascarar(conta.wabaId)}: ${String(erro)}`);
        return null;
      }
      if (pedir.length === 1) {
        lida.recusada.push({ campo: pedir[0], codigo: erro.codigo });
        lida.recusadaEm = new Date();
        return lida;
      }
    }

    for (const campo of pedir) {
      try {
        guardar([campo], await this.graph.cobrancaDaWaba(conta.wabaId, token, [campo]));
      } catch (erro) {
        if (!recusou(erro)) continue;
        lida.recusada.push({ campo, codigo: erro.codigo });
        lida.recusadaEm = new Date();
      }
    }
    if (lida.recusada.length > recusadaHaPouco.length) {
      this.log.warn(
        `A Meta recusou campos da cobrança da WABA ${this.mascarar(conta.wabaId)}: ${lida.recusada.map((r) => `${r.campo} (${r.codigo ?? 'sem código'})`).join(', ')}.`,
      );
    }
    return lida;
  }

  private async gravar(db: Db, conta: ContaLida, numeros: NumeroLido[], leitura: Leitura): Promise<void> {
    const agora = new Date();
    // Sem cobrança lida nesta volta (rede), vale o que a leitura anterior sabia.
    const anterior = saudeGuardada(conta.saude);
    const c = leitura.cobranca;
    const cobranca = {
      cobrancaLidos: c ? c.lidos : (anterior?.cobrancaLidos ?? []),
      cobrancaRecusada: c ? c.recusada : (anterior?.cobrancaRecusada ?? []),
      cobrancaRecusadaEm: (c ? c.recusadaEm : (anterior?.cobrancaRecusadaEm ?? null))?.toISOString() ?? null,
    };
    const lido = (campo: CampoDaCobranca) => Boolean(c?.lidos.includes(campo));
    // Virou bloqueado AGORA (não "continua bloqueado"): comparado antes de gravar.
    const contaBloqueou = leitura.conta!.estado === 'bloqueado' && conta.saudeEstado !== 'bloqueado';
    const numeroBloqueou = leitura.numeros.some(
      (lido) => lido.saude?.estado === 'bloqueado' && numeros.find((n) => n.id === lido.id)?.saudeEstado !== 'bloqueado',
    );

    await db
      .update(waConta)
      .set({
        saudeEstado: leitura.conta!.estado,
        // Sem `ultimaFalha`: a leitura deu certo.
        saude: { entidades: leitura.conta!.entidades, ...cobranca },
        saudeEm: agora,
        // Só o campo que a Meta deixou ler é gravado: recusado não vira "vazio".
        ...(lido('currency') ? { moeda: c!.valores.currency ?? null } : {}),
        ...(lido('timezone_id') ? { fuso: c!.valores.timezone_id ?? null } : {}),
        ...(lido('primary_funding_id') ? { pagamentoId: c!.valores.primary_funding_id ?? null } : {}),
        ...(lido('business_verification_status') ? { verificacaoNegocio: c!.valores.business_verification_status ?? null } : {}),
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
        moedaLida: Boolean(guardada?.cobrancaLidos.includes('currency')),
        pagamentoLido: Boolean(guardada?.cobrancaLidos.includes('primary_funding_id')),
        moeda: conta.moeda,
        fuso: conta.fuso,
        pagamentoId: conta.pagamentoId,
        url: linkDoPagamentoNaMeta(conta.wabaId, conta.businessId),
      },
      tokenExpiraEm: conta.tokenExpiraEm,
      falha: guardada?.ultimaFalha ?? null,
      agora: new Date(),
    });
  }

  private mascarar(valor: string): string {
    return valor.length <= 4 ? '••••' : `••••${valor.slice(-4)}`;
  }
}
