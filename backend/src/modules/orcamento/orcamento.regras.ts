/**
 * O orçamento de disparos: quanto o dono aceita gastar na Meta por dia, por
 * semana e por mês.
 *
 * Regras puras. A consulta (`orcamento.consulta.ts`) conta o que já saiu em
 * cada período; aqui isso vira dinheiro (pelas tarifas de `tarifa_meta`), vira
 * "quantas mensagens ainda cabem", os avisos de 80% e de 100%, e as frases que
 * a tela mostra.
 *
 * O que conta como gasto do período é o que SAIU nele — a mensagem que a Meta
 * aceitou, pelo preço cheio, mesmo antes de ser entregue. A Meta só cobra na
 * entrega, mas o teto existe para segurar o que o dono autoriza disparar: se
 * esperasse a entrega para contar, uma rodada inteira passaria do teto antes
 * de o primeiro aviso chegar. A que falhou e a que a Meta avisou que sai de
 * graça deixam de contar.
 *
 * Mensagem sem tarifa cadastrada não entra na conta — e a tela diz quantas são.
 *
 * Sem ponto flutuante: micros (milionésimos da moeda) e centavos, inteiros.
 */
import { dinheiro, tarifaPara, type TarifaDaTabela } from './custo.regras';

const MICROS_POR_CENTAVO = 10_000;

export type Periodo = 'dia' | 'semana' | 'mes';
export const PERIODOS: readonly Periodo[] = ['dia', 'semana', 'mes'];

/** Os três tetos, em centavos. Nulo = sem teto naquele período. */
export type Tetos = Record<Periodo, number | null>;

/** O maior teto que a tela aceita: R$ 9.999.999,99. Acima disso é erro de digitação. */
const TETO_MAXIMO_CENTAVOS = 999_999_999;

const NOME: Record<Periodo, string> = { dia: 'do dia', semana: 'da semana', mes: 'do mês' };
const ROTULO: Record<Periodo, string> = { dia: 'Hoje', semana: 'Esta semana', mes: 'Este mês' };
const DESTE: Record<Periodo, string> = { dia: 'de hoje', semana: 'desta semana', mes: 'deste mês' };
const VOLTA: Record<Periodo, string> = { dia: 'amanhã', semana: 'na segunda-feira', mes: 'no dia 1º' };
const ZERA: Record<Periodo, string> = { dia: 'Zera amanhã', semana: 'Zera na segunda-feira', mes: 'Zera no dia 1º' };

/**
 * O que o dono digita → centavos. Vazio ou nulo = sem teto.
 *
 * Aceita "50", "50,5", "50,00", "1.250,00", "1250.50" e "R$ 50". Ponto seguido
 * de três dígitos é separador de milhar ("1.250" são mil duzentos e cinquenta),
 * como todo brasileiro escreve.
 */
export function lerTeto(valor: unknown): number | null | { erro: string } {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== 'string' && typeof valor !== 'number') return { erro: 'Informe o valor em reais, por exemplo 50,00.' };
  const limpo = String(valor)
    .trim()
    .replace(/^R\$\s*/i, '')
    .replace(/\s/g, '');
  if (!limpo) return null;

  let normal: string;
  if (limpo.includes(',')) normal = limpo.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(limpo)) normal = limpo.replace(/\./g, '');
  else normal = limpo;

  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(normal);
  if (!m) return { erro: 'Informe o valor em reais, com até dois centavos — por exemplo 50,00.' };
  const centavos = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (centavos <= 0) return { erro: 'O teto precisa ser maior que zero. Para tirar o teto, deixe o campo vazio.' };
  if (centavos > TETO_MAXIMO_CENTAVOS) return { erro: 'Esse valor é alto demais para um teto. Confira a vírgula.' };
  return centavos;
}

