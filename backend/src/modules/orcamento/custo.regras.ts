/**
 * Quanto uma campanha custa na Meta: a estimativa antes de disparar e o gasto
 * de verdade depois.
 *
 * Regras puras. A consulta (`custo.consulta.ts`) conta as mensagens em grupos —
 * começo do telefone, categoria, dia, situação — e aqui cada grupo encontra a
 * tarifa dele (`tarifa_meta`) e vira dinheiro.
 *
 * Três coisas que este arquivo não deixa acontecer:
 *
 * - **"Não sei" não vira zero.** Mensagem sem tarifa cadastrada, conta sem
 *   moeda e mensagem entregue sem o aviso de cobrança da Meta saem da conta e
 *   aparecem num aviso, com a quantidade. Zero é um valor; "não sei" é outro.
 * - **Estimativa é teto.** A Meta só cobra a mensagem entregue, e utilidade
 *   dentro da janela de atendimento sai de graça. O que ainda não saiu conta
 *   inteiro, e a tela diz "até".
 * - **Sem ponto flutuante.** A soma é em micros (inteiros) e vira centavos uma
 *   vez só, no fim.
 */

/** Micros em 1 centavo. */
const MICROS_POR_CENTAVO = 10_000;
const MICROS = 1_000_000;

/** Quantos dígitos do começo do telefone a consulta agrupa: o maior código de país cadastrável. */
export const DIGITOS_DO_PREFIXO = 4;

/** Uma tarifa da tabela, como a conta precisa dela. */
export interface TarifaDaTabela {
  ddi: string;
  categoria: string;
  valorMicros: number;
  /** AAAA-MM-DD: o dia em que o valor passa a valer. */
  vigenteDe: string;
}

/**
 * - `cobrada`: entregue (ou lida) e a Meta disse que cobrou.
 * - `gratis`: entregue e a Meta disse que não cobrou.
 * - `sem_aviso`: entregue, e a Meta não disse se cobrou.
 * - `a_sair`: na fila ou a caminho — ainda pode ser cobrada.
 */
export type SituacaoDaMensagem = 'cobrada' | 'gratis' | 'sem_aviso' | 'a_sair';

/** Um grupo de mensagens iguais para a conta. */
export interface GrupoDeMensagens {
  /** Os primeiros dígitos do telefone de quem recebe, sem o "+". */
  prefixo: string;
  /** A categoria como a Meta escreve (`marketing`, `utility`…). Nulo = desconhecida. */
  categoria: string | null;
  /** AAAA-MM-DD: o dia que decide a tarifa (a entrega; hoje, para o que ainda não saiu). */
  dia: string;
  situacao: SituacaoDaMensagem;
  quantas: number;
}

const CATEGORIA_NA_META: Record<string, string> = {
  marketing: 'marketing',
  utilidade: 'utility',
  utility: 'utility',
  'autenticação': 'authentication',
  autenticacao: 'authentication',
  authentication: 'authentication',
};

const FORMATO_DA_CATEGORIA = /^[a-z][a-z0-9_-]{0,39}$/;

/**
 * A categoria do modelo como a tabela de tarifas a guarda. A campanha guarda o
 * nome traduzido ("utilidade"); a tarifa, o da Meta (`utility`). Categoria que
 * não conhecemos passa como veio, se tiver o formato da Meta.
 */
export function categoriaNaMeta(daCampanha: unknown): string | null {
  const valor = typeof daCampanha === 'string' ? daCampanha.trim().toLowerCase() : '';
  if (!valor) return null;
  return CATEGORIA_NA_META[valor] ?? (FORMATO_DA_CATEGORIA.test(valor) ? valor : null);
}

/**
 * A tarifa que vale para um telefone, numa categoria, num dia: a do código de
 * país mais longo que casa com o começo do número e, nele, a de vigência mais
 * recente que já tinha começado naquele dia.
 */
export function tarifaPara(
  tarifas: readonly TarifaDaTabela[],
  prefixo: string,
  categoria: string | null,
  dia: string,
): TarifaDaTabela | null {
  if (!categoria) return null;
  let melhor: TarifaDaTabela | null = null;
  for (const t of tarifas) {
    if (t.categoria !== categoria || t.vigenteDe > dia || !prefixo.startsWith(t.ddi)) continue;
    if (
      !melhor ||
      t.ddi.length > melhor.ddi.length ||
      (t.ddi.length === melhor.ddi.length && t.vigenteDe > melhor.vigenteDe)
    ) {
      melhor = t;
    }
  }
  return melhor;
}

