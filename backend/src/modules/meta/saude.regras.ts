/**
 * A saúde da conta: "posso enviar agora e, se não, o que eu resolvo?".
 *
 * A Meta responde isso no campo `health_status` da conta do WhatsApp e do
 * número: um veredito (AVAILABLE, LIMITED, BLOCKED) e a lista do que está por
 * trás dele — a conta, a empresa, o aplicativo, o número —, cada item com o
 * próprio estado, o erro e a solução que ela sugere. O Regemcast não lia: no
 * teste do dono (01/10/2026) a conta estava sem pagamento configurado, e isso
 * só apareceu depois do disparo, na recusa de cada mensagem (131042).
 *
 * Aqui ficam as regras puras: ler o que a Meta devolve sem confiar no formato,
 * e montar o que a tela mostra — o mesmo bloco dos erros de envio (o que houve,
 * o que fazer, quem resolve e por onde), com a frase da Meta sempre à parte.
 *
 * O que a primeira leitura real ensinou (02/10/2026, conta em coexistência):
 *
 * - o `health_status` é de MENSAGENS E CHAMADAS. O número veio LIMITED com um
 *   erro de chamadas de voz (138024, SIP não habilitado) — que não diz nada
 *   sobre o envio de mensagens e não pode ir para a tela como "o motivo";
 * - o motivo de verdade veio em `additional_info`, sem código: o nome de
 *   exibição ainda não aprovado. `additional_info` é lido SEMPRE, não só
 *   quando faltam erros;
 * - um item disponível pode trazer erros (o aplicativo, com 138025): só o
 *   estado decide se há problema.
 *
 * Dois sinais são NOSSOS, e não da Meta, e por isso nunca passam de "atenção":
 *
 * - **Pagamento.** A Meta cobra as mensagens direto da conta do WhatsApp. Sem
 *   moeda ou sem forma de pagamento ela aceita a mensagem e recusa em seguida.
 *   Lemos a moeda, o fuso e a forma de pagamento da conta; se o `health_status`
 *   também acusa isso, só o uso mostra — então o que falta vira aviso, e quem
 *   bloqueia o disparo é só o veredito dela.
 * - **Conexão.** A autorização do cliente vence (60 dias no Embedded Signup).
 */
import { linkNaMensagemDaMeta, limparMensagemDaMeta, type ErroParaTela } from './erros-meta';
import { ROTULO_DO_PAGAMENTO_NA_META } from './pagamento';

/** O veredito da Meta, com o nosso nome. */
export type EstadoDeEnvio = 'disponivel' | 'limitado' | 'bloqueado';

export type TipoDeEntidade = 'conta' | 'empresa' | 'aplicativo' | 'numero' | 'modelo' | 'outro';

export interface ErroDaSaude {
  codigo: number | null;
  descricao: string;
  solucao: string;
}

export interface EntidadeDaSaude {
  tipo: TipoDeEntidade;
  id: string | null;
  estado: EstadoDeEnvio;
  erros: ErroDaSaude[];
  /** O que a Meta acrescenta sem ser erro (o motivo de uma restrição, por exemplo). */
  info: string[];
}

export interface SaudeLida {
  estado: EstadoDeEnvio;
  entidades: EntidadeDaSaude[];
}

const ESTADOS: Record<string, EstadoDeEnvio> = { AVAILABLE: 'disponivel', LIMITED: 'limitado', BLOCKED: 'bloqueado' };
const TIPOS: Record<string, TipoDeEntidade> = {
  WABA: 'conta',
  BUSINESS: 'empresa',
  APP: 'aplicativo',
  PHONE_NUMBER: 'numero',
  MESSAGE_TEMPLATE: 'modelo',
};
const PESO: Record<EstadoDeEnvio, number> = { disponivel: 0, limitado: 1, bloqueado: 2 };

const texto = (v: unknown): string => (typeof v === 'string' ? limparMensagemDaMeta(v) : '');
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** O pior de dois estados. */
export function pior(a: EstadoDeEnvio, b: EstadoDeEnvio): EstadoDeEnvio {
  return PESO[b] > PESO[a] ? b : a;
}

/**
 * Lê o `health_status` que a Meta devolve.
 *
 * Nulo quando não há veredito reconhecível — aí nada é gravado: "não sei" não
 * pode virar "pode enviar". Estado desconhecido numa entidade conta como
 * restrição: se a Meta inventar um valor, a tela mostra o item em vez de
 * escondê-lo como saudável.
 */
