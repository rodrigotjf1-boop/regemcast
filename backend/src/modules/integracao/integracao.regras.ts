/**
 * A credencial de quem entra pela porta MCP: o token de integração.
 *
 * Regras puras — o que é um escopo, quem pode ter qual, como o token nasce e
 * como é reconhecido. O banco só guarda o hash: o token em claro existe na
 * resposta da emissão e em mais lugar nenhum.
 *
 * **Classe.** `dms` é um produto do grupo (Liame, Regem, GoGeM…); `externo` é
 * um cliente de fora. Decisão do dono em 02/10/2026: o disparo pelo MCP existe
 * para produto da DMS e NÃO existe para quem é de fora. A trava está aqui, na
 * emissão, e de novo na ferramenta — escopo guardado no banco não é confiança.
 */
import { createHash, randomBytes } from 'node:crypto';

export type ClasseDoToken = 'dms' | 'externo';

export const PREFIXO_DO_TOKEN = 'rct_it_';

/** Quantos caracteres do token a tela mostra para a pessoa reconhecer qual é. */
const TAMANHO_DO_PREFIXO_VISIVEL = PREFIXO_DO_TOKEN.length + 8;

export interface Escopo {
  /** O nome que vai no token e que cada ferramenta exige. */
  id: string;
  /** Como a tela chama. */
  rotulo: string;
  /** O que libera, em uma frase — é o que o dono lê em "Aplicativos conectados". */
  descricao: string;
  /** Só token de produto da DMS pode ter. */
  soDms: boolean;
}

/**
 * O catálogo. Escopo novo entra AQUI antes de qualquer ferramenta usá-lo, com a
 * frase que o dono da conta vai ler.
 */
export const ESCOPOS: readonly Escopo[] = [
  { id: 'conta.ler', rotulo: 'Situação da conta', descricao: 'Ver se a conta pode enviar agora, o plano e o uso do ciclo.', soDms: false },
  { id: 'campanhas.ler', rotulo: 'Campanhas e resultados', descricao: 'Ver as campanhas, o andamento, as falhas por motivo e o custo na Meta.', soDms: false },
  { id: 'publicos.ler', rotulo: 'Tamanho dos públicos', descricao: 'Contar quantas pessoas há em cada público e lista. Sem nome e sem telefone.', soDms: false },
  { id: 'modelos.ler', rotulo: 'Modelos de mensagem', descricao: 'Ver os modelos, a situação na Meta e a categoria.', soDms: false },
  { id: 'orcamento.ler', rotulo: 'Orçamento de disparos', descricao: 'Ver os tetos de gasto e quanto já saiu em cada período.', soDms: false },
  { id: 'conversas.anuncio.ler', rotulo: 'Conversas abertas por anúncio', descricao: 'Ver quais conversas começaram por um anúncio, com o telefone de quem escreveu. Sem o conteúdo das mensagens.', soDms: false },
  { id: 'modelos.rascunhar', rotulo: 'Criar rascunho de modelo', descricao: 'Criar e editar rascunhos de modelo. Não envia para a Meta.', soDms: false },
  { id: 'campanhas.rascunhar', rotulo: 'Criar rascunho de campanha', descricao: 'Montar campanhas em rascunho. Não dispara.', soDms: false },
  { id: 'campanhas.disparar', rotulo: 'Disparar campanha', descricao: 'Disparar uma campanha montada, dentro do orçamento da conta. Só para produtos da DMS.', soDms: true },
];

const POR_ID = new Map(ESCOPOS.map((e) => [e.id, e]));

const FORMATO_DO_PRODUTO = /^[a-z][a-z0-9_-]{1,39}$/;

export interface DadosDaEmissao {
  produto?: unknown;
  classe?: unknown;
  nome?: unknown;
  escopos?: unknown;
}

export interface EmissaoConferida {
  produto: string;
  classe: ClasseDoToken;
  nome: string;
  escopos: string[];
}

/** Confere o pedido de emissão. Devolve o que gravar, ou a frase do que está errado. */
export function conferirEmissao(d: DadosDaEmissao): EmissaoConferida | { erro: string } {
  const produto = String(d.produto ?? '').trim().toLowerCase();
  if (!FORMATO_DO_PRODUTO.test(produto)) {
    return { erro: 'Informe o produto que vai usar o token, em minúsculas e sem espaço — por exemplo liame.' };
  }

  if (d.classe !== 'dms' && d.classe !== 'externo') {
    return { erro: 'Diga se o token é de um produto da DMS ou de um cliente de fora.' };
  }
  const classe: ClasseDoToken = d.classe;

  const nome = String(d.nome ?? '').trim();
  if (nome.length < 2 || nome.length > 80) {
    return { erro: 'Dê um nome ao token, de 2 a 80 caracteres — é o que aparece em "Aplicativos conectados".' };
  }

  const pedidos = Array.isArray(d.escopos) ? [...new Set(d.escopos.map((e) => String(e).trim()))].filter(Boolean) : [];
  if (!pedidos.length) return { erro: 'Escolha pelo menos uma permissão para o token.' };

  const desconhecido = pedidos.find((e) => !POR_ID.has(e));
  if (desconhecido) return { erro: `A permissão "${desconhecido}" não existe.` };

  const proibido = pedidos.find((e) => POR_ID.get(e)!.soDms && classe !== 'dms');
  if (proibido) {
    return { erro: `A permissão "${POR_ID.get(proibido)!.rotulo}" só existe para produtos da DMS. Cliente de fora não dispara.` };
  }

  // Na ordem do catálogo: a tela e a auditoria mostram sempre do mesmo jeito.
  const escopos = ESCOPOS.filter((e) => pedidos.includes(e.id)).map((e) => e.id);
  return { produto, classe, nome, escopos };
}

/**
 * Os escopos que valem DE VERDADE para um token lido do banco: só os que
 * existem no catálogo e que a classe dele pode ter. Linha adulterada, ou
 * escopo que saiu do catálogo, não vira permissão.
 */
export function escoposEfetivos(guardados: unknown, classe: string): string[] {
  const lista = Array.isArray(guardados) ? guardados.map(String) : [];
  return ESCOPOS.filter((e) => lista.includes(e.id) && (!e.soDms || classe === 'dms')).map((e) => e.id);
}

/** As permissões de um token, com o texto que o dono lê. */
export function descreverEscopos(ids: readonly string[]): Array<{ id: string; rotulo: string; descricao: string }> {
  return ESCOPOS.filter((e) => ids.includes(e.id)).map(({ id, rotulo, descricao }) => ({ id, rotulo, descricao }));
}

/** Um token novo: o prefixo que diz o que ele é + 32 bytes de acaso. */
export function gerarToken(): string {
  return PREFIXO_DO_TOKEN + randomBytes(32).toString('base64url');
}

/** O que o banco guarda. O token tem 256 bits de acaso: hash simples basta, sem sal. */
export function hashDoToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** O começo do token, que a tela mostra: `rct_it_ab12cd34`. */
export function prefixoVisivel(token: string): string {
  return token.slice(0, TAMANHO_DO_PREFIXO_VISIVEL);
}

/**
 * O token de um cabeçalho `Authorization: Bearer …`, ou nulo. Só aceita o que
 * tem a cara de um token nosso — o resto nem chega ao banco.
 */
export function tokenDoCabecalho(authorization: unknown): string | null {
  if (typeof authorization !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  const token = m?.[1] ?? '';
  return /^rct_it_[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