/** Uma parte da conta: o que já foi cobrado, ou o que ainda pode ser. */
export interface ParteDoCusto {
  /** A soma, em centavos, das mensagens que têm tarifa. */
  centavos: number;
  /** Quantas mensagens entraram na soma. */
  mensagens: number;
  /** Quantas ficaram de fora por falta de tarifa. */
  semTarifa: number;
  /** O preço de uma mensagem, em micros, quando todas saíram pelo mesmo. Nulo = preços diferentes, ou nenhuma. */
  unitarioMicros: number | null;
}

export interface CustoCalculado {
  gasto: ParteDoCusto;
  aSair: ParteDoCusto;
  /** Entregues que a Meta marcou como não cobradas. */
  gratis: number;
  /** Entregues sem o aviso de cobrança da Meta: não se sabe se foram cobradas. */
  semAviso: number;
}

interface Soma {
  micros: number;
  mensagens: number;
  semTarifa: number;
  precos: Set<number>;
}

function fechar(s: Soma): ParteDoCusto {
  return {
    centavos: Math.round(s.micros / MICROS_POR_CENTAVO),
    mensagens: s.mensagens,
    semTarifa: s.semTarifa,
    unitarioMicros: s.precos.size === 1 ? [...s.precos][0]! : null,
  };
}

/** Soma os grupos com as tarifas. Grupo sem tarifa conta em `semTarifa`, nunca como zero. */
export function calcularCusto(grupos: readonly GrupoDeMensagens[], tarifas: readonly TarifaDaTabela[]): CustoCalculado {
  const nova = (): Soma => ({ micros: 0, mensagens: 0, semTarifa: 0, precos: new Set() });
  const gasto = nova();
  const aSair = nova();
  let gratis = 0;
  let semAviso = 0;

  for (const g of grupos) {
    const quantas = Math.trunc(Number(g.quantas));
    if (!Number.isFinite(quantas) || quantas <= 0) continue;
    if (g.situacao === 'gratis') {
      gratis += quantas;
      continue;
    }
    if (g.situacao === 'sem_aviso') {
      semAviso += quantas;
      continue;
    }
    const soma = g.situacao === 'cobrada' ? gasto : aSair;
    const tarifa = tarifaPara(tarifas, g.prefixo, g.categoria, g.dia);
    if (!tarifa) {
      soma.semTarifa += quantas;
      continue;
    }
    soma.micros += tarifa.valorMicros * quantas;
    soma.mensagens += quantas;
    soma.precos.add(tarifa.valorMicros);
  }

  return { gasto: fechar(gasto), aSair: fechar(aSair), gratis, semAviso };
}