export function lerSaude(bruto: unknown): SaudeLida | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const o = bruto as Record<string, unknown>;
  const geral = ESTADOS[String(o.can_send_message ?? '').toUpperCase()];
  if (!geral) return null;

  const entidades: EntidadeDaSaude[] = lista(o.entities).flatMap((e) => {
    if (!e || typeof e !== 'object') return [];
    const ent = e as Record<string, unknown>;
    return [
      {
        tipo: TIPOS[String(ent.entity_type ?? '').toUpperCase()] ?? 'outro',
        id: ent.id == null ? null : String(ent.id),
        estado: ESTADOS[String(ent.can_send_message ?? '').toUpperCase()] ?? 'limitado',
        erros: lista(ent.errors).flatMap((x) => {
          if (!x || typeof x !== 'object') return [];
          const erro = x as Record<string, unknown>;
          const codigo = Number(erro.error_code);
          return [
            {
              codigo: Number.isFinite(codigo) ? codigo : null,
              descricao: texto(erro.error_description),
              solucao: texto(erro.possible_solution),
            },
          ];
        }),
        info: lista(ent.additional_info).map(texto).filter(Boolean),
      },
    ];
  });

  return { estado: geral, entidades };
}

/** Os campos da cobrança que pedimos à Meta, com o nome dela. */
export const CAMPOS_DA_COBRANCA = ['currency', 'timezone_id', 'primary_funding_id', 'business_verification_status'] as const;
export type CampoDaCobranca = (typeof CAMPOS_DA_COBRANCA)[number];

/** Um campo da cobrança que a Meta não deixou ler, e com que código. */
export interface CampoRecusado {
  campo: CampoDaCobranca;
  codigo: number | null;
}

export interface SaudeGuardada {
  entidades: EntidadeDaSaude[];
  /** Os campos da cobrança que a Meta deixou ler na última leitura. */
  cobrancaLidos: CampoDaCobranca[];
  /** Os que ela recusou, e quando — para não insistir a cada 30 minutos. */
  cobrancaRecusada: CampoRecusado[];
  cobrancaRecusadaEm: Date | null;
  ultimaFalha: FalhaDaLeitura | null;
}

/** A saúde guardada (jsonb), de volta ao tipo — ou nulo, se o que está lá não serve. */
export function saudeGuardada(json: unknown): SaudeGuardada | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  if (!Array.isArray(o.entidades)) return null;

  const campo = (v: unknown): v is CampoDaCobranca => (CAMPOS_DA_COBRANCA as readonly unknown[]).includes(v);
  const data = (v: unknown): Date | null => {
    const d = typeof v === 'string' ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  };
  // Leitura gravada antes de 02/10/2026: `cobrancaLida: true` valia para os quatro campos.
  const lidos = Array.isArray(o.cobrancaLidos) ? o.cobrancaLidos.filter(campo) : o.cobrancaLida === true ? [...CAMPOS_DA_COBRANCA] : [];
  const recusada = (Array.isArray(o.cobrancaRecusada) ? o.cobrancaRecusada : []).flatMap((r) => {
    if (!r || typeof r !== 'object') return [];
    const x = r as { campo?: unknown; codigo?: unknown };
    return campo(x.campo) ? [{ campo: x.campo, codigo: typeof x.codigo === 'number' ? x.codigo : null }] : [];
  });
  const falhaBruta = o.ultimaFalha && typeof o.ultimaFalha === 'object' ? (o.ultimaFalha as { codigo?: unknown; em?: unknown }) : null;
  const falhaEm = data(falhaBruta?.em);

  return {
    entidades: o.entidades as EntidadeDaSaude[],
    cobrancaLidos: lidos,
    cobrancaRecusada: recusada,
    cobrancaRecusadaEm: data(o.cobrancaRecusadaEm),
    ultimaFalha: falhaEm ? { codigo: typeof falhaBruta?.codigo === 'number' ? falhaBruta.codigo : null, em: falhaEm } : null,
  };
}

// ------------------------------------------------------------------ para a tela

/** O sinal de três estados da tela — mais "ainda não conferimos". */
export type Sinal = 'pode_enviar' | 'com_restricao' | 'bloqueado' | 'desconhecido';

