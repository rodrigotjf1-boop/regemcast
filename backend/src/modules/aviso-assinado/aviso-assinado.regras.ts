/**
 * O aviso assinado a quem pediu (Hub DMS, F5 parte B, PR 3; decisão F5-7) — as regras, sem banco. (Não confundir com o
 * módulo `aviso`, o aviso no celular de quem usa o Regemcast.)
 *
 * O produto da DMS que pediu um disparo registra, pela porta MCP, para onde o Regemcast avisa e com que segredo
 * (`aviso_registrar`). A cada mudança do pedido (aprovado, recusado, vencido, cancelado, executado, parou no teto), o
 * Regemcast manda um POST assinado no padrão Standard Webhooks (pacote comum, seção 7). O aviso é só gatilho (Padrão DMS
 * §9): leva o tipo e o id do pedido, nunca dado pessoal; quem recebe lê o pedido por `acao_pedido_ler`.
 *
 * O endereço só vale dentro das bases do produto, fixas aqui (a regra do pacote, `destinoAvisoPermitido`: https, porta
 * padrão, a base mais UM trecho, o id da conexão do lado dele). Quem tem só a credencial não escolhe para onde o
 * Regemcast faz chamadas. Detalhe em `docs/aprovacao-de-disparos.md`.
 */
import { chaveDoSegredoAviso, destinoAvisoPermitido } from '../../dms/integracao-dms';

/** O único tipo de hoje: o pedido de ação mudou (leia por `acao_pedido_ler`). */
export const TIPO_ACAO_ALTERADA = 'acao.alterada';

/**
 * Para onde cada produto pode pedir aviso: a base de produção dele. O que vem depois da base é UM trecho (o id da
 * conexão do lado dele). Produto fora daqui não registra aviso. `AVISO_BASES` troca a lista de um produto (teste).
 */
export const BASES_DE_AVISO: Readonly<Record<string, readonly string[]>> = {
  liame: ['https://api.agencialiame.com/v1/inbox/regemcast/'],
};

/** As bases de um produto: as da variável de teste, se ela trouxer o produto, senão as do código. */
export function basesDoProduto(produto: string, daVariavel: Readonly<Record<string, readonly string[]>> = {}): readonly string[] {
  if (Object.prototype.hasOwnProperty.call(daVariavel, produto)) return daVariavel[produto]!;
  return Object.prototype.hasOwnProperty.call(BASES_DE_AVISO, produto) ? BASES_DE_AVISO[produto]! : [];
}

export const LIMITE_DO_ENDERECO = 500;

export type RegistroConferido =
  | { ok: true; url: string }
  | { ok: false; problema: 'endereco-nao-permitido' | 'segredo-invalido'; mensagem: string };

/** O registro que a porta recebe: o endereço dentro das bases do produto e o segredo no formato `whsec_`. */
export function conferirRegistro(r: { url: unknown; segredo: unknown }, bases: readonly string[]): RegistroConferido {
  if (!bases.length) return { ok: false, problema: 'endereco-nao-permitido', mensagem: SEM_BASE };
  if (!destinoAvisoPermitido(r.url, bases)) return { ok: false, problema: 'endereco-nao-permitido', mensagem: enderecoForaDaBase(bases) };
  const url = new URL(r.url as string).href;
  if (url.length > LIMITE_DO_ENDERECO) return { ok: false, problema: 'endereco-nao-permitido', mensagem: enderecoForaDaBase(bases) };
  if (!chaveDoSegredoAviso(r.segredo)) return { ok: false, problema: 'segredo-invalido', mensagem: SEGREDO_INVALIDO };
  return { ok: true, url };
}

/** O corpo do aviso: só o tipo e o id do pedido (o texto enviado é o mesmo que foi assinado). */
export function corpoDoAviso(tipo: string, id: string): string {
  return JSON.stringify({ tipo, id });
}

/**
 * O recuo entre as tentativas, em segundos: 8 tentativas em cerca de 1 dia e meio. Depois da última, o Regemcast
 * desiste deste aviso (quem pediu ainda acompanha pela consulta).
 */
export const RECUO_SEGUNDOS: readonly number[] = [30, 120, 600, 1800, 7200, 21600, 43200, 86400];

/** A próxima tentativa depois de `tentativas` falhas (já contada a de agora), ou nula: desiste. */
export function proximaTentativa(tentativas: number, agora: Date): Date | null {
  if (tentativas < 1) return agora;
  const espera = RECUO_SEGUNDOS[tentativas - 1];
  return espera === undefined ? null : new Date(agora.getTime() + espera * 1000);
}

/** Falhas seguidas (de qualquer aviso da conta e do produto) que pausam o registro: registrar de novo religa. */
export const FALHAS_PARA_PAUSAR = 20;

/** O destino respondeu 2xx: entregue. Qualquer outra coisa (status, sem resposta) é falha e tenta de novo. */
export function entregue(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}

/** O prazo de cada envio, em milissegundos. */
export const PRAZO_DO_ENVIO_MS = 10_000;

// ------------------------------------------------------------------- frases

export const SEM_BASE =
  'Este aplicativo não tem endereço de aviso cadastrado no Regemcast. Fale com a DMS para incluir a base de produção dele.';
export const SEGREDO_INVALIDO = 'O segredo vai no formato whsec_ seguido de 24 a 64 bytes em base64 (Standard Webhooks).';
export const SEM_AVISO = 'Este aplicativo não registrou endereço de aviso nesta conta.';
export const SEM_CREDENCIAL = 'O aplicativo não tem mais credencial com a permissão do aviso nesta conta: o aviso não saiu.';
export const SO_DMS_AVISO = 'Só produto da DMS registra aviso no Regemcast.';
export const PAUSADO_POR_FALHAS = `O aviso foi pausado depois de ${FALHAS_PARA_PAUSAR} entregas seguidas sem resposta 2xx. Registre de novo para religar.`;

export function enderecoForaDaBase(bases: readonly string[]): string {
  return `O endereço tem de ser uma destas bases mais UM trecho (o id da conexão do seu lado), em https: ${bases.join(', ')}`;
}
