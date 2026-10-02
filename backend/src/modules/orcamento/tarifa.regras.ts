/**
 * As tarifas da Meta: quanto custa UMA mensagem entregue.
 *
 * O preço depende da moeda em que a conta é cobrada, do país de quem recebe
 * (pelo código do país do telefone) e da categoria do modelo. A Meta só muda os
 * valores no primeiro dia de cada trimestre; cada tarifa tem a data em que
 * passa a valer, e a anterior fica como histórico.
 *
 * Aqui ficam as regras puras: conferir o que o operador digita no console e
 * fazer a conta do dinheiro **sem ponto flutuante**. O valor de uma mensagem
 * tem até seis casas (R$ 0,321700); multiplicar isso por milhares de mensagens
 * em `number` é como aparece um centavo a mais ou a menos na tela. A conta é
 * feita em MICROS — milionésimos da moeda, inteiros — e só o total vira
 * centavos, arredondado uma vez.
 */

/** Milionésimos da moeda em 1 unidade (R$ 1,00 = 1.000.000 micros). */
const MICROS = 1_000_000;
/** Micros em 1 centavo. */
const MICROS_POR_CENTAVO = 10_000;

/** As categorias que o console oferece. A lista da Meta é aberta: outra, no formato dela, também entra. */
export const CATEGORIAS_CONHECIDAS = ['marketing', 'utility', 'authentication'] as const;

const FORMATO_DA_CATEGORIA = /^[a-z][a-z0-9_-]{0,39}$/;
const FORMATO_DA_MOEDA = /^[A-Z]{3}$/;
const FORMATO_DO_DDI = /^[1-9][0-9]{0,3}$/;
const FORMATO_DA_DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "0,3217", "0.3217" ou "R$ 0,32" → micros (321700). Nulo quando não é um
 * preço: vazio, negativo, zero, mais de seis casas, ou 1.000 ou mais (um preço
 * por mensagem desse tamanho é erro de digitação — vírgula no lugar errado).
 */
export function paraMicros(texto: unknown): number | null {
  const limpo = String(texto ?? '')
    .trim()
    .replace(/^R\$\s*/i, '')
    .replace(/\s/g, '')
    .replace(',', '.');
  const m = /^(\d{1,3})(?:\.(\d{1,6}))?$/.exec(limpo);
  if (!m) return null;
  const micros = Number(m[1]) * MICROS + Number((m[2] ?? '').padEnd(6, '0'));
  return micros > 0 ? micros : null;
}

/** Micros → o texto que o banco guarda (`numeric(12,6)`): "0.321700". */
export function microsParaNumeric(micros: number): string {
  const inteiro = Math.trunc(micros / MICROS);
  return `${inteiro}.${String(micros % MICROS).padStart(6, '0')}`;
}

/** O `numeric` do banco ("0.321700") → micros. O banco só guarda o que passou por `paraMicros`. */
export function numericParaMicros(valor: unknown): number {
  return paraMicros(String(valor ?? '')) ?? 0;
}

/**
 * O custo de `quantidade` mensagens, em centavos inteiros. A multiplicação é em
 * micros (inteiros) e o arredondamento, um só, no fim.
 */
export function custoEmCentavos(valorMicros: number, quantidade: number): number {
  if (!Number.isFinite(valorMicros) || !Number.isFinite(quantidade) || valorMicros <= 0 || quantidade <= 0) return 0;
  return Math.round((valorMicros * Math.trunc(quantidade)) / MICROS_POR_CENTAVO);
}

export interface DadosDaTarifa {
  moeda?: unknown;
  ddi?: unknown;
  categoria?: unknown;
  valor?: unknown;
  vigenteDe?: unknown;
  fonte?: unknown;
}

export interface TarifaConferida {
  moeda: string;
  ddi: string;
  categoria: string;
  valorMicros: number;
  vigenteDe: string;
  fonte: string | null;
}

/**
 * Confere uma tarifa nova. Devolve a tarifa pronta, ou a frase do que está
 * errado — uma por vez, a primeira, do jeito que o operador conserta.
 */
export function conferirTarifa(d: DadosDaTarifa): TarifaConferida | { erro: string } {
  const moeda = String(d.moeda ?? '').trim().toUpperCase();
  if (!FORMATO_DA_MOEDA.test(moeda)) return { erro: 'Informe a moeda com três letras, como BRL.' };

  const ddi = String(d.ddi ?? '').trim().replace(/^\+/, '');
  if (!FORMATO_DO_DDI.test(ddi)) return { erro: 'Informe o código do país de quem recebe, só com números — 55 para o Brasil.' };

  const categoria = String(d.categoria ?? '').trim().toLowerCase();
  if (!FORMATO_DA_CATEGORIA.test(categoria)) {
    return { erro: 'Informe a categoria como a Meta escreve: marketing, utility ou authentication.' };
  }

  const valorMicros = paraMicros(d.valor);
  if (valorMicros === null) {
    return { erro: 'Confira o valor: é o preço de UMA mensagem, com até seis casas — por exemplo 0,0350.' };
  }

  const vigenteDe = String(d.vigenteDe ?? '').trim();
  if (!FORMATO_DA_DATA.test(vigenteDe) || Number.isNaN(Date.parse(`${vigenteDe}T00:00:00Z`))) {
    return { erro: 'Informe a data em que o valor passa a valer.' };
  }

  const fonte = String(d.fonte ?? '').trim().slice(0, 200) || null;
  return { moeda, ddi, categoria, valorMicros, vigenteDe, fonte };
}
