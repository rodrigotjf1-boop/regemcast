/**
 * Os sinais que a Meta dá sobre um modelo já aprovado: a qualidade e a
 * categoria que ela considera certa.
 *
 * Os dois mexem no bolso e no envio, e nenhum aparecia no Regemcast:
 *
 * - **Qualidade** (`quality_score`: GREEN, YELLOW, RED, UNKNOWN). Vem de quem
 *   recebe: bloqueio, denúncia, "parar promoções". Em RED o modelo está "em
 *   perigo de ser pausado ou desativado"; pausado, nenhuma campanha com ele sai.
 * - **Categoria** (`category`, `correct_category`, `previous_category`). A Meta
 *   reclassifica o que considera marketing disfarçado de utilidade — avisa com
 *   24 horas e muda. O preço por mensagem muda junto (marketing custa várias
 *   vezes a utilidade), e as regras de envio também.
 *
 * Chegam por dois caminhos: na lista de modelos (lida da Meta a cada visita) e
 * por aviso (`message_template_quality_update`, `template_category_update`),
 * que é o que permite avisar no celular na hora.
 *
 * Aqui ficam as regras puras: ler sem confiar no formato e montar o texto.
 */

export type QualidadeDoModelo = 'verde' | 'amarela' | 'vermelha' | 'desconhecida';

const QUALIDADE: Record<string, QualidadeDoModelo> = {
  GREEN: 'verde',
  YELLOW: 'amarela',
  RED: 'vermelha',
  UNKNOWN: 'desconhecida',
};
/** Quanto pior, maior. `desconhecida` não entra na conta: não é melhor nem pior. */
const PESO: Record<QualidadeDoModelo, number> = { verde: 0, amarela: 1, vermelha: 2, desconhecida: -1 };

/** As categorias da Meta, como a tela as chama (em minúsculas, como a lista de modelos). */
const CATEGORIA: Record<string, string> = {
  MARKETING: 'marketing',
  UTILITY: 'utilidade',
  AUTHENTICATION: 'autenticação',
};

/**
 * A qualidade, do jeito que a Meta mandar: a palavra solta (no aviso) ou o
 * objeto `{ score, date }` (na lista). O que não reconhecemos é "desconhecida"
 * — nunca "verde".
 */
export function qualidadeDoModelo(bruto: unknown): QualidadeDoModelo {
  const valor = bruto && typeof bruto === 'object' ? (bruto as { score?: unknown }).score : bruto;
  return QUALIDADE[String(valor ?? '').trim().toUpperCase()] ?? 'desconhecida';
}

/** A categoria em português; a que não conhecemos aparece crua, em minúsculas. Vazia = nula. */
export function nomeDaCategoria(bruta: unknown): string | null {
  const valor = typeof bruta === 'string' ? bruta.trim() : '';
  if (!valor) return null;
  return CATEGORIA[valor.toUpperCase()] ?? valor.toLowerCase();
}

export interface AlertaDoModelo {
  tom: 'atencao' | 'erro';
  texto: string;
}

export interface SinaisDoModelo {
  qualidade: QualidadeDoModelo;
  /** A categoria para a qual a Meta vai mudar o modelo. Nulo = nenhuma mudança à vista. */
  categoriaPrevista: string | null;
  /** A categoria que o modelo tinha antes de a Meta mudá-lo. Nulo = nunca mudou. */
  categoriaAnterior: string | null;
  /** O que pede atenção, em frases prontas para a tela. */
  alertas: AlertaDoModelo[];
}

const TEXTO_DA_QUALIDADE: Partial<Record<QualidadeDoModelo, AlertaDoModelo>> = {
  amarela: {
    tom: 'atencao',
    texto:
      'Qualidade em atenção: parte de quem recebeu este modelo bloqueou ou reclamou. Se continuar, a Meta pode pausá-lo. Reveja o texto e para quem você envia.',
  },
  vermelha: {
    tom: 'erro',
    texto:
      'Qualidade ruim: a Meta pode pausar ou desativar este modelo em breve, e com ele pausado nenhuma campanha sai. Evite usá-lo em campanha grande e reveja o texto e o público.',
  },
};

const O_QUE_MUDA = 'O preço por mensagem e as regras de envio mudam junto.';

/** Os sinais de um modelo da lista da Meta. */
export function sinaisDoModelo(m: {
  category?: unknown;
  quality_score?: unknown;
  correct_category?: unknown;
  previous_category?: unknown;
}): SinaisDoModelo {
  const qualidade = qualidadeDoModelo(m.quality_score);
  const atual = nomeDaCategoria(m.category);
  const correta = nomeDaCategoria(m.correct_category);
  const anterior = nomeDaCategoria(m.previous_category);

  // Só é "prevista" quando difere da atual: a Meta devolve o campo também
  // quando o modelo já está na categoria certa.
  const categoriaPrevista = correta && correta !== atual ? correta : null;
  const categoriaAnterior = anterior && anterior !== atual ? anterior : null;

  const alertas: AlertaDoModelo[] = [];
  const daQualidade = TEXTO_DA_QUALIDADE[qualidade];
  if (daQualidade) alertas.push(daQualidade);
  if (categoriaPrevista) {
    alertas.push({
      tom: 'atencao',
      texto: `A Meta vai mudar este modelo de ${atual ?? 'a categoria atual'} para ${categoriaPrevista} em até 24 horas. ${O_QUE_MUDA}`,
    });
  }
  return { qualidade, categoriaPrevista, categoriaAnterior, alertas };
}

