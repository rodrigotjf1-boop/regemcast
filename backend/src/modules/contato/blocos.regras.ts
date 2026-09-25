/**
 * Blocos da base — as regras, sem banco.
 *
 * Os tamanhos prontos são 250, 500, 750 e 1.000, e o dono pode escolher outro.
 * Decisão do dono (25/09/2026): os tamanhos vão sendo LIBERADOS conforme o
 * limite de envio da Meta sobe. Bloco maior que o limite não cabe num dia —
 * a campanha dele levaria mais de um dia só pelo teto, e o bloco perderia o
 * sentido de "o envio de hoje".
 *
 * Limite ainda não lido: só o degrau inicial (250) — o job de limite lê em até
 * 30 minutos. Sem teto: até 100.000.
 */

export const TAMANHOS_DE_BLOCO = [250, 500, 750, 1_000] as const;
export const TAMANHO_MINIMO = 50;
export const TAMANHO_MAXIMO = 100_000;
/** O degrau em que toda conta nova começa. */
export const LIMITE_INICIAL = 250;

export const ORIGENS_DA_DIVISAO = ['lista', 'importacao', 'base', 'perfil', 'regiao'] as const;
export type OrigemDaDivisao = (typeof ORIGENS_DA_DIVISAO)[number];

export const ORDENS_DOS_BLOCOS = ['importacao', 'sorteio', 'recentes', 'regiao', 'valor'] as const;
export type OrdemDosBlocos = (typeof ORDENS_DOS_BLOCOS)[number];

export interface OpcoesDeBloco {
  /** Pessoas por 24 h que a Meta permite hoje; `null` = sem teto ou ainda não lido. */
  limite: number | null;
  limiteConhecido: boolean;
  /** O maior tamanho aceito agora. */
  maximo: number;
  tamanhos: { valor: number; disponivel: boolean }[];
  /** O maior tamanho pronto que cabe no limite — o "bloco de um dia". */
  sugerido: number;
}

/**
 * @param limite  `tier_limite` do número (`null` = sem teto, se conhecido)
 * @param conhecido  o limite já foi lido alguma vez (`tier_nome` preenchido)
 */
export function opcoesDeBloco(limite: number | null, conhecido: boolean): OpcoesDeBloco {
  const maximo = !conhecido
    ? LIMITE_INICIAL
    : limite === null
      ? TAMANHO_MAXIMO
      : Math.min(TAMANHO_MAXIMO, Math.max(TAMANHO_MINIMO, limite));
  const tamanhos = TAMANHOS_DE_BLOCO.map((valor) => ({ valor, disponivel: valor <= maximo }));
  const cabem = tamanhos.filter((t) => t.disponivel).map((t) => t.valor);
  return {
    limite: conhecido ? limite : null,
    limiteConhecido: conhecido,
    maximo,
    tamanhos,
    sugerido: cabem.length ? Math.max(...cabem) : maximo,
  };
}

/** Quantos blocos e o tamanho do último. */
export function contaDosBlocos(total: number, tamanho: number): { blocos: number; ultimo: number } {
  if (total <= 0 || tamanho <= 0) return { blocos: 0, ultimo: 0 };
  const blocos = Math.ceil(total / tamanho);
  return { blocos, ultimo: total - (blocos - 1) * tamanho };
}

/** "Contatos do celular — 25/09 · bloco 03 de 14". Zeros à esquerda para a lista ordenar certo. */
export function nomeDoBloco(nomeDaDivisao: string, bloco: number, total: number): string {
  const casas = Math.max(2, String(total).length);
  return `${nomeDaDivisao} · bloco ${String(bloco).padStart(casas, '0')} de ${total}`;
}
