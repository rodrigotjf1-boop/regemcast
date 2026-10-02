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

/** A saúde guardada (jsonb), de volta ao tipo — ou nulo, se o que está lá não serve. */
export function saudeGuardada(json: unknown): { entidades: EntidadeDaSaude[]; cobrancaLida: boolean } | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as { entidades?: unknown; cobrancaLida?: unknown };
  if (!Array.isArray(o.entidades)) return null;
  return { entidades: o.entidades as EntidadeDaSaude[], cobrancaLida: o.cobrancaLida === true };
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
  const daMeta = erro ? [erro.descricao, erro.solucao].filter(Boolean).join(' ') : info.join(' ');
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
  const problemas =
    e.estado === 'disponivel'
      ? []
      : e.erros.length
        ? e.erros.map((erro) => problemaDaSaude(e, erro))
        : [problemaDaSaude(e, null, e.info)];
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
  /** A cobrança da conta na Meta. `lida: false` = não conseguimos ler; nada é afirmado. */
  cobranca: { lida: boolean; moeda: string | null; fuso: string | null; pagamentoId: string | null; url: string | null };
  /** Quando a autorização do cliente vence. Nulo = a Meta não informou prazo. */
  tokenExpiraEm: Date | null;
  agora: Date;
}

/** Com quantos dias de antecedência a conexão que vence vira aviso. */
export const DIAS_DO_AVISO_DE_CONEXAO = 7;

function itemDoPagamento(c: DadosDaSaude['cobranca']): ItemDaSaude | null {
  if (!c.lida) return null;
  const link = c.url ? { rotulo: ROTULO_DO_PAGAMENTO_NA_META, url: c.url } : null;
  const faltaMoeda = !c.moeda;
  const faltaForma = !c.pagamentoId;
  if (!faltaMoeda && !faltaForma) {
    return {
      chave: 'pagamento',
      rotulo: 'Pagamento na Meta',
      sinal: 'pode_enviar',
      // O fuso que a Meta devolve é um número dela (`timezone_id`): fica guardado, não vai para a tela.
      resumo: `Cobrança em ${c.moeda}, com forma de pagamento cadastrada.`,
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

function itemDaConexao(expiraEm: Date | null, agora: Date): ItemDaSaude {
  const base = { chave: 'conexao', rotulo: 'Conexão com o Regemcast' };
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
        acao: 'Reconecte o WhatsApp em WhatsApp, no menu. Leva um minuto e não muda o número nem os modelos.',
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
  itens.push(itemDaConexao(d.tokenExpiraEm, d.agora));

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
        ? 'A Meta ainda não respondeu sobre a situação desta conta. Confira de novo em instantes.'
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