/** Os três tetos conferidos, ou a primeira frase do que está errado. */
export function conferirTetos(entrada: Partial<Record<Periodo, unknown>>): Tetos | { erro: string } {
  const tetos: Tetos = { dia: null, semana: null, mes: null };
  for (const p of PERIODOS) {
    const lido = lerTeto(entrada[p]);
    if (lido !== null && typeof lido === 'object') return { erro: `Teto ${NOME[p]}: ${lido.erro}` };
    tetos[p] = lido;
  }
  // O período maior contém o menor: um teto do dia acima do da semana nunca seria alcançado.
  const ordem: [Periodo, Periodo][] = [['dia', 'semana'], ['dia', 'mes'], ['semana', 'mes']];
  for (const [menor, maior] of ordem) {
    if (tetos[menor] !== null && tetos[maior] !== null && tetos[menor]! > tetos[maior]!) {
      return { erro: `O teto ${NOME[menor]} não pode ser maior que o ${NOME[maior]}.` };
    }
  }
  return tetos;
}

/** Centavos → o texto do campo de edição: "50,00", "1.250,50". Vazio = sem teto. */
export function tetoParaCampo(centavos: number | null): string {
  return centavos === null ? '' : dinheiro(centavos, 'BRL').replace(/^R\$\s/, '');
}

/** As mensagens que já saíram, agrupadas, com quantas caem em cada período. */
export interface GrupoDoOrcamento {
  prefixo: string;
  /** A categoria como a Meta escreve. Nulo = desconhecida (fica sem tarifa). */
  categoria: string | null;
  dia: number;
  semana: number;
  mes: number;
}

/** Onde cada período começa (AAAA-MM-DD, no fuso da conta) e quando vira. */
export type Janelas = Record<Periodo, { inicio: string; viraEm: Date }>;

/** Um período com teto: quanto já saiu nele. */
export interface UsoDoPeriodo {
  periodo: Periodo;
  tetoCentavos: number;
  /** O que saiu no período, em micros, das mensagens que têm tarifa. */
  gastoMicros: number;
  /** Quantas mensagens do período ficaram fora da conta por falta de tarifa. */
  semTarifa: number;
  inicio: string;
  viraEm: Date;
}

/** O uso de cada período que tem teto. Sem teto nenhum, lista vazia. */
export function usoDoOrcamento(
  tetos: Tetos,
  grupos: readonly GrupoDoOrcamento[],
  tarifas: readonly TarifaDaTabela[],
  hoje: string,
  janelas: Janelas,
): UsoDoPeriodo[] {
  const usos: UsoDoPeriodo[] = [];
  for (const p of PERIODOS) {
    const teto = tetos[p];
    if (teto === null) continue;
    let gastoMicros = 0;
    let semTarifa = 0;
    for (const g of grupos) {
      const quantas = Math.trunc(Number(g[p]));
      if (!Number.isFinite(quantas) || quantas <= 0) continue;
      const tarifa = tarifaPara(tarifas, g.prefixo, g.categoria, hoje);
      if (tarifa) gastoMicros += tarifa.valorMicros * quantas;
      else semTarifa += quantas;
    }
    usos.push({ periodo: p, tetoCentavos: teto, gastoMicros, semTarifa, inicio: janelas[p].inicio, viraEm: janelas[p].viraEm });
  }
  return usos;
}

/**
 * O preço de uma mensagem da rodada, para a reserva: o MAIOR entre os países de
 * quem está na vez. Com ele, a rodada nunca passa do teto; com um país só — o
 * caso de quase toda conta — é o preço exato. Nulo = ninguém da vez tem tarifa
 * (essas mensagens não contam no orçamento).
 */
export function precoDaRodada(
  tarifas: readonly TarifaDaTabela[],
  prefixos: readonly string[],
  categoria: string | null,
  hoje: string,
): number | null {
  let maior: number | null = null;
  for (const prefixo of prefixos) {
    const tarifa = tarifaPara(tarifas, prefixo, categoria, hoje);
    if (tarifa && (maior === null || tarifa.valorMicros > maior)) maior = tarifa.valorMicros;
  }
  return maior;
}

function folgaMicros(u: UsoDoPeriodo): number {
  return u.tetoCentavos * MICROS_POR_CENTAVO - u.gastoMicros;
}

/**
 * Quantas mensagens desse preço ainda cabem em todos os tetos. Nulo = nada
 * limita: a conta não tem teto, ou a mensagem não tem preço conhecido.
 */
