/**
 * O disparo pela porta MCP — as regras, sem banco.
 *
 * Disparar é a única ação da porta que faz mensagem sair e custa dinheiro na
 * Meta. Por isso ela tem dois passos (planejar e disparar), e três travas que a
 * tela não tem:
 *
 * 1. **Só produto da DMS.** A permissão `campanhas.disparar` não existe para
 *    cliente de fora (emissão, leitura do token e a própria ferramenta).
 * 2. **Só campanha que o mesmo aplicativo montou.** O rascunho que uma pessoa
 *    fez na tela é dela para disparar.
 * 3. **Só com o orçamento de disparos valendo.** A conta precisa ter pelo menos
 *    um teto definido pelo dono, e o orçamento precisa conseguir contar o gasto
 *    desta campanha (moeda lida e tarifa cadastrada). Sem isso, nada limitaria
 *    quanto um aplicativo pode gastar — e o disparo é recusado.
 *
 * O plano devolve uma `confirmacao`: a impressão digital do que ele mostrou. O
 * disparo só roda com ela, e só se nada mudou desde então — quem dispara viu os
 * números que valem agora.
 */
import { createHash } from 'node:crypto';

import { emOrdem } from './idempotencia.regras';

export const SEM_ORCAMENTO =
  'A conta não tem orçamento de disparos definido. Para um aplicativo disparar, o dono da conta precisa definir pelo menos um teto de gasto (Conta → Orçamento de disparos).';
export const ORCAMENTO_NAO_CONTA =
  'O orçamento de disparos da conta não consegue contar o gasto agora (a Meta ainda não informou a moeda da conta, ou falta a tarifa). Sem isso, o disparo por aplicativo não é liberado.';
export const CUSTO_SEM_TARIFA =
  'Não há tarifa da Meta cadastrada para este tipo de mensagem: o orçamento não conseguiria segurar o gasto desta campanha. O disparo por aplicativo não é liberado.';
export const NINGUEM_NA_FILA = 'Ninguém do público desta campanha pode receber: não há o que disparar.';
export const SO_A_PROPRIA =
  'Pelo MCP só dá para disparar ou pausar uma campanha que este aplicativo montou. As outras são de uma pessoa da conta, na tela.';
export const SO_DMS = 'O disparo por aplicativo só existe para produtos da DMS.';
export const PLANO_MUDOU =
  'O que o plano mostrava mudou (o público, o custo ou o orçamento), ou a confirmação não é deste plano. Planeje de novo e dispare com a confirmação nova.';

export interface PeriodoDoPlano {
  tetoCentavos: number;
  gastoCentavos: number;
}

/** O que impede o disparo agora, em frases prontas. Vazio = pode disparar. */
export function impedimentosDoPlano(e: {
  /** A recusa que o próprio serviço daria (já disparada, conta bloqueada na Meta, plano sem saldo…). */
  doServico: string | null;
  naFila: number;
  temTeto: boolean;
  /** O orçamento consegue contar (tem moeda e tarifa). */
  orcamentoConta: boolean;
  /** Há preço para as mensagens desta campanha. */
  custoEstimavel: boolean;
}): string[] {
  const lista: string[] = [];
  if (e.doServico) lista.push(e.doServico);
  if (e.naFila <= 0) lista.push(NINGUEM_NA_FILA);
  if (!e.temTeto) lista.push(SEM_ORCAMENTO);
  else if (!e.orcamentoConta) lista.push(ORCAMENTO_NAO_CONTA);
  else if (!e.custoEstimavel) lista.push(CUSTO_SEM_TARIFA);
  return lista;
}

/**
 * Quando o custo estimado passa do que resta em algum período: não impede (o
 * orçamento existe para isso), mas quem dispara precisa saber que a campanha
 * vai sair aos poucos.
 */
export function avisoDeEspalhar(aSairCentavos: number | null, periodos: readonly PeriodoDoPlano[]): string | null {
  if (aSairCentavos === null || !periodos.length) return null;
  const resta = Math.min(...periodos.map((p) => Math.max(0, p.tetoCentavos - p.gastoCentavos)));
  if (aSairCentavos <= resta) return null;
  return 'O custo estimado passa do que resta no orçamento: a campanha sai até o teto, pausa e volta sozinha quando o período virar.';
}

/** A impressão digital do que o plano mostrou. Muda se o público, o custo ou o orçamento mudarem. */
export function confirmacaoDoPlano(d: {
  campanhaId: string;
  produto: string;
  situacao: string;
  destinatarios: number;
  naFila: number;
  modelo: string;
  aSairCentavos: number | null;
  tetos: Record<string, number | null>;
}): string {
  return createHash('sha256').update(emOrdem(d), 'utf8').digest('hex').slice(0, 32);
}
