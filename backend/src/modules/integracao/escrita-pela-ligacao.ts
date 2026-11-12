/**
 * Hub DMS, F5 parte E (decisão F5-8): a escrita sai dos tokens antigos (`rct_it_`) quando o produto já grava pela
 * ligação do DMS ID (a autorização por clique). O mesmo desenho do Regem (#929, `escrita-pela-ligacao.ts`): uma lista no
 * código diz, por produto, as permissões de gravar que o token deixa de ter; a chave `LIAME_ESCRITA_SO_PELA_LIGACAO`
 * (desligada) liga o corte. Com ela ligada, o token do produto segue lendo e perde a escrita: a porta não lista as
 * ferramentas de gravar para ele, e a conferência do aviso assinado não o conta como credencial que dispara.
 *
 * Liga-se depois que o Liame gravar pela ligação no RegemCast (parte D, `regemcast_pede_ao_destino`), com um disparo de
 * teste pedido pela ligação.
 */

/** As permissões de gravar que saem do token antigo de cada produto. */
export const ESCRITA_QUE_SAI_DO_TOKEN: Readonly<Record<string, readonly string[]>> = {
  liame: ['modelos.rascunhar', 'campanhas.rascunhar', 'campanhas.disparar'],
};

/** A chave está ligada? Só `true` liga (V15: nada de `!!`). */
export const escritaSoPelaLigacaoLigada = (valor: unknown): boolean => valor === true;

/** As permissões do token antigo de `produto` com a chave: sem as de gravar da lista. Desligada, as mesmas. */
export function escritaForaDoToken(produto: string, escopos: readonly string[], ligada: boolean): string[] {
  const sai = ligada ? ESCRITA_QUE_SAI_DO_TOKEN[produto] : undefined;
  return sai ? escopos.filter((e) => !sai.includes(e)) : [...escopos];
}

/** O token antigo de `produto` ainda vale como credencial que tem `permissao`, com a chave como está? */
export const tokenAindaTem = (produto: string, permissao: string, ligada: boolean): boolean =>
  !(ligada && (ESCRITA_QUE_SAI_DO_TOKEN[produto] ?? []).includes(permissao));
