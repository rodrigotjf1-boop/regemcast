/**
 * A categoria do modelo (quem decide é a Meta), como a tela fala dela: o nome
 * e o que ela muda no envio. Chega traduzida do servidor — marketing,
 * utilidade, autenticação —; categoria nova aparece como veio.
 */

type Tom = 'acento' | 'neutro' | 'atencao';

const CATEGORIAS: Record<string, { nome: string; explicacao: string; tom: Tom }> = {
  marketing: {
    nome: 'Marketing',
    explicacao: 'Promoção e novidade. Entra no descanso entre campanhas e no limite de marketing por pessoa da Meta.',
    tom: 'acento',
  },
  utilidade: {
    nome: 'Utilidade',
    explicacao: 'Aviso sobre um pedido, uma conta ou um agendamento da pessoa, sem promoção. Não entra no descanso.',
    tom: 'neutro',
  },
  autenticação: {
    nome: 'Autenticação',
    explicacao: 'Código de verificação para a pessoa entrar em algum lugar. Não serve para campanha.',
    tom: 'atencao',
  },
};

const chave = (categoria: string | null | undefined) =>
  (categoria ?? '')
    .trim()
    .toLowerCase()
    .replace('authentication', 'autenticação')
    .replace('autenticacao', 'autenticação')
    .replace('utility', 'utilidade');

/** "Marketing", "Utilidade", "Autenticação" — ou a categoria como veio, com inicial maiúscula. */
export function nomeDaCategoria(categoria: string | null | undefined): string | null {
  const c = chave(categoria);
  if (!c) return null;
  return CATEGORIAS[c]?.nome ?? c.charAt(0).toUpperCase() + c.slice(1);
}

/** O que a categoria muda no envio, para a linha abaixo do modelo. */
export function explicacaoDaCategoria(categoria: string | null | undefined): string | null {
  return CATEGORIAS[chave(categoria)]?.explicacao ?? null;
}

/** O tom da etiqueta: marketing no acento, utilidade neutra, autenticação em atenção. */
export function tomDaCategoria(categoria: string | null | undefined): Tom {
  return CATEGORIAS[chave(categoria)]?.tom ?? 'neutro';
}
