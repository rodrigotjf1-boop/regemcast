import { motivoDoModelo } from './motivos-modelo';

describe('motivoDoModelo', () => {
  it('INVALID_FORMAT vira o que corrigir, com a variável certa — não o código cru', () => {
    const m = motivoDoModelo('INVALID_FORMAT')!;
    expect(m).toContain('{{1}}');
    expect(m).toContain('{nome}');
    expect(m).not.toContain('INVALID_FORMAT');
  });

  it('sem motivo (NONE, vazio, nulo) não inventa um', () => {
    for (const c of ['NONE', '', null, undefined]) expect(motivoDoModelo(c)).toBeNull();
  });

  it('aceita minúsculas e espaços, como a Meta às vezes manda', () => {
    expect(motivoDoModelo(' incorrect_category ')).toBe(motivoDoModelo('INCORRECT_CATEGORY'));
  });

  it('motivo que ainda não conhecemos: o nome dele, legível', () => {
    expect(motivoDoModelo('SOME_NEW_REASON')).toBe('Some new reason.');
  });
});
