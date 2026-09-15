/**
 * Onboarding da conta de WhatsApp do cliente.
 *
 * O fluxo inteiro, na ordem em que a Meta exige:
 *
 *   1. O cliente completa o Embedded Signup no navegador e volta com
 *      `code`, `waba_id` e `phone_number_id`.
 *   2. **Em menos de 30 segundos**, trocamos o `code` por um token de acesso do
 *      cliente. Esse é o prazo real do `code`, e é por isso que ele não passeia
 *      por fila nem por outra tela: chega e é trocado no mesmo request.
 *   3. Assinamos nosso app na WABA dele — individualmente, por WABA. Sem isso,
 *      nenhum webhook daquela conta chega.
 *   4. Registramos o número na Cloud API com um PIN. Sem isso, todo envio falha
 *      com 133010, e a mensagem crua da Meta não diz que falta registrar.
 *   5. O cliente cadastra o método de pagamento dele no WhatsApp Manager. Esse
 *      passo é dele e não temos como fazer por ele: no modelo Tech Provider, a
 *      Meta cobra o cliente direto pelas conversas.
 *
 * O token fica cifrado em repouso. Ele permite enviar em nome do cliente e ler
 * o histórico de entrega dele — guardá-lo em claro faria de um dump de banco a
 * chave do WhatsApp de todos os clientes de uma vez.
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { env } from '../../config/env';
import { ContextoDb } from '../../db/contexto';
import { waConta, waNumero } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { cifrarToken, decifrarToken } from './cripto';
import { ErroGraph, GraphService } from './graph.service';

export interface DadosDoSignup {
  code: string;
  wabaId: string;
  phoneNumberId: string;
}

export interface ResultadoOnboarding {
  wabaId: string;
  phoneNumberId: string;
  telefone: string | null;
  nome: string | null;
  /** false quando o número precisa do PIN do cliente para ser registrado. */
  registrado: boolean;
  /** O que ainda falta o cliente fazer, em pt-BR. */
  pendencias: string[];
}

/** Qualidade como a Meta reporta × como guardamos. */
const QUALIDADE: Record<string, string> = {
  GREEN: 'verde',
  YELLOW: 'amarela',
  RED: 'vermelha',
  UNKNOWN: 'desconhecida',
};

/**
 * Teto de usuários únicos por 24h, por nome de tier.
 *
 * `TIER_UNLIMITED` devolve `null` — e aqui está uma armadilha que o Regem tem:
 * lá, tier desconhecido TAMBÉM devolve null, então um nome novo que a Meta
 * invente vira "sem teto" e a campanha dispara sem freio. Por isso separamos:
 * desconhecido devolve `undefined` (não sabemos) e ilimitado devolve `null`
 * (sabemos que não há teto).
 */
function limiteDoTier(tier: string | undefined): number | null | undefined {
  if (!tier) return undefined;
  const mapa: Record<string, number | null> = {
    TIER_50: 50,
    TIER_250: 250,
    TIER_1K: 1_000,
    TIER_10K: 10_000,
    TIER_100K: 100_000,
    TIER_UNLIMITED: null,
  };
  return tier in mapa ? mapa[tier] : undefined;
}

@Injectable()
export class MetaService {
  private readonly log = new Logger('Meta');