export function quantasCabem(usos: readonly UsoDoPeriodo[], precoMicros: number | null): number | null {
  if (!usos.length || !precoMicros || precoMicros <= 0) return null;
  return Math.max(0, Math.min(...usos.map((u) => Math.floor(folgaMicros(u) / precoMicros))));
}

/** Os períodos em que não cabe mais uma mensagem desse preço. */
export function periodosCheios(usos: readonly UsoDoPeriodo[], precoMicros: number): UsoDoPeriodo[] {
  return usos.filter((u) => folgaMicros(u) < precoMicros);
}

/** Quando a campanha pode voltar: a virada mais distante entre os períodos cheios. */
export function voltaEm(cheios: readonly UsoDoPeriodo[]): Date | null {
  return cheios.reduce<Date | null>((mais, u) => (mais === null || u.viraEm > mais ? u.viraEm : mais), null);
}

export interface NivelAtingido {
  periodo: Periodo;
  inicio: string;
  /** 80 = passou de 80% do teto; 100 = não cabe mais uma mensagem. */
  nivel: 80 | 100;
  tetoCentavos: number;
  /** O gasto do período já com o que a rodada reservou, em centavos. */
  gastoCentavos: number;
}

/**
 * Os avisos que o orçamento pede depois de a rodada reservar `quantas`
 * mensagens de `precoMicros`. Um por período, o nível mais alto.
 */
export function niveisAtingidos(usos: readonly UsoDoPeriodo[], precoMicros: number, quantas: number): NivelAtingido[] {
  const niveis: NivelAtingido[] = [];
  for (const u of usos) {
    const gasto = u.gastoMicros + precoMicros * Math.max(0, Math.trunc(quantas));
    const teto = u.tetoCentavos * MICROS_POR_CENTAVO;
    const nivel = teto - gasto < precoMicros ? 100 : gasto * 10 >= teto * 8 ? 80 : null;
    if (nivel === null) continue;
    niveis.push({
      periodo: u.periodo,
      inicio: u.inicio,
      nivel,
      tetoCentavos: u.tetoCentavos,
      gastoCentavos: Math.round(gasto / MICROS_POR_CENTAVO),
    });
  }
  return niveis;
}

/** O aviso que vai para o celular do dono. */
export function avisoDoOrcamento(n: NivelAtingido, moeda: string): { titulo: string; corpo: string } {
  if (n.nivel === 100) {
    return {
      titulo: 'Orçamento de disparos atingido',
      corpo: `O orçamento ${DESTE[n.periodo]} (${dinheiro(n.tetoCentavos, moeda)}) foi atingido. As campanhas pausam e voltam a sair sozinhas ${VOLTA[n.periodo]}.`,
    };
  }
  return {
    titulo: 'Orçamento de disparos em 80%',
    corpo: `Você já usou ${dinheiro(n.gastoCentavos, moeda)} dos ${dinheiro(n.tetoCentavos, moeda)} do orçamento ${DESTE[n.periodo]}.`,
  };
}

/** O período mais apertado: o de maior uso em relação ao teto; no empate, o mais longo. */
function maisApertado(usos: readonly UsoDoPeriodo[]): UsoDoPeriodo | null {
  let pior: UsoDoPeriodo | null = null;
  for (const u of usos) {
    // gasto/teto de um contra o do outro, sem dividir.
    if (!pior || u.gastoMicros * pior.tetoCentavos >= pior.gastoMicros * u.tetoCentavos) pior = u;
  }
  return pior;
}

/**
 * A frase da campanha pausada pelo orçamento: qual teto encheu. A hora em que
 * ela volta vai à parte (`campanha.retomar_em`), para a tela mostrar no fuso de
 * quem lê.
 */
export function frasePausaPeloOrcamento(usos: readonly UsoDoPeriodo[], moeda: string | null): string {
  const u = maisApertado(usos);
  if (!u || !moeda) return 'O orçamento de disparos foi atingido.';
  const gasto = Math.round(u.gastoMicros / MICROS_POR_CENTAVO);
  return `O orçamento ${DESTE[u.periodo]} está no limite: ${dinheiro(gasto, moeda)} de ${dinheiro(u.tetoCentavos, moeda)}.`;
}