const SINAL: Record<EstadoDeEnvio, Exclude<Sinal, 'desconhecido'>> = {
  disponivel: 'pode_enviar',
  limitado: 'com_restricao',
  bloqueado: 'bloqueado',
};
const PESO_DO_SINAL: Record<Sinal, number> = { pode_enviar: 0, desconhecido: 0, com_restricao: 1, bloqueado: 2 };

export interface ItemDaSaude {
  /** `conta`, `empresa`, `aplicativo`, `numero:<phone_number_id>`, `pagamento` ou `conexao`. */
  chave: string;
  rotulo: string;
  sinal: Sinal;
  /** Uma linha: o estado dito em português. */
  resumo: string;
  /** O que impede ou limita, cada um com o que fazer. Vazio quando está tudo certo. */
  problemas: ErroParaTela[];
}

export interface SaudeParaTela {
  sinal: Sinal;
  titulo: string;
  resumo: string;
  /** Quando a Meta foi consultada. Nulo = nunca. */
  lidaEm: Date | null;
  itens: ItemDaSaude[];
}

const NOME: Record<TipoDeEntidade, { rotulo: string; de: string }> = {
  conta: { rotulo: 'Conta do WhatsApp', de: 'da conta do WhatsApp' },
  empresa: { rotulo: 'Empresa na Meta', de: 'da empresa dona da conta, na Meta' },
  aplicativo: { rotulo: 'Aplicativo Regemcast', de: 'do aplicativo do Regemcast na Meta' },
  numero: { rotulo: 'Número', de: 'do número' },
  modelo: { rotulo: 'Modelo', de: 'do modelo' },
  outro: { rotulo: 'Outro item da Meta', de: 'de um item que a Meta aponta' },
};

/**
 * Erro de CHAMADAS de voz (a faixa 138000 da Calling API, ou a frase falando de
 * chamadas ou de SIP). O `health_status` cobre mensagens e chamadas; este
 * produto só envia mensagens.
 */
export function ehDeChamadas(erro: ErroDaSaude): boolean {
  if (erro.codigo !== null && erro.codigo >= 138_000 && erro.codigo <= 138_999) return true;
  return /\b(calling|calls?|sip)\b/i.test(`${erro.descricao} ${erro.solucao}`);
}

/**
 * O que a Meta diz em `additional_info` e nós sabemos explicar. A frase dela
 * continua à parte, em "O que a Meta respondeu".
 */
const INFORMACOES_CONHECIDAS: Array<{ casa: RegExp; titulo: string; explicacao: string; acao: string }> = [
  {
    casa: /display name.*not.*approved/i,
    titulo: 'O nome de exibição do número ainda não foi aprovado',
    explicacao:
      'Enquanto a Meta não aprova o nome de exibição, o número envia com um limite menor de mensagens. O limite aumenta quando o nome for aprovado.',
    acao: 'Confira o nome de exibição do número no Gerenciador do WhatsApp, na Meta. Se ele foi recusado, ajuste e envie de novo.',
  },
];

/** A informação da Meta que sabemos explicar, como a tela mostra. Nulo = não conhecemos a frase. */
function problemaDaInformacao(info: string[]): ErroParaTela | null {
  const frase = info.join(' ');
  const conhecida = INFORMACOES_CONHECIDAS.find((c) => c.casa.test(frase));
  if (!conhecida) return null;
  const url = linkNaMensagemDaMeta(frase);
  return {
    codigo: null,
    titulo: conhecida.titulo,
    explicacao: conhecida.explicacao,
    acao: conhecida.acao,
    quem: 'voce',
    tela: null,
    link: url ? { rotulo: 'Abrir na Meta', url } : null,
    daMeta: frase,
  };
}

/**
 * Um erro do `health_status` como a tela mostra.
 *
 * A Meta não publica a lista dos códigos da saúde — só exemplos. Por isso o
 * título e a explicação saem do QUE está com problema e do QUANTO (limita ou
 * bloqueia), que são certos; a descrição e a solução dela vão em "O que a Meta
 * respondeu", sem virar a nossa frase.
 */