  constructor(
    private readonly ctx: ContextoDb,
    private readonly graph: GraphService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** O que o front precisa para abrir o Embedded Signup. Nada aqui é segredo. */
  configDoSignup(): { appId: string; configId: string; graphVersao: string } {
    if (!env.meta.appId || !env.meta.configId) {
      throw new BadRequestException(
        'A conexão com o WhatsApp ainda não está configurada no servidor. Fale com o suporte do Regemcast.',
      );
    }
    return {
      appId: env.meta.appId,
      configId: env.meta.configId,
      graphVersao: env.meta.graphVersao,
    };
  }

  async concluirOnboarding(
    contaId: string,
    usuarioId: string,
    dados: DadosDoSignup,
  ): Promise<ResultadoOnboarding> {
    const { code, wabaId, phoneNumberId } = dados;

    // 1. Troca do code. Primeiro de tudo, porque ele vive 30 segundos — se
    //    fizermos qualquer consulta antes, o prazo pode estourar.
    let token: string;
    try {
      const r = await this.graph.trocarCodePorToken(code);
      token = r.token;
    } catch (erro) {
      if (erro instanceof ErroGraph) {
        this.log.error(`Troca do code falhou: ${erro.detalheParaLog}`);
        throw new BadRequestException(
          'Não conseguimos concluir a conexão. O código de autorização expira em 30 segundos — ' +
            'feche a janela e tente conectar de novo.',
        );
      }
      throw erro;
    }

    // 2. Dados da WABA. Se isto falhar, o token é inválido e não adianta seguir.
    const waba = await this.graph.dadosDaWaba(wabaId, token).catch((erro) => {
      if (erro instanceof ErroGraph) {
        this.log.error(`Leitura da WABA ${wabaId} falhou: ${erro.detalheParaLog}`);
      }
      throw erro;
    });

    // 3. Grava a conta com o token cifrado, antes de qualquer chamada que possa
    //    falhar no meio. Assim o cliente não fica com uma conexão "meio feita"
    //    e sem credencial para retomar.
    const registro = await this.gravarWaConta(contaId, {
      wabaId,
      nome: waba.name ?? null,
      moeda: waba.currency ?? null,
      statusRevisao: waba.account_review_status ?? null,
      token,
    });

    const pendencias: string[] = [];

    // 4. Assinar o webhook na WABA do cliente. É individual por WABA.
    try {
      await this.graph.assinarWebhook(wabaId, token);
      await this.ctx.db
        .update(waConta)
        .set({ webhookAssinadoEm: new Date() })
        .where(eq(waConta.id, registro.id));
    } catch (erro) {
      const detalhe = erro instanceof ErroGraph ? erro.detalheParaLog : String(erro);
      this.log.error(`Assinatura do webhook na WABA ${wabaId} falhou: ${detalhe}`);
      pendencias.push(
        'Não conseguimos ativar o recebimento de status de entrega. Vamos tentar de novo automaticamente.',
      );
    }

    // 5. Número: grava o que a Meta conhece dele e tenta registrar.
    const numero = await this.gravarNumero(contaId, registro.id, wabaId, phoneNumberId, token);

    let registrado = false;
    try {
      // PIN de 6 dígitos gerado por nós. Não guardamos: se o número já tiver
      // verificação em duas etapas, a Meta recusa com 133005 e aí o PIN precisa
      // ser o que o cliente definiu — pedimos a ele, usamos e descartamos.
      const pin = String(randomInt(100_000, 1_000_000));
      await this.graph.registrarNumero(phoneNumberId, pin, token);
      await this.ctx.db
        .update(waNumero)
        .set({ status: 'registrado', registradoEm: new Date() })
        .where(eq(waNumero.id, numero.id));
      registrado = true;
    } catch (erro) {
      const traduzido = erro instanceof ErroGraph ? erro.traduzido : null;
      const detalhe = erro instanceof ErroGraph ? erro.detalheParaLog : String(erro);
      this.log.error(`Registro do número ${phoneNumberId} falhou: ${detalhe}`);
      pendencias.push(
        traduzido?.explicacao ??
          'Não conseguimos concluir o registro do número. Vamos tentar de novo automaticamente.',
      );
    }

    // 6. O passo que é do cliente e não dá para fazer por ele.
    pendencias.push(
      'Cadastre uma forma de pagamento no WhatsApp Manager. No modelo em que operamos, a Meta cobra as conversas direto de você — sem isso, nenhuma mensagem sai.',
    );

    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuarioId,
      acao: 'whatsapp.conectado',
      entidade: 'wa_conta',
      entidadeId: registro.id,
      // Sem token, sem PIN. O que serve para auditar é o QUE foi conectado.
      detalhe: { wabaId, phoneNumberId, registrado, nome: waba.name ?? null },
    });