/** Recusa de retomar à mão uma campanha quando o orçamento não tem folga. */
export function fraseSemFolga(usos: readonly UsoDoPeriodo[], precoMicros: number, moeda: string | null): string {
  const cheios = periodosCheios(usos, precoMicros);
  return `${frasePausaPeloOrcamento(cheios.length ? cheios : usos, moeda)} A campanha volta sozinha quando o período virar, ou antes se o dono da conta aumentar o orçamento.`;
}

export interface PeriodoParaTela {
  periodo: Periodo;
  /** "Hoje", "Esta semana", "Este mês". */
  rotulo: string;
  tetoCentavos: number;
  gastoCentavos: number;
  /** 0 a 100, para a barra. */
  percentual: number;
  /** "R$ 12,40 de R$ 50,00". */
  texto: string;
  sinal: 'ok' | 'atencao' | 'cheio';
  /** "Zera amanhã". */
  zera: string;
}

/** O orçamento como a tela mostra. As frases vêm prontas. */
export interface OrcamentoParaTela {
  /** A moeda em que a Meta cobra a conta. Nulo = a Meta ainda não informou. */
  moeda: string | null;
  tetos: Tetos;
  /** O texto de cada campo de edição ("50,00"); vazio = sem teto. */
  campos: Record<Periodo, string>;
  /** Só os períodos com teto. */
  periodos: PeriodoParaTela[];
  avisos: string[];
  /** Só o dono muda o orçamento. */
  podeMudar: boolean;
}

export const ORCAMENTO_SEM_MOEDA =
  'A Meta ainda não informou em que moeda cobra a sua conta. Enquanto isso, o orçamento não consegue contar o gasto.';
export const ORCAMENTO_SEM_TARIFA =
  'Ainda não temos a tarifa da Meta cadastrada. Enquanto isso, o orçamento não consegue contar o gasto.';

export function orcamentoParaTela(
  tetos: Tetos,
  usos: readonly UsoDoPeriodo[],
  moeda: string | null,
  temTarifa: boolean,
  podeMudar: boolean,
): OrcamentoParaTela {
  const avisos: string[] = [];
  const temTeto = PERIODOS.some((p) => tetos[p] !== null);
  if (temTeto && !moeda) avisos.push(ORCAMENTO_SEM_MOEDA);
  else if (temTeto && !temTarifa) avisos.push(ORCAMENTO_SEM_TARIFA);
  else {
    const semTarifa = Math.max(0, ...usos.map((u) => u.semTarifa));
    if (semTarifa > 0) {
      avisos.push(
        semTarifa === 1
          ? '1 mensagem enviada não entra na conta do orçamento: ainda não temos a tarifa da Meta para ela.'
          : `${String(semTarifa).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} mensagens enviadas não entram na conta do orçamento: ainda não temos a tarifa da Meta para elas.`,
      );
    }
  }

  const m = moeda ?? 'BRL';
  return {
    moeda,
    tetos,
    campos: { dia: tetoParaCampo(tetos.dia), semana: tetoParaCampo(tetos.semana), mes: tetoParaCampo(tetos.mes) },
    periodos: usos.map((u) => {
      const gastoCentavos = Math.round(u.gastoMicros / MICROS_POR_CENTAVO);
      const percentual = Math.min(100, Math.floor((gastoCentavos * 100) / u.tetoCentavos));
      return {
        periodo: u.periodo,
        rotulo: ROTULO[u.periodo],
        tetoCentavos: u.tetoCentavos,
        gastoCentavos,
        percentual,
        texto: `${dinheiro(gastoCentavos, m)} de ${dinheiro(u.tetoCentavos, m)}`,
        sinal: percentual >= 100 ? 'cheio' : percentual >= 80 ? 'atencao' : 'ok',
        zera: ZERA[u.periodo],
      };
    }),
    avisos,
    podeMudar,
  };
}