export function problemaDaSaude(entidade: Pick<EntidadeDaSaude, 'tipo' | 'estado'>, erro: ErroDaSaude | null, info: string[] = []): ErroParaTela {
  const nome = NOME[entidade.tipo];
  const bloqueia = entidade.estado === 'bloqueado';
  const doAplicativo = entidade.tipo === 'aplicativo';
  // A informação solta acompanha o erro: é contexto do mesmo problema.
  const daMeta = [erro?.descricao, erro?.solucao, ...info].filter(Boolean).join(' ');
  const url = linkNaMensagemDaMeta(daMeta);
  const codigo = erro?.codigo ?? null;

  return {
    codigo,
    titulo: bloqueia ? `A Meta bloqueou o envio por um problema ${nome.de}` : `A Meta limitou o envio por um problema ${nome.de}`,
    explicacao: bloqueia
      ? 'Enquanto isso não for resolvido, a Meta recusa as mensagens desta conta.'
      : 'As mensagens saem, mas com restrição — a Meta pode segurar parte delas ou reduzir o volume.',
    acao: doAplicativo
      ? `Fale com o suporte${codigo ? ` informando o código ${codigo}` : ''}: é conosco.`
      : daMeta
        ? `A Meta diz o que ela pede em "O que a Meta respondeu", logo abaixo. Resolvido lá, confira de novo aqui.${codigo ? ` Se precisar de ajuda, informe o código ${codigo} ao suporte.` : ''}`
        : 'Veja o motivo no Gerenciador do WhatsApp, na Meta. Resolvido lá, confira de novo aqui.',
    quem: doAplicativo ? 'nos' : 'voce',
    tela: null,
    link: url ? { rotulo: 'Abrir na Meta', url } : null,
    daMeta: daMeta || null,
  };
}

function itemDaEntidade(e: EntidadeDaSaude, chave: string, rotulo: string): ItemDaSaude {
  const sinal = SINAL[e.estado];
  // Só o estado decide se há problema (item disponível também traz erros), e
  // erro de chamadas de voz não é motivo de nada aqui.
  const erros = e.erros.filter((erro) => !ehDeChamadas(erro));
  const conhecida = problemaDaInformacao(e.info);
  const problemas =
    e.estado === 'disponivel'
      ? []
      : erros.length
        ? erros.map((erro, i) => problemaDaSaude(e, erro, i === 0 ? e.info : []))
        : [conhecida ?? problemaDaSaude(e, null, e.info)];
  return {
    chave,
    rotulo,
    sinal,
    resumo:
      sinal === 'pode_enviar' ? 'Pode enviar.' : sinal === 'com_restricao' ? 'Envia com restrição.' : 'Bloqueado para enviar.',
    problemas,
  };
}

export interface DadosDaSaude {
  /** A leitura da conta na Meta. Nulo = ainda não lida. */
  conta: { estado: EstadoDeEnvio; entidades: EntidadeDaSaude[]; lidaEm: Date } | null;
  numeros: Array<{
    phoneNumberId: string;
    telefone: string | null;
    saude: { estado: EstadoDeEnvio; entidades: EntidadeDaSaude[] } | null;
  }>;
  /**
   * A cobrança da conta na Meta. `moedaLida` e `pagamentoLido` dizem se a Meta
   * deixou ler cada campo: campo recusado não é "vazio", é "não sei" — e sobre
   * o que não sabemos nada é afirmado.
   */
  cobranca: {
    moedaLida: boolean;
    pagamentoLido: boolean;
    moeda: string | null;
    fuso: string | null;
    pagamentoId: string | null;
    url: string | null;
  };
  /** Quando a autorização do cliente vence. Nulo = a Meta não informou prazo. */
  tokenExpiraEm: Date | null;
  /**
   * A última conferência que falhou, quando é mais nova que a última leitura
   * boa. É o que separa "ainda não conferimos" de "a Meta recusou".
   */
  falha?: FalhaDaLeitura | null;
  agora: Date;
}

/** Por que a última conferência com a Meta não deu certo. Sem a frase dela: só o código. */
export interface FalhaDaLeitura {
  codigo: number | null;
  em: Date;
}

/** O código com que a Meta diz que a autorização da conta venceu ou foi retirada. */
const TOKEN_INVALIDO = 190;

/**
 * O que fazer quando a conexão caiu ou vai vencer. Não promete um botão: com a
 * conta já conectada, a tela do WhatsApp ainda não oferece "reconectar"
 * (02/10/2026) — a frase diz o que é preciso e a quem recorrer.
 */