// ------------------------------------------------------------------ os avisos da Meta

export interface AvisoDoModelo {
  idMeta: string;
  nome: string;
}

/** O que identifica o modelo num aviso. Sem id e sem nome, o aviso não serve. */
function modeloDoAviso(v: Record<string, unknown>): AvisoDoModelo | null {
  const idMeta = v.message_template_id != null ? String(v.message_template_id).trim() : '';
  const nome = typeof v.message_template_name === 'string' ? v.message_template_name.trim() : '';
  if (!idMeta && !nome) return null;
  return { idMeta, nome };
}

export interface MudancaDeQualidade extends AvisoDoModelo {
  anterior: QualidadeDoModelo;
  nova: QualidadeDoModelo;
  /** Caiu de verdade (verde → amarela, amarela → vermelha). Só isto vira aviso no celular. */
  piorou: boolean;
}

/** Lê o aviso `message_template_quality_update`. */
export function lerMudancaDeQualidade(v: Record<string, unknown>): MudancaDeQualidade | null {
  const modelo = modeloDoAviso(v);
  if (!modelo) return null;
  const anterior = qualidadeDoModelo(v.previous_quality_score);
  const nova = qualidadeDoModelo(v.new_quality_score);
  // Vinda de "desconhecida" (modelo novo), amarela ou vermelha já é queda.
  const piorou = PESO[nova] > 0 && PESO[nova] > PESO[anterior];
  return { ...modelo, anterior, nova, piorou };
}

export interface MudancaDeCategoria extends AvisoDoModelo {
  de: string;
  para: string;
  /** A Meta já mudou. Falso = vai mudar (o aviso das 24 horas). */
  feita: boolean;
  /** Quando a mudança marcada acontece. Só no aviso das 24 horas. */
  quando: Date | null;
  /** A categoria nova como a Meta escreve, para gravar. */
  paraBruta: string;
}

/**
 * Lê o aviso `template_category_update`, que vem em dois formatos:
 *
 * - **vai mudar** — `new_category` é a categoria de HOJE, `correct_category` a
 *   de amanhã, e `category_update_timestamp` diz quando;
 * - **mudou** — `previous_category` e `new_category`.
 *
 * O nome `new_category` significa coisas diferentes nos dois: ler pelo campo
 * que só um deles tem.
 */
export function lerMudancaDeCategoria(v: Record<string, unknown>): MudancaDeCategoria | null {
  const modelo = modeloDoAviso(v);
  if (!modelo) return null;
  const texto = (x: unknown) => (typeof x === 'string' ? x.trim() : '');

  const correta = texto(v.correct_category);
  if (correta) {
    const de = nomeDaCategoria(v.new_category);
    const para = nomeDaCategoria(correta);
    if (!de || !para || de === para) return null;
    const segundos = Number(v.category_update_timestamp);
    const quando = Number.isFinite(segundos) && segundos > 0 ? new Date(segundos * 1000) : null;
    return { ...modelo, de, para, feita: false, quando, paraBruta: correta.toUpperCase() };
  }

  const nova = texto(v.new_category);
  const de = nomeDaCategoria(v.previous_category);
  const para = nomeDaCategoria(nova);
  if (!de || !para || de === para) return null;
  return { ...modelo, de, para, feita: true, quando: null, paraBruta: nova.toUpperCase() };
}

/** "02/10 às 14:30", no fuso da conta. Fuso inválido cai no de Brasília. */
function diaEHora(quando: Date, fuso: string): string {
  const formatar = (tz: string) => {
    const p = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(quando)
      .reduce<Record<string, string>>((a, x) => ({ ...a, [x.type]: x.value }), {});
    return `${p.day}/${p.month} às ${p.hour}:${p.minute}`;
  };
  try {
    return formatar(fuso);
  } catch {
    return formatar('America/Sao_Paulo');
  }
}

export interface TextoDoAviso {
  titulo: string;
  corpo: string;
}

/** O aviso no celular da queda de qualidade. Nulo quando não caiu. */
export function avisoDaQualidade(m: MudancaDeQualidade): TextoDoAviso | null {
  if (!m.piorou) return null;
  const nome = m.nome || 'um modelo';
  return m.nova === 'vermelha'
    ? {
        titulo: `Qualidade ruim: ${nome}`,
        corpo: 'A Meta pode pausar ou desativar este modelo em breve. Evite usá-lo em campanha grande e reveja o texto e o público.',
      }
    : {
        titulo: `Qualidade em atenção: ${nome}`,
        corpo: 'Parte de quem recebeu este modelo bloqueou ou reclamou. Se continuar, a Meta pode pausá-lo.',
      };
}

/** O aviso no celular da mudança de categoria (a marcada e a feita). */
export function avisoDaCategoria(m: MudancaDeCategoria, fuso: string): TextoDoAviso {
  const nome = m.nome || 'um modelo';
  if (m.feita) {
    return {
      titulo: `A Meta mudou a categoria: ${nome}`,
      corpo: `O modelo passou de ${m.de} para ${m.para}. ${O_QUE_MUDA}`,
    };
  }
  const quando = m.quando ? `em ${diaEHora(m.quando, fuso)}` : 'em até 24 horas';
  return {
    titulo: `A Meta vai mudar a categoria: ${nome}`,
    corpo: `O modelo passa de ${m.de} para ${m.para} ${quando}. ${O_QUE_MUDA}`,
  };
}
