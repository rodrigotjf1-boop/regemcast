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
import { DECLARACAO_INTEGRACAO } from './agenda.regras';
import { AgendaService } from './agenda.service';
import { cifrarToken, decifrarToken } from './cripto';
import { exigenciasDoEnvio, type ExigenciasDoEnvio } from './envio.regras';
import { linkDoPagamentoNaMeta } from './pagamento';
import { ErroGraph, GraphService, type ModeloBruto } from './graph.service';
import { limiteInformado, type LimiteDaMeta } from './limite.regras';
import { motivoDoModelo } from './motivos-modelo';

export interface DadosDoSignup {
  code: string;
  wabaId: string;
  /**
   * No fluxo de coexistência a Meta pode **não** enviar este campo — está
   * documentado. Por isso é opcional aqui, e descoberto consultando a WABA
   * quando faltar.
   */
  phoneNumberId?: string;
  /** O portfólio de negócios do cliente, quando o Embedded Signup o devolve. */
  businessId?: string;
  /** true quando o cliente escolheu manter o WhatsApp Business no celular. */
  coexistencia?: boolean;
  /**
   * Coexistência: trazer os contatos e as conversas? Ausente = sem resposta
   * (o cartão do número pergunta depois), nunca "não".
   */
  integrar?: boolean;
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
  /** Resposta da tela de conexão sobre contatos e conversas. `null` = não respondeu. */
  integrar: boolean | null;
  /** O portfólio de negócios do cliente, quando o Embedded Signup o devolveu. */
  businessId?: string | null;
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
  /** A resposta gravada sobre contatos e conversas. `null` = sem resposta ou número dedicado. */
  integrarConversas: boolean | null;
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

/** Modelo de mensagem, já em português e sem o ruído da Graph. */
export interface ModeloDeMensagem {
  id: string;
  nome: string;
  idioma: string;
  categoria: string;
  status: string;
  /** Por que a Meta recusou. `null` quando não recusou ou não explicou. */
  motivo: string | null;
  cabecalho: string | null;
  corpo: string;
  rodape: string | null;
  /**
   * Quantas variáveis o corpo espera.
   *
   * É o MAIOR índice usado, não quantas vezes aparecem. `{{1}}` repetido três
   * vezes continua sendo uma variável — contar ocorrências faz o disparo mandar
   * três valores e a Meta recusar com 132000. Esse defeito existe no Regem.
   */
  variaveis: number;
  botoes: string[];
  /**
   * O que o modelo pede no envio além das variáveis do corpo: mídia ou
   * variável no cabeçalho, oferta com validade, cupom, cartões
   * (`envio.regras.ts`). É por aqui que a campanha sabe o que resolver, e que
   * a tela sabe se mostra o campo da variável do título.
   */
  exige: ExigenciasDoEnvio;
}

/** O único status com que a Meta deixa um modelo ser disparado. */
export const MODELO_APROVADO = 'aprovado';

const STATUS_MODELO: Record<string, string> = {
  APPROVED: MODELO_APROVADO,
  PENDING: 'em análise',
  IN_APPEAL: 'em recurso',
  REJECTED: 'recusado',
  PAUSED: 'pausado',
  DISABLED: 'desativado',
  PENDING_DELETION: 'sendo excluído',
};

const CATEGORIA_MODELO: Record<string, string> = {
  MARKETING: 'marketing',
  UTILITY: 'utilidade',
  AUTHENTICATION: 'autenticação',
};

/**
 * Traduz o modelo cru da Meta.
 *
 * Nome desconhecido devolve o próprio valor em minúsculas, e não 'desconhecido':
 * quando a Meta inventar um status novo, a tela mostra o nome dele — feio, mas
 * verdadeiro — em vez de esconder a informação atrás de uma palavra genérica.
 */
function traduzirModelo(m: ModeloBruto): ModeloDeMensagem {
  const componentes = m.components ?? [];
  const achar = (tipo: string) => componentes.find((c) => c.type?.toUpperCase() === tipo);

  const cabecalho = achar('HEADER');
  const corpo = achar('BODY');
  const rodape = achar('FOOTER');
  const botoes = achar('BUTTONS');

  const texto = typeof corpo?.text === 'string' ? corpo.text : '';

  return {
    id: m.id,
    nome: m.name,
    idioma: m.language ?? '—',
    categoria: traduzirOuMostrarCru(CATEGORIA_MODELO, m.category),
    status: traduzirOuMostrarCru(STATUS_MODELO, m.status),
    motivo: motivoDoModelo(m.rejected_reason),
    // Cabeçalho de imagem/vídeo não tem texto: dizemos o formato, que é o que
    // a pessoa precisa saber para montar o disparo.
    cabecalho:
      typeof cabecalho?.text === 'string'
        ? cabecalho.text
        : cabecalho
          ? `(${(cabecalho.format ?? 'mídia').toLowerCase()})`
          : null,
    corpo: texto,
    rodape: typeof rodape?.text === 'string' ? rodape.text : null,
    variaveis: maiorIndiceDeVariavel(texto),
    botoes: rotulosDosBotoes(botoes?.buttons),
    exige: exigenciasDoEnvio(componentes),
  };
}

/**
 * Traduz pelo dicionário; sem entrada, devolve o valor cru em minúsculas.
 *
 * Nunca devolve "desconhecido": quando a Meta inventar um status novo, é melhor
 * a tela mostrar o nome dele — feio, mas verdadeiro — do que esconder a
 * informação atrás de uma palavra genérica que não ajuda ninguém a agir.
 */
function traduzirOuMostrarCru(dicionario: Record<string, string>, valor: string | undefined): string {
  const bruto = (valor ?? '').trim();
  if (!bruto) return '—';
  return dicionario[bruto] ?? bruto.toLowerCase();
}

/** O maior `{{n}}` do texto. Zero quando não há variável. */
function maiorIndiceDeVariavel(texto: string): number {
  let maior = 0;
  for (const achado of texto.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const n = Number(achado[1]);
    if (Number.isFinite(n) && n > maior) maior = n;
  }
  return maior;
}

/** Rótulo de cada botão, ignorando o que não tiver forma reconhecível. */
function rotulosDosBotoes(botoes: unknown): string[] {
  if (!Array.isArray(botoes)) return [];
  return botoes
    .map((b) => (b && typeof b === 'object' ? (b as { text?: unknown }).text : null))
    .filter((t): t is string => typeof t === 'string' && t.length > 0);
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
    private readonly agenda: AgendaService,
  ) {}