const COMO_RECONECTAR = 'É preciso refazer a conexão desta conta com a Meta. Se a tela do WhatsApp não mostrar como, fale com o suporte do Regemcast.';

/** Com quantos dias de antecedência a conexão que vence vira aviso. */
export const DIAS_DO_AVISO_DE_CONEXAO = 7;

function itemDoPagamento(c: DadosDaSaude['cobranca']): ItemDaSaude | null {
  if (!c.moedaLida && !c.pagamentoLido) return null;
  const link = c.url ? { rotulo: ROTULO_DO_PAGAMENTO_NA_META, url: c.url } : null;
  // "Falta" só o que foi lido e veio vazio. Campo que a Meta não deixou ler não falta: não sabemos.
  const faltaMoeda = c.moedaLida && !c.moeda;
  const faltaForma = c.pagamentoLido && !c.pagamentoId;
  if (!faltaMoeda && !faltaForma) {
    return {
      chave: 'pagamento',
      rotulo: 'Pagamento na Meta',
      sinal: 'pode_enviar',
      // O fuso que a Meta devolve é um número dela (`timezone_id`): fica guardado, não vai para a tela.
      resumo:
        c.moeda && c.pagamentoId
          ? `Cobrança em ${c.moeda}, com forma de pagamento cadastrada.`
          : c.moeda
            ? `Cobrança em ${c.moeda}.`
            : 'Forma de pagamento cadastrada.',
      problemas: [],
    };
  }
  const oQueFalta = faltaMoeda && faltaForma ? 'a moeda e a forma de pagamento' : faltaMoeda ? 'a moeda' : 'a forma de pagamento';
  return {
    chave: 'pagamento',
    rotulo: 'Pagamento na Meta',
    sinal: 'com_restricao',
    resumo: `A Meta não informa ${oQueFalta} desta conta.`,
    problemas: [
      {
        codigo: null,
        titulo: 'Confira o pagamento da conta na Meta',
        explicacao: `A Meta cobra as mensagens direto da conta do WhatsApp, e não informa ${oQueFalta} desta conta. Sem o pagamento em ordem, ela aceita a mensagem e recusa em seguida.`,
        acao: 'Abra o pagamento da conta na Meta e confira a moeda, o fuso horário e o cartão antes de disparar.',
        quem: 'voce',
        tela: null,
        link,
        daMeta: null,
      },
    ],
  };
}

function itemDaConexao(expiraEm: Date | null, agora: Date, falha: FalhaDaLeitura | null): ItemDaSaude {
  const base = { chave: 'conexao', rotulo: 'Conexão com o Regemcast' };
  // Só o 190 é inequívoco: outro código pode ser um campo que a Meta não deixa
  // ler com esta autorização, e a conta envia normalmente.
  if (falha?.codigo === TOKEN_INVALIDO) {
    return {
      ...base,
      sinal: 'bloqueado',
      resumo: 'A Meta recusou a autorização desta conta.',
      problemas: [
        {
          codigo: TOKEN_INVALIDO,
          titulo: 'A conexão com a Meta caiu',
          explicacao:
            'A Meta recusou a autorização que o Regemcast tem desta conta: ela venceu ou foi retirada. Nenhuma mensagem sai até reconectar.',
          acao: COMO_RECONECTAR,
          quem: 'voce',
          tela: 'whatsapp',
          link: null,
          daMeta: null,
        },
      ],
    };
  }
  if (!expiraEm) return { ...base, sinal: 'pode_enviar', resumo: 'Autorização em dia, sem prazo informado pela Meta.', problemas: [] };

  const dias = Math.ceil((expiraEm.getTime() - agora.getTime()) / 86_400_000);
  if (dias > DIAS_DO_AVISO_DE_CONEXAO) {
    return { ...base, sinal: 'pode_enviar', resumo: `Autorização em dia: vence em ${dias} dias.`, problemas: [] };
  }
  const venceu = dias <= 0;
  return {
    ...base,
    sinal: venceu ? 'bloqueado' : 'com_restricao',
    resumo: venceu ? 'A autorização venceu.' : `A autorização vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}.`,
    problemas: [
      {
        codigo: null,
        titulo: venceu ? 'A autorização da conta venceu' : 'A autorização da conta está para vencer',
        explicacao: venceu
          ? 'A autorização que você deu ao Regemcast venceu, e a Meta recusa qualquer envio com ela.'
          : 'A autorização que você deu ao Regemcast tem prazo. Quando vencer, a Meta passa a recusar os envios.',
        acao: COMO_RECONECTAR,
        quem: 'voce',
        tela: 'whatsapp',
        link: null,
        daMeta: null,
      },
    ],
  };
}

