/**
 * Por que a Meta recusou um modelo — o código dela (`rejected_reason` na
 * leitura dos modelos, `reason` no aviso de status) em português, com o que
 * corrigir.
 *
 * Um lugar só: a lista "Na Meta" e o aviso de status mostravam o mesmo motivo
 * de dois jeitos (um deles, o código cru "INVALID_FORMAT").
 *
 * Os motivos de formato seguem a página de revisão de modelos da Meta
 * (conferida em 25/09/2026): variável fora do padrão `{{1}}`, variável no
 * começo ou no fim do texto, variáveis coladas.
 */
const MOTIVOS: Record<string, string> = {
  INVALID_FORMAT:
    'Formato fora do padrão da Meta. O mais comum é variável escrita errado: ela só aceita {{1}}, {{2}}… — {nome} ou {{nome}} são recusados. Também recusa variável no começo ou no fim do texto e duas variáveis coladas.',
  TAG_CONTENT_MISMATCH: 'O conteúdo não combina com a categoria ou o idioma escolhido.',
  INCORRECT_CATEGORY: 'A categoria não combina com o conteúdo: promoção e oferta são Marketing.',
  PROMOTIONAL: 'Conteúdo promocional fora da categoria Marketing.',
  ABUSIVE_CONTENT: 'Conteúdo considerado abusivo pela Meta.',
  SCAM: 'Conteúdo considerado golpe pela Meta.',
};

/** O motivo em português; `null` quando a Meta não deu motivo (`NONE` ou vazio). */
export function motivoDoModelo(codigo: string | null | undefined): string | null {
  const c = (codigo ?? '').trim().toUpperCase();
  if (!c || c === 'NONE') return null;
  // Motivo novo que ainda não conhecemos: o nome dele, legível — melhor que nada.
  return MOTIVOS[c] ?? `${c.charAt(0)}${c.slice(1).toLowerCase().replace(/_/g, ' ')}.`;
}