    return {
      wabaId,
      phoneNumberId,
      telefone: numero.telefoneE164,
      nome: waba.name ?? null,
      registrado,
      pendencias,
    };
  }

  private async gravarWaConta(
    contaId: string,
    dados: {
      wabaId: string;
      nome: string | null;
      moeda: string | null;
      statusRevisao: string | null;
      token: string;
    },
  ): Promise<{ id: string }> {
    const cifrado = cifrarToken(dados.token, env.meta.tokenChave);
    const agora = new Date();

    const [existente] = await this.ctx.db
      .select({ id: waConta.id })
      .from(waConta)
      .where(and(eq(waConta.contaId, contaId), eq(waConta.wabaId, dados.wabaId)))
      .limit(1);

    if (existente) {
      await this.ctx.db
        .update(waConta)
        .set({
          nome: dados.nome,
          moeda: dados.moeda,
          statusRevisao: dados.statusRevisao,
          tokenCifrado: cifrado,
          tokenEm: agora,
          onboardadaEm: agora,
        })
        .where(eq(waConta.id, existente.id));
      return existente;
    }

    const [criado] = await this.ctx.db
      .insert(waConta)
      .values({
        contaId,
        wabaId: dados.wabaId,
        nome: dados.nome,
        moeda: dados.moeda,
        statusRevisao: dados.statusRevisao,
        tokenCifrado: cifrado,
        tokenEm: agora,
        onboardadaEm: agora,
      })
      .returning({ id: waConta.id });

    return criado!;
  }

  private async gravarNumero(
    contaId: string,
    waContaId: string,
    wabaId: string,
    phoneNumberId: string,
    token: string,
  ): Promise<{ id: string; telefoneE164: string | null }> {
    // Busca o que a Meta sabe do número. Se falhar, gravamos o mínimo: ter o
    // número registrado localmente vale mais que abortar o onboarding inteiro.
    let telefone: string | null = null;
    let nomeExibicao: string | null = null;
    let qualidade = 'desconhecida';
    let tierLimite: number | null | undefined;
    let tierNome: string | null = null;

    try {
      const r = await this.graph.numerosDaWaba(wabaId, token);
      const achado = r.data?.find((n) => n.id === phoneNumberId);
      if (achado) {
        telefone = achado.display_phone_number ?? null;
        nomeExibicao = achado.verified_name ?? null;
        qualidade = QUALIDADE[achado.quality_rating ?? 'UNKNOWN'] ?? 'desconhecida';
        tierNome = achado.messaging_limit_tier ?? null;
        tierLimite = limiteDoTier(achado.messaging_limit_tier);
      }
    } catch (erro) {
      const detalhe = erro instanceof ErroGraph ? erro.detalheParaLog : String(erro);
      this.log.warn(`Não consegui ler os números da WABA ${wabaId}: ${detalhe}`);
    }

    const agora = new Date();
    const [existente] = await this.ctx.db
      .select({ id: waNumero.id })
      .from(waNumero)
      .where(eq(waNumero.phoneNumberId, phoneNumberId))
      .limit(1);

    const valores = {
      telefoneE164: telefone,
      nomeExibicao,
      qualidade,
      qualidadeEm: agora,
      // `undefined` significa "a Meta não disse" — não sobrescreve o que já
      // sabíamos. `null` significa "ilimitado", e esse sim precisa ser gravado.
      ...(tierLimite === undefined ? {} : { tierLimite, tierNome, tierEm: agora }),
    };

    if (existente) {
      await this.ctx.db.update(waNumero).set(valores).where(eq(waNumero.id, existente.id));
      return { id: existente.id, telefoneE164: telefone };
    }

    const [criado] = await this.ctx.db
      .insert(waNumero)
      .values({ contaId, waContaId, phoneNumberId, ...valores })
      .returning({ id: waNumero.id });

    return { id: criado!.id, telefoneE164: telefone };
  }

  /**
   * Token do cliente, decifrado, para uso interno.
   *
   * Não existe caminho que devolva isto para fora: nem para o front, nem em
   * resposta de API, nem em log. O cliente autorizou o acesso; manusear a
   * credencial é nosso.
   */
  async tokenDaConta(contaId: string): Promise<{ token: string; wabaId: string } | null> {
    const [linha] = await this.ctx.db
      .select({ tokenCifrado: waConta.tokenCifrado, wabaId: waConta.wabaId })
      .from(waConta)
      .where(eq(waConta.contaId, contaId))
      .limit(1);

    if (!linha?.tokenCifrado) return null;
    return {
      token: decifrarToken(linha.tokenCifrado, env.meta.tokenChave),
      wabaId: linha.wabaId,
    };
  }

  /** O que a tela de configuração mostra. Nunca inclui o token. */
  async situacao(contaId: string) {
    const [c] = await this.ctx.db
      .select({
        wabaId: waConta.wabaId,
        nome: waConta.nome,
        moeda: waConta.moeda,
        statusRevisao: waConta.statusRevisao,
        conectadaEm: waConta.onboardadaEm,
        webhookAssinadoEm: waConta.webhookAssinadoEm,
      })
      .from(waConta)
      .where(eq(waConta.contaId, contaId))
      .limit(1);

    if (!c) return { conectado: false as const };

    const numeros = await this.ctx.db
      .select({
        phoneNumberId: waNumero.phoneNumberId,
        telefone: waNumero.telefoneE164,
        nome: waNumero.nomeExibicao,
        qualidade: waNumero.qualidade,
        tierLimite: waNumero.tierLimite,
        tierNome: waNumero.tierNome,
        status: waNumero.status,
      })
      .from(waNumero)
      .where(eq(waNumero.contaId, contaId));

    return { conectado: true as const, conta: c, numeros };
  }

  /**
   * Registra (ou re-registra) um número na Cloud API.
   *
   * Existe separado do onboarding por causa do PIN. Quando o número já tem
   * verificação em duas etapas, o PIN que geramos é recusado com 133005 e só o
   * que o cliente definiu no WhatsApp Manager serve — então ele precisa de um
   * caminho para informá-lo. Sem esta rota, o onboarding terminaria com uma
   * pendência sem saída.
   *
   * O PIN informado é usado e descartado: não vai para o banco nem para log.
   */
  async registrarNumero(
    contaId: string,
    usuarioId: string,
    phoneNumberId: string,
    pinInformado?: string,
  ): Promise<{ registrado: boolean; mensagem: string }> {
    const credencial = await this.tokenDaConta(contaId);
    if (!credencial) {
      throw new BadRequestException(
        'Nenhuma conta de WhatsApp conectada. Conecte a conta antes de registrar o número.',
      );
    }

    const [numero] = await this.ctx.db
      .select({ id: waNumero.id })
      .from(waNumero)
      .where(and(eq(waNumero.contaId, contaId), eq(waNumero.phoneNumberId, phoneNumberId)))
      .limit(1);

    if (!numero) {
      throw new BadRequestException('Não encontramos este número na sua conta.');
    }

    const pin = pinInformado ?? String(randomInt(100_000, 1_000_000));

    try {
      await this.graph.registrarNumero(phoneNumberId, pin, credencial.token);
    } catch (erro) {
      if (erro instanceof ErroGraph) {
        this.log.error(`Registro do número falhou: ${erro.detalheParaLog}`);
        // A frase traduzida já diz o que fazer — inclusive pedir o PIN quando
        // o caso é 133005.
        throw new BadRequestException(erro.mensagemParaUsuario);
      }
      throw erro;
    }

    await this.ctx.db
      .update(waNumero)
      .set({ status: 'registrado', registradoEm: new Date() })
      .where(eq(waNumero.id, numero.id));

    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuarioId,
      acao: 'whatsapp.numero_registrado',
      entidade: 'wa_numero',
      entidadeId: numero.id,
      // Sem o PIN, obviamente. O que importa auditar é que foi registrado e por quem.
      detalhe: { phoneNumberId, comPinDoCliente: Boolean(pinInformado) },
    });

    return {
      registrado: true,
      mensagem: 'Número registrado. Já dá para enviar por ele.',
    };
  }

}
