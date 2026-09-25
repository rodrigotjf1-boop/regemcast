import { contaDosBlocos, nomeDoBloco, opcoesDeBloco } from './blocos.regras';

describe('opcoesDeBloco — os tamanhos são liberados conforme o limite da Meta sobe', () => {
  const disponiveis = (o: ReturnType<typeof opcoesDeBloco>) => o.tamanhos.filter((t) => t.disponivel).map((t) => t.valor);

  it('limite de 250 (conta nova): só o bloco de 250', () => {
    const o = opcoesDeBloco(250, true);
    expect(disponiveis(o)).toEqual([250]);
    expect(o).toMatchObject({ maximo: 250, sugerido: 250 });
  });

  it('limite de 2.000: todos os prontos, sugerido o de 1.000, personalizado até 2.000', () => {
    const o = opcoesDeBloco(2_000, true);
    expect(disponiveis(o)).toEqual([250, 500, 750, 1_000]);
    expect(o).toMatchObject({ maximo: 2_000, sugerido: 1_000 });
  });

  it('sem teto: todos, e personalizado até 100.000', () => {
    const o = opcoesDeBloco(null, true);
    expect(disponiveis(o)).toEqual([250, 500, 750, 1_000]);
    expect(o.maximo).toBe(100_000);
  });

  it('limite nunca lido: não libera além do degrau inicial', () => {
    const o = opcoesDeBloco(null, false);
    expect(disponiveis(o)).toEqual([250]);
    expect(o).toMatchObject({ maximo: 250, limiteConhecido: false, limite: null });
  });

  it('degrau antigo menor que o menor bloco pronto: só personalizado, até o limite', () => {
    const o = opcoesDeBloco(50, true);
    expect(disponiveis(o)).toEqual([]);
    expect(o).toMatchObject({ maximo: 50, sugerido: 50 });
  });
});

describe('contaDosBlocos', () => {
  it('13.835 em blocos de 1.000: 14 blocos, o último com 835', () => {
    expect(contaDosBlocos(13_835, 1_000)).toEqual({ blocos: 14, ultimo: 835 });
  });

  it('divisão exata e base vazia', () => {
    expect(contaDosBlocos(1_000, 250)).toEqual({ blocos: 4, ultimo: 250 });
    expect(contaDosBlocos(0, 250)).toEqual({ blocos: 0, ultimo: 0 });
  });
});

describe('nomeDoBloco', () => {
  it('zeros à esquerda para a lista ordenar certo', () => {
    expect(nomeDoBloco('Celular — 25/09', 3, 14)).toBe('Celular — 25/09 · bloco 03 de 14');
    expect(nomeDoBloco('Base', 7, 120)).toBe('Base · bloco 007 de 120');
  });
});