const TITULO: Record<Sinal, string> = {
  pode_enviar: 'Pode enviar',
  com_restricao: 'Envia com restrição',
  bloqueado: 'Não pode enviar agora',
  desconhecido: 'Ainda não conferimos com a Meta',
};

/**
 * Monta a saúde da conta para a tela: um sinal geral (o pior dos itens) e a
 * lista, do que mais pede atenção para o que está certo.
 */
export function saudeParaTela(d: DadosDaSaude): SaudeParaTela {
  const itens: ItemDaSaude[] = [];
  const vistos = new Set<string>();

  // Da leitura da conta: a conta, a empresa e o aplicativo.
  for (const e of d.conta?.entidades ?? []) {
    if (e.tipo === 'numero' || e.tipo === 'modelo') continue;
    const chave = e.tipo === 'outro' ? `outro:${e.id ?? itens.length}` : e.tipo;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    itens.push(itemDaEntidade(e, chave, NOME[e.tipo].rotulo));
  }

  // De cada número: só o item do próprio número (conta, empresa e aplicativo já vieram).
  for (const n of d.numeros) {
    const doNumero = n.saude?.entidades.find((e) => e.tipo === 'numero');
    if (!doNumero) continue;
    itens.push(itemDaEntidade(doNumero, `numero:${n.phoneNumberId}`, n.telefone ? `Número ${n.telefone}` : 'Número'));
  }

  const pagamento = itemDoPagamento(d.cobranca);
  if (pagamento) itens.push(pagamento);
  // A falha só conta quando é mais nova que a última leitura boa.
  const falha = d.falha && (!d.conta || d.falha.em > d.conta.lidaEm) ? d.falha : null;
  itens.push(itemDaConexao(d.tokenExpiraEm, d.agora, falha));

  const lida = d.conta !== null;
  let sinal: Sinal = lida ? SINAL[d.conta!.estado] : 'desconhecido';
  for (const i of itens) if (PESO_DO_SINAL[i.sinal] > PESO_DO_SINAL[sinal]) sinal = i.sinal;

  itens.sort((a, b) => PESO_DO_SINAL[b.sinal] - PESO_DO_SINAL[a.sinal]);
  const comProblema = itens.filter((i) => i.sinal === 'bloqueado' || i.sinal === 'com_restricao').length;

  return {
    sinal,
    titulo: TITULO[sinal],
    resumo:
      sinal === 'desconhecido'
        ? falha
          ? `A Meta não respondeu à última conferência${falha.codigo ? ` (código ${falha.codigo})` : ''}. O Regemcast tenta de novo a cada 30 minutos; se continuar, fale com o suporte.`
          : 'A Meta ainda não respondeu sobre a situação desta conta. Confira de novo em instantes.'
        : sinal === 'pode_enviar'
          ? 'A Meta não aponta nada que impeça o envio.'
          : sinal === 'bloqueado'
            ? `${comProblema === 1 ? 'Há 1 ponto' : `Há ${comProblema} pontos`} a resolver — veja abaixo o que fazer em cada um.`
            : `${comProblema === 1 ? 'Há 1 ponto' : `Há ${comProblema} pontos`} de atenção — o envio sai, mas vale resolver.`,
    lidaEm: d.conta?.lidaEm ?? null,
    itens,
  };
}

/**
 * O que barra o disparo: SÓ o veredito da Meta (conta ou número bloqueado) e a
 * autorização vencida. Os avisos nossos (pagamento a conferir, conexão para
 * vencer) aparecem na tela e não seguram nada.
 */
export function oQueImpedeOEnvio(saude: SaudeParaTela): ErroParaTela | null {
  for (const item of saude.itens) {
    if (item.sinal !== 'bloqueado' || item.chave === 'pagamento') continue;
    return item.problemas[0] ?? null;
  }
  return null;
}