  /**
   * O que o front precisa para abrir o Embedded Signup. Nada aqui é segredo.
   *
   * A declaração da coexistência vem daqui para a tela mostrar exatamente o
   * texto que a auditoria grava quando o dono responde "sim".
   */
  configDoSignup(): { appId: string; configId: string; graphVersao: string; declaracaoIntegracao: string } {
    if (!env.meta.appId || !env.meta.configId) {
      throw new BadRequestException(
        'A conexão com o WhatsApp ainda não está configurada no servidor. Fale com o suporte do Regemcast.',
      );
    }
    return {
      appId: env.meta.appId,
      configId: env.meta.configId,
      graphVersao: env.meta.graphVersao,
      declaracaoIntegracao: DECLARACAO_INTEGRACAO,
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
      // Só `true`/`false` explícitos contam como resposta. Ausente não é "não".
      integrar: typeof dados.integrar === 'boolean' ? dados.integrar : null,
      businessId: dados.businessId ?? null,
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
        integrar: null,
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
      // O negócio dono da conta: o que o signup devolveu, ou o que a Meta
      // disser. Sem resposta, fica para a tela do WhatsApp descobrir depois.
      businessId: p.businessId ?? (await this.graph.negocioDaWaba(wabaId, token).catch(() => null)),
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
       * A resposta sobre contatos e conversas é gravada ANTES do pedido de
       * sincronização: a agenda só começa a chegar depois desse pedido. Sem
       * resposta, o que chegar fica guardado até o dono responder no cartão.
       */
      if (p.integrar !== null) {
        await this.agenda.decidirNaConexao(this.ctx.db, numero.id, p.integrar, atorUsuarioId);
      }

      /*
       * Coexistência: o número JÁ está registrado, pelo app do celular.
       * Chamar /register aqui dá erro. Em vez disso, o que a Meta exige é
       * sincronizar os dados do app — e há prazo: 24 horas, ou ela desfaz a
       * conexão e o cliente refaz tudo. O pedido sai SEMPRE, mesmo com
       * "não": a resposta do dono decide o que guardamos, não se pedimos.
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
      integrarConversas: numero && coexistencia ? p.integrar : null,
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
      businessId: string | null;
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
          // Sem resposta nova, fica o que já estava guardado.
          ...(dados.businessId ? { businessId: dados.businessId } : {}),
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
        businessId: dados.businessId,
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
    let limite: LimiteDaMeta | undefined;

    try {
      const r = await this.graph.numerosDaWaba(wabaId, token);
      const achado = r.data?.find((n) => n.id === phoneNumberId);
      if (achado) {
        telefone = achado.display_phone_number ?? null;
        nomeExibicao = achado.verified_name ?? null;
        qualidade = QUALIDADE[achado.quality_rating ?? 'UNKNOWN'] ?? 'desconhecida';
        // O campo antigo, descontinuado — só vale se o novo não responder.
        limite = limiteInformado(achado.messaging_limit_tier);
      }
    } catch (erro) {
      const detalhe = erro instanceof ErroGraph ? erro.detalheParaLog : String(erro);
      this.log.warn(`Não consegui ler os números da WABA ${wabaId}: ${detalhe}`);
    }

    try {
      limite = limiteInformado(await this.graph.limiteDoNumero(phoneNumberId, token)) ?? limite;
    } catch (erro) {
      const detalhe = erro instanceof ErroGraph ? erro.detalheParaLog : String(erro);
      this.log.warn(`Não consegui ler o limite de envio do número ${phoneNumberId}: ${detalhe}`);
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
      // Sem limite lido, a Meta não disse — não sobrescreve o que já sabíamos.
      // `limite: null` é "sem teto", e esse sim precisa ser gravado.
      ...(limite === undefined ? {} : { tierLimite: limite.limite, tierNome: limite.nome, tierEm: agora }),
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
    const [lido] = await this.ctx.db
      .select({
        wabaId: waConta.wabaId,
        nome: waConta.nome,
        moeda: waConta.moeda,
        statusRevisao: waConta.statusRevisao,
        conectadaEm: waConta.onboardadaEm,
        webhookAssinadoEm: waConta.webhookAssinadoEm,
        tokenExpiraEm: waConta.tokenExpiraEm,
        businessId: waConta.businessId,
      })
      .from(waConta)
      .where(eq(waConta.contaId, contaId))
      .limit(1);

    if (!lido) return { conectado: false as const };

    // O negócio dono da conta fica fora da resposta: a tela só precisa do
    // endereço pronto. Conta conectada antes de guardarmos o negócio: pergunta
    // à Meta uma vez, aqui, e guarda.
    const { businessId, ...conta } = lido;
    const negocio = businessId ?? (await this.descobrirNegocio(contaId, lido.wabaId));
    const c = { ...conta, pagamentoUrl: linkDoPagamentoNaMeta(lido.wabaId, negocio) };

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
        // Coexistência: a resposta sobre contatos e conversas (null = não respondeu).
        integrarConversas: waNumero.integrarConversas,
        integrarDecididoEm: waNumero.integrarDecididoEm,
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
   * O endereço da página de pagamento da conta do WhatsApp na Meta, só com o
   * que já está guardado (sem chamar a Meta). Nulo sem conta conectada, ou
   * enquanto o negócio dono dela não for conhecido.
   */
  async pagamentoUrl(contaId: string): Promise<string | null> {
    const [c] = await this.ctx.db
      .select({ wabaId: waConta.wabaId, businessId: waConta.businessId })
      .from(waConta)
      .where(eq(waConta.contaId, contaId))
      .limit(1);
    return c ? linkDoPagamentoNaMeta(c.wabaId, c.businessId) : null;
  }

  /**
   * Pergunta à Meta qual é o negócio dono da conta e guarda. Não pode derrubar
   * a tela do WhatsApp: qualquer falha (token vencido, campo recusado, rede)
   * vira "ainda não sei", e a próxima abertura tenta de novo.
   */
  private async descobrirNegocio(contaId: string, wabaId: string): Promise<string | null> {
    try {
      const credencial = await this.tokenDaConta(contaId);
      if (!credencial) return null;
      const negocio = await this.graph.negocioDaWaba(wabaId, credencial.token);
      if (!negocio) return null;
      await this.ctx.db
        .update(waConta)
        .set({ businessId: negocio })
        .where(and(eq(waConta.contaId, contaId), eq(waConta.wabaId, wabaId)));
      return negocio;
    } catch (erro) {
      this.log.warn(
        `Não consegui ler o negócio dono da WABA ${wabaId}: ${erro instanceof ErroGraph ? erro.detalheParaLog : String(erro)}`,
      );
      return null;
    }
  }

  /**
   * Modelos de mensagem da conta.
   *
   * Lê direto da Meta em vez de manter cópia no nosso banco — de propósito. O
   * status muda do lado dela (aprovação, recusa, pausa por qualidade) sem nos
   * avisar em tempo real, e uma cópia desatualizada faria o cliente montar
   * campanha com modelo que a Meta já recusou. Quando houver cache, ele será
   * explícito e com validade curta, não silencioso.
   */
  async modelos(contaId: string): Promise<ModeloDeMensagem[]> {
    const credencial = await this.tokenDaConta(contaId);
    if (!credencial) {
      throw new BadRequestException(
        'Nenhuma conta de WhatsApp conectada. Conecte a conta para ver seus modelos.',
      );
    }

    try {
      const r = await this.graph.modelosDaWaba(credencial.wabaId, credencial.token);
      return (r.data ?? []).map(traduzirModelo);
    } catch (erro) {
      if (erro instanceof ErroGraph) {
        this.log.error(`Leitura dos modelos falhou: ${erro.detalheParaLog}`);
        throw new BadRequestException(
          `Não conseguimos carregar seus modelos. ${erro.mensagemParaUsuario}`,
        );
      }
      throw erro;
    }
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