/** 12345 → "12.345". À mão: o formato não pode depender do idioma do servidor. */
function milhar(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Centavos → "R$ 1.234,56". Outra moeda sai com o código dela: "USD 1.234,56". */
export function dinheiro(centavos: number, moeda: string): string {
  const total = Math.max(0, Math.trunc(centavos));
  const texto = `${milhar(total / 100)},${String(total % 100).padStart(2, '0')}`;
  return `${moeda === 'BRL' ? 'R$' : moeda} ${texto}`;
}

/** O preço de uma mensagem: "R$ 0,3217", "R$ 0,035", "R$ 0,30" — as casas que o valor tem, duas no mínimo. */
export function precoDaMensagem(micros: number, moeda: string): string {
  const inteiro = Math.trunc(micros / MICROS);
  const casas = String(micros % MICROS).padStart(6, '0').replace(/0{1,4}$/, '');
  return `${moeda === 'BRL' ? 'R$' : moeda} ${inteiro},${casas}`;
}

function mensagens(n: number): string {
  return n === 1 ? '1 mensagem' : `${milhar(n)} mensagens`;
}

/** Uma linha do cartão: o rótulo, o valor em destaque e de onde ele saiu. */
export interface LinhaDoCusto {
  rotulo: string;
  valor: string;
  detalhe: string | null;
}

/**
 * O custo como a tela mostra. As frases vêm prontas: site e app só exibem.
 * Sem linhas e sem avisos, não há o que mostrar (campanha sem destinatários).
 */
export interface CustoParaTela {
  /** A moeda em que a Meta cobra a conta (ISO 4217). Nulo = a Meta ainda não informou. */
  moeda: string | null;
  /** O que a Meta já cobrou, em centavos. Nulo = não dá para calcular. */
  gastoCentavos: number | null;
  /** O teto do que ainda pode ser cobrado, em centavos. Nulo = não dá para calcular. */
  aSairCentavos: number | null;
  linhas: LinhaDoCusto[];
  avisos: string[];
  /** A regra da cobrança, em uma frase. Nulo quando não há valor na tela. */
  nota: string | null;
}

/**
 * Em que ponto a campanha está:
 * - `antes`: nada saiu (rascunho, ou a prévia do público) — só a estimativa.
 * - `saindo`: disparada e não terminada.
 * - `encerrada`: concluída ou cancelada.
 */
export type FaseDoCusto = 'antes' | 'saindo' | 'encerrada';

const NOTA =
  'A Meta cobra só a mensagem entregue, na forma de pagamento cadastrada na sua conta da Meta. O valor final é o da fatura dela.';

export const SEM_MOEDA =
  'A Meta ainda não informou em que moeda cobra a sua conta. Sem isso não dá para calcular o custo.';

function detalheDoTeto(p: ParteDoCusto, moeda: string): string {
  return p.unitarioMicros
    ? `${mensagens(p.mensagens)} × ${precoDaMensagem(p.unitarioMicros, moeda)}`
    : `${mensagens(p.mensagens)}, com preços diferentes por país`;
}

/** Monta as linhas e os avisos. `moeda` nula = a conta ainda não tem moeda lida na Meta. */
export function custoParaTela(calculo: CustoCalculado, moeda: string | null, fase: FaseDoCusto): CustoParaTela {
  const { gasto, aSair, gratis, semAviso } = calculo;
  const haMensagens = gasto.mensagens + gasto.semTarifa + aSair.mensagens + aSair.semTarifa + gratis + semAviso > 0;

  if (!moeda) {
    return {
      moeda: null,
      gastoCentavos: null,
      aSairCentavos: null,
      linhas: [],
      avisos: haMensagens ? [SEM_MOEDA] : [],
      nota: null,
    };
  }

  const linhas: LinhaDoCusto[] = [];
  const avisos: string[] = [];

  if (fase !== 'antes' && (gasto.mensagens > 0 || gasto.semTarifa === 0) && haMensagens) {
    const partes = [
      gasto.mensagens === 0
        ? `Nenhuma mensagem cobrada${fase === 'encerrada' ? '' : ' até agora'}`
        : gasto.mensagens === 1
          ? '1 mensagem cobrada'
          : `${milhar(gasto.mensagens)} mensagens cobradas`,
    ];
    if (gratis > 0) partes.push(`${milhar(gratis)} sem custo`);
    linhas.push({
      rotulo: fase === 'encerrada' ? 'Gasto na Meta' : 'Gasto na Meta até agora',
      valor: dinheiro(gasto.centavos, moeda),
      detalhe: partes.join(' · '),
    });
  }

  if (aSair.mensagens > 0) {
    linhas.push({
      rotulo: fase === 'antes' ? 'Custo estimado na Meta' : 'Ainda pode sair',
      valor: `até ${dinheiro(aSair.centavos, moeda)}`,
      detalhe: detalheDoTeto(aSair, moeda),
    });
  }

  const semTarifa = gasto.semTarifa + aSair.semTarifa;
  if (semTarifa > 0) {
    const todas = gasto.mensagens + aSair.mensagens === 0;
    avisos.push(
      todas
        ? `Ainda não temos a tarifa da Meta para este tipo de mensagem: não dá para ${fase === 'antes' ? 'estimar o custo' : 'calcular o custo'}.`
        : `${mensagens(semTarifa)} ${semTarifa === 1 ? 'ficou' : 'ficaram'} fora da conta: ainda não temos a tarifa da Meta para ${semTarifa === 1 ? 'ela' : 'elas'} (outro país ou outro tipo de mensagem).`,
    );
  }
  if (semAviso > 0) {
    avisos.push(
      semAviso === 1
        ? 'A Meta não disse se cobrou 1 mensagem entregue: ela não entra no gasto.'
        : `A Meta não disse se cobrou ${milhar(semAviso)} mensagens entregues: elas não entram no gasto.`,
    );
  }

  return {
    moeda,
    gastoCentavos: gasto.semTarifa === 0 ? gasto.centavos : null,
    aSairCentavos: aSair.semTarifa === 0 ? aSair.centavos : null,
    linhas,
    avisos,
    nota: linhas.length ? NOTA : null,
  };
}
