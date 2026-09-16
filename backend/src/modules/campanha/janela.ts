/**
 * Janela de envio e ritmo: pode sair mensagem agora?
 *
 * Funções puras, de propósito. A pergunta "está dentro da janela?" depende de
 * fuso, dia da semana, virada de meia-noite e tetos por período — é exatamente
 * o tipo de regra que parece óbvia e erra na borda. Sem banco e sem relógio
 * embutido, dá para testar cada borda com uma data escolhida a dedo.
 *
 * Por que a janela existe, e não é enfeite: mandar promoção às três da manhã é
 * o jeito mais rápido de a pessoa bloquear o número. Bloqueio derruba a nota de
 * qualidade na Meta, que reduz o limite diário, que estrangula todas as
 * campanhas seguintes. A janela protege o ativo.
 */

export interface RegraDeEnvio {
  /** 0 = domingo … 6 = sábado. Vazio = qualquer dia. */
  janelaDias: number[];
  /** 'HH:MM' ou 'HH:MM:SS', no fuso da conta. Nulo = sem limite de horário. */
  janelaInicio: string | null;
  janelaFim: string | null;
  pausaSegundos: number;
  maxPorDia: number | null;
  maxPorSemana: number | null;
  maxPorMes: number | null;
}

/** O instante, visto do fuso da conta. */
export interface Momento {
  /** 0 = domingo … 6 = sábado. */
  diaSemana: number;
  /** Minutos desde a meia-noite local. */
  minutos: number;
}

const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Dia da semana e hora no fuso da conta.
 *
 * `Intl`, e não `getHours()`: o servidor roda em UTC, e `getHours()` devolveria
 * a hora de Londres para uma conta de São Paulo — a janela "das 9 às 20"
 * abriria às 6 da manhã do cliente.
 */
export function momentoNoFuso(agora: Date, fuso: string): Momento {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora);

  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  const hora = Number(valor('hour'));
  const minuto = Number(valor('minute'));

  return { diaSemana: DIAS[valor('weekday')] ?? 0, minutos: hora * 60 + minuto };
}

/** 'HH:MM[:SS]' → minutos desde a meia-noite. */
export function paraMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * O instante está dentro da janela?
 *
 * Trata a janela que ATRAVESSA a meia-noite ("das 22h às 2h"), que é o caso
 * que a comparação ingênua `inicio <= agora < fim` sempre erra: com início
 * maior que fim, nenhum horário satisfaz as duas condições, e a campanha nunca
 * sai. O dia considerado é o do instante atual.
 */
export function dentroDaJanela(regra: RegraDeEnvio, momento: Momento): boolean {
  if (regra.janelaDias.length && !regra.janelaDias.includes(momento.diaSemana)) {
    return false;
  }

  if (!regra.janelaInicio || !regra.janelaFim) return true;

  const inicio = paraMinutos(regra.janelaInicio);
  const fim = paraMinutos(regra.janelaFim);

  if (inicio === fim) return true; // janela de 24h
  if (inicio < fim) return momento.minutos >= inicio && momento.minutos < fim;
  // Atravessa a meia-noite.
  return momento.minutos >= inicio || momento.minutos < fim;
}

/** Quantas já saíram em cada período. */
export interface EnviadosNoPeriodo {
  dia: number;
  semana: number;
  mes: number;
}

/**
 * Quantas mensagens ainda cabem, considerando os três tetos.
 *
 * O menor dos três manda. Sem teto nenhum, devolve `Infinity` — e quem chama
 * aplica o próprio lote, porque "sem teto nosso" não é "sem teto": a Meta
 * continua mandando no dela.
 */
export function quantasCabem(regra: RegraDeEnvio, enviados: EnviadosNoPeriodo): number {
  const folgas = [
    regra.maxPorDia === null ? Infinity : regra.maxPorDia - enviados.dia,
    regra.maxPorSemana === null ? Infinity : regra.maxPorSemana - enviados.semana,
    regra.maxPorMes === null ? Infinity : regra.maxPorMes - enviados.mes,
  ];
  return Math.max(0, Math.min(...folgas));
}

/** Já passou a pausa desde a última mensagem desta campanha? */
export function pausaCumprida(regra: RegraDeEnvio, ultimoEnvio: Date | null, agora: Date): boolean {
  if (!regra.pausaSegundos || !ultimoEnvio) return true;
  return agora.getTime() - ultimoEnvio.getTime() >= regra.pausaSegundos * 1000;
}

export type Decisao =
  | { pode: true; quantas: number }
  | { pode: false; motivo: 'fora_da_janela' | 'teto_atingido' | 'pausa' };

/**
 * A decisão inteira, numa função só.
 *
 * A ordem das perguntas importa para o MOTIVO que a tela mostra: "fora da
 * janela" é mais útil que "teto atingido" quando os dois são verdade, porque é
 * o que muda sozinho mais cedo.
 */
export function decidir(
  regra: RegraDeEnvio,
  momento: Momento,
  enviados: EnviadosNoPeriodo,
  ultimoEnvio: Date | null,
  agora: Date,
  lote: number,
): Decisao {
  if (!dentroDaJanela(regra, momento)) return { pode: false, motivo: 'fora_da_janela' };

  const cabem = quantasCabem(regra, enviados);
  if (cabem <= 0) return { pode: false, motivo: 'teto_atingido' };

  if (!pausaCumprida(regra, ultimoEnvio, agora)) return { pode: false, motivo: 'pausa' };

  // Com pausa, sai UMA por rodada: duas na mesma rodada já violariam a pausa
  // entre elas. Sem pausa, sai o lote, limitado pelo que ainda cabe.
  const quantas = regra.pausaSegundos > 0 ? 1 : Math.min(lote, cabem);
  return { pode: true, quantas };
}
