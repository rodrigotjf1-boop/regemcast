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
import { conta, waConta, waNumero } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { cifrarToken, decifrarToken } from './cripto';
import { ErroGraph, GraphService } from './graph.service';

export interface DadosDoSignup {
  code: string;
  wabaId: string;
  /**
   * No fluxo de coexistência a Meta pode **não** enviar este campo — está
   * documentado. Por isso é opcional aqui, e descoberto consultando a WABA
   * quando faltar.
   */
  phoneNumberId?: string;
  /** true quando o cliente escolheu manter o WhatsApp Business no celular. */
  coexistencia?: boolean;
}

/** O que `conectarComToken` precisa, venha o token de onde vier. */
interface ParametrosConexao {
  contaId: string;
  /** `null` quando quem conectou foi a distribuição, não um usuário da conta. */
  atorUsuarioId: string | null;
  token: string;
  expiraEm: Date | null;
  wabaId: string;
  phoneNumberId: string;
  coexistencia: boolean;
  /** O número já está registrado na Cloud API; pular o `/register`. */
  jaRegistrado: boolean;
}

export interface ResultadoOnboarding {
  wabaId: string;
  phoneNumberId: string;
  telefone: string | null;
  nome: string | null;
  /** false quando o número precisa do PIN do cliente para ser registrado. */
  registrado: boolean;
  /** true quando o numero tambem segue no app do celular. */
  coexistencia: boolean;
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

/**
 * Teto de vazão em mensagens por segundo.
 *
 * A Meta trava a coexistência em 20 mps, contra até 80 de um número dedicado.
 * Não é detalhe de motor: é a diferença entre uma campanha grande levar vinte
 * minutos ou mais de uma hora, e o cliente precisa saber disso ANTES de
 * escolher o caminho, não depois de reclamar da demora.
 */
const VAZAO_COEXISTENCIA = 20;
const VAZAO_DEDICADA = 80;

/** O prazo da coexistência: 24 horas contadas do fim do onboarding. */
const PRAZO_SINCRONIZACAO_HORAS = 24;

/**
 * Quantas horas ainda restam para sincronizar os dados do app do celular.
 *
 * `null` quando não há prazo correndo — número dedicado, sincronização já
 * concluída, ou já expirada. Assim a tela decide entre avisar e ficar quieta
 * sem recalcular a regra das 24 horas por conta própria.
 */
function horasParaSincronizar(
  sincronizacao: string,
  onboardadoEm: Date | null,
): number | null {
  if (sincronizacao !== 'pendente' && sincronizacao !== 'sincronizando') return null;
  if (!onboardadoEm) return null;
  const limite = onboardadoEm.getTime() + PRAZO_SINCRONIZACAO_HORAS * 3_600_000;
  const restam = (limite - Date.now()) / 3_600_000;
  return restam > 0 ? Math.round(restam * 10) / 10 : 0;
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
    const { code, wabaId } = dados;
    const phoneNumberId = dados.phoneNumberId ?? '';
    const coexistencia = dados.coexistencia === true;

    // 1. Troca do code. Primeiro de tudo, porque ele vive 30 segundos — se
    //    fizermos qualquer consulta antes, o prazo pode estourar.
    let token: string;
    let expiraEm: Date | null = null;
    try {
      const r = await this.graph.trocarCodePorToken(code);
      token = r.token;
      // A Meta devolve a validade em segundos. O template que usamos emite
      // token com prazo (60 dias), e guardar isso é o que permite avisar antes
      // de a campanha parar com erro 190.
      if (r.expiraEm && r.expiraEm > 0) {
        expiraEm = new Date(Date.now() + r.expiraEm * 1000);
      }
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

    return this.conectarComToken({
      contaId,
      atorUsuarioId: usuarioId,
      token,
      expiraEm,
      wabaId,
      phoneNumberId,
      coexistencia,
      // No Embedded Signup nunca sabemos de antemão: o registro é tentado e o
      // erro, se houver, vira pendência com instrução.
      jaRegistrado: false,
    });
  }

  /**
   * Conecta uma WABA informando o token direto, sem Embedded Signup.
   *
   * É operação da DISTRIBUIÇÃO, não do cliente — fica atrás do
   * `DistTokenGuard`, como as rotas do console. Existe por dois motivos reais,
   * e nenhum deles é conveniência:
   *
   * 1. **O número de teste da Meta não passa pelo Embedded Signup.** Ele
   *    pertence à WABA do próprio app, e é com ele que se constrói e se grava o
   *    vídeo do App Review — que libera o Acesso Avançado, que libera o
   *    Embedded Signup para cliente real. Sem este caminho o produto não sai do
   *    lugar: precisaria do signup para gravar o vídeo que destrava o signup.
   * 2. **Suporte.** Quando o signup de um cliente falha no meio, alguém precisa
   *    terminar a conexão sem mandar ele refazer tudo.
   *
   * O token entra por aqui e some: é cifrado antes de tocar o banco e nunca
   * volta em resposta nenhuma.
   */
  async conectarManual(
    contaId: string,
    dados: { wabaId: string; phoneNumberId?: string; token: string; jaRegistrado?: boolean },
  ): Promise<ResultadoOnboarding> {
    // A conta precisa existir. Escopo de sistema porque a rota não tem sessão:
    // quem chama é a distribuição, e a conta ainda não é "a do request".
    const existe = await this.ctx.comEscopoSistema('whatsapp.conectar-manual', async (db) => {
      const [c] = await db
        .select({ id: conta.id })
        .from(conta)
        .where(eq(conta.id, contaId))
        .limit(1);
      return Boolean(c);
    });

    if (!existe) {
      throw new BadRequestException('Não encontramos esta conta.');
    }

    this.log.warn(
      `Conexão manual do WhatsApp na conta ${contaId} (WABA ${dados.wabaId}) — ` +
        'operação da distribuição, fora do Embedded Signup.',
    );

    // Daqui para frente é exatamente o caminho do Embedded Signup. A transação
    // é aberta aqui porque o interceptor só abre contexto em rota autenticada.
    return this.ctx.comConta(contaId, () =>
      this.conectarComToken({
        contaId,
        atorUsuarioId: null,
        token: dados.token,
        // Token informado à mão pode ser permanente (usuário do sistema) ou o
        // temporário de 24h. Não dá para saber daqui, e chutar seria pior que
        // não ter: o aviso de vencimento passaria a mentir.
        expiraEm: null,
        wabaId: dados.wabaId,
        phoneNumberId: dados.phoneNumberId ?? '',
        // Coexistência exige Acesso Avançado, que é justamente o que ainda não
        // temos. Número de teste é sempre dedicado.
        coexistencia: false,
        jaRegistrado: dados.jaRegistrado === true,
      }),
    );
  }

  /**
   * Conecta uma WABA à conta quando o token do cliente já está em mãos.
   *
   * Existe separado do `concluirOnboarding` porque o token pode chegar por dois
   * caminhos — o Embedded Signup (o normal) e a conexão manual da distribuição
   * — e **tudo depois do token é idêntico**. Duplicar isso significaria corrigir
   * defeito em dois lugares e esquecer um; e o que vem depois não é trivial:
   * ordem de gravação, assinatura de webhook, descoberta do número, registro ou
   * sincronização, e a trilha de auditoria.
   *
   * Roda **dentro de um contexto de conta** já aberto. Quem chama decide: o
   * onboarding herda a transação do request; a conexão manual abre a própria.
   */
  private async conectarComToken(p: ParametrosConexao): Promise<ResultadoOnboarding> {
    const { contaId, atorUsuarioId, token, expiraEm, wabaId, phoneNumberId, coexistencia } = p;
    const jaRegistrado = p.jaRegistrado;

    // 2. Dados da WABA. Se isto falhar, o token é inválido e não adianta seguir.
    const waba = await this.graph.dadosDaWaba(wabaId, token).catch((erro) => {
      if (erro instanceof ErroGraph) {
        this.log.error(`Leitura da WABA ${wabaId} falhou: ${erro.detalheParaLog}`);
        /*
         * Traduz em vez de deixar subir. `ErroGraph` não é `HttpException`, e o
         * filtro global converte tudo que não é HTTP em 500 "algo deu errado do
         * nosso lado" — o que é **falso** e manda a pessoa errada investigar.
         *
         * Aqui a falha é quase sempre do outro lado da linha: token inválido ou
         * vencido, ou identificador de WABA que não existe. Quem está na frente
         * da tela consegue consertar isso em dez segundos, desde que a mensagem
         * diga o que é. A frase traduzida do catálogo já diz.
         */
        throw new BadRequestException(
          `Não conseguimos ler esta conta de WhatsApp na Meta. ${erro.mensagemParaUsuario}`,
        );
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
      expiraEm,
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

    /*
     * 5. Descobrir o número.
     *
     * No fluxo de coexistência o payload do Embedded Signup **pode vir sem o
     * phone_number_id** — a Meta documenta isso. Quando faltar, perguntamos à
     * WABA qual número ela tem. Abortar aqui deixaria o cliente com a conta
     * conectada e sem número, que é o pior estado possível: parece que deu
     * certo e nada funciona.
     */
    const idDoNumero = phoneNumberId || (await this.descobrirNumero(wabaId, token));
    if (!idDoNumero) {
      pendencias.push(
        'A Meta não informou qual número foi conectado. Abra esta tela de novo em alguns minutos — ' +
          'se continuar assim, refaça a conexão.',
      );
    }

    const numero = idDoNumero
      ? await this.gravarNumero(contaId, registro.id, wabaId, idDoNumero, token, coexistencia)
      : null;

    let registrado = false;

    if (numero && coexistencia) {
      /*
       * Coexistência: o número JÁ está registrado, pelo app do celular.
       * Chamar /register aqui dá erro. Em vez disso, o que a Meta exige é
       * sincronizar os dados do app — e há prazo: 24 horas, ou ela desfaz a
       * conexão e o cliente refaz tudo.
       */
      registrado = true;
      await this.iniciarSincronizacao(numero.id, idDoNumero!, token, pendencias);
    } else if (numero && jaRegistrado) {
      /*
       * Já registrado por quem trouxe o número — o caso do número de teste da
       * Meta. Chamar `/register` aqui devolve erro de PIN e deixaria a tela
       * mostrando "Registro pendente" num número que envia normalmente. Estado
       * errado é pior que estado ausente: manda o cliente resolver o que não
       * está quebrado.
       */
      registrado = true;
      await this.ctx.db
        .update(waNumero)
        .set({ status: 'registrado', registradoEm: new Date() })
        .where(eq(waNumero.id, numero.id));
    } else if (numero) {
      try {
        // PIN de 6 dígitos gerado por nós. Não guardamos: se o número já tiver
        // verificação em duas etapas, a Meta recusa com 133005 e aí o PIN precisa
        // ser o que o cliente definiu — pedimos a ele, usamos e descartamos.
        const pin = String(randomInt(100_000, 1_000_000));
        await this.graph.registrarNumero(idDoNumero!, pin, token);
        await this.ctx.db
          .update(waNumero)
          .set({ status: 'registrado', registradoEm: new Date() })
          .where(eq(waNumero.id, numero.id));
        registrado = true;
      } catch (erro) {
        const traduzido = erro instanceof ErroGraph ? erro.traduzido : null;
        const detalhe = erro instanceof ErroGraph ? erro.detalheParaLog : String(erro);
        this.log.error(`Registro do número falhou: ${detalhe}`);
        pendencias.push(
          traduzido?.explicacao ??
            'Não conseguimos concluir o registro do número. Vamos tentar de novo automaticamente.',
        );
      }
    }

    // 6. O passo que é do cliente e não dá para fazer por ele.
    pendencias.push(
      'Cadastre uma forma de pagamento no WhatsApp Manager. No modelo em que operamos, a Meta cobra as conversas direto de você — sem isso, nenhuma mensagem sai.',
    );

    await this.auditoria.registrar({
      contaId,
      // Sem usuário, o ator é o sistema: foi a distribuição que conectou, e a
      // trilha precisa dizer isso em vez de inventar um responsável.
      atorTipo: atorUsuarioId ? 'usuario' : 'sistema',
      atorUsuarioId,
      acao: 'whatsapp.conectado',
      entidade: 'wa_conta',
      entidadeId: registro.id,
      // Sem token, sem PIN. O que serve para auditar é o QUE foi conectado.
      detalhe: {
        wabaId,
        phoneNumberId: idDoNumero ?? null,
        registrado,
        coexistencia,
        // Fica na trilha porque é DECLARAÇÃO de quem conectou, não fato que
        // verificamos. Se um dia um número aparecer marcado como registrado sem
        // estar, é aqui que se descobre quem disse o quê.
        jaRegistradoDeclarado: jaRegistrado,
        nome: waba.name ?? null,
      },
    });

    return {
      wabaId,
      phoneNumberId: idDoNumero ?? '',
      telefone: numero?.telefoneE164 ?? null,
      nome: waba.name ?? null,
      registrado,
      coexistencia,
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
      expiraEm: Date | null;
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
          tokenExpiraEm: dados.expiraEm,
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
        tokenExpiraEm: dados.expiraEm,
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
    coexistencia: boolean,
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
      coexistencia,
      onboardadoEm: agora,
      // Coexistencia ja nasce registrada (foi o app do celular que registrou) e
      // com a sincronizacao pendente — que e o que tem prazo de 24h.
      ...(coexistencia ? { status: 'registrado', sincronizacao: 'pendente' } : {}),
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
        tokenExpiraEm: waConta.tokenExpiraEm,
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
        coexistencia: waNumero.coexistencia,
        sincronizacao: waNumero.sincronizacao,
        sincronizacaoEm: waNumero.sincronizacaoEm,
        onboardadoEm: waNumero.onboardadoEm,
      })
      .from(waNumero)
      .where(eq(waNumero.contaId, contaId));

    /*
     * `sincronizacao_erro` fica de fora de propósito: ele guarda o detalhe de
     * diagnóstico (http, código, trace da Meta), que serve para nós e não para
     * a tela. O que a tela precisa é do estado, e o estado já está aqui.
     */
    return {
      conectado: true as const,
      conta: c,
      numeros: numeros.map((n) => ({
        ...n,
        /*
         * Duas coisas que o front não tem como deduzir sozinho — e que, se
         * ficarem implícitas, viram chamado de suporte:
         *
         * `horasParaSincronizar` é o prazo da Meta, não nosso. Estourado, ela
         * desfaz a conexão e o cliente refaz o fluxo inteiro. Mandar a data
         * crua obrigaria a tela a conhecer a regra das 24 horas.
         *
         * `vazaoMaxima` é o teto de mensagens por segundo. É o que explica ao
         * cliente por que a mesma campanha leva mais tempo num caso que no
         * outro — sem isso, "está lento" vira suspeita de defeito.
         */
        horasParaSincronizar: horasParaSincronizar(n.sincronizacao, n.onboardadoEm),
        vazaoMaxima: n.coexistencia ? VAZAO_COEXISTENCIA : VAZAO_DEDICADA,
      })),
    };
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

  /**
   * Descobre o número quando o Embedded Signup não o informa.
   *
   * Acontece no fluxo de coexistência, e a Meta documenta que pode acontecer.
   * Sem este caminho, o cliente terminaria com a conta conectada e nenhum
   * número associado — o pior estado possível, porque parece que deu certo e
   * nada funciona.
   */
  private async descobrirNumero(wabaId: string, token: string): Promise<string> {
    try {
      const r = await this.graph.numerosDaWaba(wabaId, token);
      const primeiro = r.data?.[0];
      if (primeiro?.id) {
        this.log.log(`Número descoberto pela WABA ${wabaId} (o signup não o enviou).`);
        return primeiro.id;
      }
    } catch (erro) {
      const detalhe = erro instanceof ErroGraph ? erro.detalheParaLog : String(erro);
      this.log.error(`Não consegui descobrir o número da WABA ${wabaId}: ${detalhe}`);
    }
    return '';
  }

  /**
   * Retoma uma sincronização de coexistência que nunca chegou a começar.
   *
   * Existe porque há uma janela real entre gravar o número — que já nasce com
   * `sincronizacao = 'pendente'` — e pedir a sincronização à Meta. Se o
   * processo cair nesse intervalo, o número fica parado em "pendente" e o
   * prazo de 24 horas corre em silêncio até a Meta desfazer a conexão. Quem
   * descobriria seria o cliente, do pior jeito possível.
   *
   * Repare no vai-e-vem de transações: pega o token numa transação curta, SAI
   * dela para falar com a Meta e só então volta para gravar. Segurar transação
   * aberta enquanto se espera a rede é o que faz um job de fundo prender
   * conexão do pool por trinta segundos e atrapalhar quem está atendendo
   * request de gente.
   */
  async retomarSincronizacao(
    contaId: string,
    numeroId: string,
    phoneNumberId: string,
  ): Promise<'sincronizando' | 'falhou' | 'sem_token'> {
    const credencial = await this.ctx.comConta(contaId, () => this.tokenDaConta(contaId));
    if (!credencial) {
      this.log.warn(`Conta ${contaId} sem token do WhatsApp: não dá para retomar a sincronização.`);
      return 'sem_token';
    }

    try {
      await this.graph.sincronizarDadosDoApp(
        phoneNumberId,
        'smb_app_state_sync',
        credencial.token,
      );
      await this.graph.sincronizarDadosDoApp(phoneNumberId, 'history', credencial.token);
    } catch (erro) {
      const detalhe = erro instanceof ErroGraph ? erro.detalheParaLog : String(erro);
      this.log.error(`Retomada da sincronização falhou: ${detalhe}`);
      await this.ctx.comConta(contaId, (db) =>
        db
          .update(waNumero)
          .set({ sincronizacao: 'falhou', sincronizacaoErro: detalhe.slice(0, 500) })
          .where(eq(waNumero.id, numeroId)),
      );
      return 'falhou';
    }

    await this.ctx.comConta(contaId, (db) =>
      db
        .update(waNumero)
        .set({
          sincronizacao: 'sincronizando',
          sincronizacaoEm: new Date(),
          sincronizacaoErro: null,
        })
        .where(eq(waNumero.id, numeroId)),
    );
    return 'sincronizando';
  }

  /**
   * Pede a sincronização dos dados do app do celular (coexistência).
   *
   * Duas chamadas, nesta ordem: contatos e depois histórico. Elas apenas
   * ENFILEIRAM o pedido — o conteúdo chega pelos webhooks, em fases. Tratar o
   * 200 daqui como "sincronizado" seria o mesmo erro de achar que "a Meta
   * aceitou" significa "a mensagem chegou".
   *
   * O prazo é de 24 horas a partir do fim do onboarding. Estourado, a Meta
   * desfaz a conexão e o cliente refaz tudo — por isso o estado fica gravado, e
   * não apenas registrado no log.
   */
  private async iniciarSincronizacao(
    numeroId: string,
    phoneNumberId: string,
    token: string,
    pendencias: string[],
  ): Promise<void> {
    try {
      await this.graph.sincronizarDadosDoApp(phoneNumberId, 'smb_app_state_sync', token);
      await this.graph.sincronizarDadosDoApp(phoneNumberId, 'history', token);

      await this.ctx.db
        .update(waNumero)
        .set({
          sincronizacao: 'sincronizando',
          sincronizacaoEm: new Date(),
          sincronizacaoErro: null,
        })
        .where(eq(waNumero.id, numeroId));

      pendencias.push(
        'Mantenha o WhatsApp Business aberto no celular pelos próximos minutos: estamos copiando ' +
          'seus contatos e conversas. Se fechar antes de terminar, será preciso refazer a conexão.',
      );
    } catch (erro) {
      const traduzido = erro instanceof ErroGraph ? erro.traduzido : null;
      const detalhe = erro instanceof ErroGraph ? erro.detalheParaLog : String(erro);
      this.log.error(`Sincronização da coexistência falhou: ${detalhe}`);

      await this.ctx.db
        .update(waNumero)
        .set({ sincronizacao: 'falhou', sincronizacaoErro: detalhe.slice(0, 500) })
        .where(eq(waNumero.id, numeroId));

      pendencias.push(
        traduzido?.explicacao ??
          'Não conseguimos copiar os dados do seu WhatsApp Business. Vamos tentar de novo automaticamente.',
      );
    }
  }
}
