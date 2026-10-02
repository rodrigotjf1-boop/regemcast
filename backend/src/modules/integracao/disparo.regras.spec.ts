import {
  avisoDeEspalhar,
  confirmacaoDoPlano,
  CUSTO_SEM_TARIFA,
  impedimentosDoPlano,
  NINGUEM_NA_FILA,
  ORCAMENTO_NAO_CONTA,
  SEM_ORCAMENTO,
} from './disparo.regras';

describe('impedimentosDoPlano', () => {
  const tudoCerto = { doServico: null, naFila: 320, temTeto: true, orcamentoConta: true, custoEstimavel: true };

  it('nada impede: lista vazia', () => {
    expect(impedimentosDoPlano(tudoCerto)).toEqual([]);
  });

  it('sem teto de orçamento definido pelo dono, o aplicativo não dispara', () => {
    expect(impedimentosDoPlano({ ...tudoCerto, temTeto: false, orcamentoConta: false, custoEstimavel: false })).toEqual([SEM_ORCAMENTO]);
  });

  it('com teto, mas o orçamento não consegue contar (sem moeda ou sem tarifa): não dispara', () => {
    expect(impedimentosDoPlano({ ...tudoCerto, orcamentoConta: false })).toEqual([ORCAMENTO_NAO_CONTA]);
  });

  it('com teto contando, mas sem preço para ESTA campanha: não dispara — o teto não a seguraria', () => {
    expect(impedimentosDoPlano({ ...tudoCerto, custoEstimavel: false })).toEqual([CUSTO_SEM_TARIFA]);
  });

  it('ninguém na fila: não há o que disparar', () => {
    expect(impedimentosDoPlano({ ...tudoCerto, naFila: 0 })).toEqual([NINGUEM_NA_FILA]);
  });

  it('a recusa do serviço (já disparada, conta bloqueada, plano sem saldo) vem primeiro, com a frase dele', () => {
    const frase = 'Esta campanha já foi disparada (está "enviando"). Crie outra para enviar de novo.';
    expect(impedimentosDoPlano({ ...tudoCerto, doServico: frase, temTeto: false })).toEqual([frase, SEM_ORCAMENTO]);
  });

  it('do orçamento sai UM motivo só: o primeiro que falta', () => {
    expect(impedimentosDoPlano({ doServico: null, naFila: 1, temTeto: false, orcamentoConta: false, custoEstimavel: false })).toHaveLength(1);
  });
});

describe('avisoDeEspalhar', () => {
  const dia = { tetoCentavos: 5000, gastoCentavos: 1000 };

  it('cabe no que resta: sem aviso', () => {
    expect(avisoDeEspalhar(4000, [dia])).toBeNull();
    expect(avisoDeEspalhar(3999, [dia, { tetoCentavos: 100000, gastoCentavos: 0 }])).toBeNull();
  });

  it('passa do que resta em algum período: avisa que vai sair aos poucos', () => {
    expect(avisoDeEspalhar(4001, [dia])).toMatch(/pausa e volta sozinha/);
    // O período mais apertado é o que manda.
    expect(avisoDeEspalhar(4001, [{ tetoCentavos: 100000, gastoCentavos: 0 }, dia])).toMatch(/pausa e volta sozinha/);
  });

  it('teto já estourado conta como "não resta nada", nunca como folga negativa', () => {
    expect(avisoDeEspalhar(1, [{ tetoCentavos: 500, gastoCentavos: 900 }])).toMatch(/pausa/);
  });

  it('sem custo ou sem período: sem aviso (o impedimento é outro)', () => {
    expect(avisoDeEspalhar(null, [dia])).toBeNull();
    expect(avisoDeEspalhar(1000, [])).toBeNull();
  });
});

describe('confirmacaoDoPlano', () => {
  const plano = {
    campanhaId: '8d9d5c1e-4b0f-4f5e-9a51-2f0a8c6f7a11',
    produto: 'liame',
    situacao: 'rascunho',
    destinatarios: 320,
    naFila: 318,
    modelo: 'promo_sexta',
    aSairCentavos: 10231,
    tetos: { dia: 5000, semana: null, mes: 100000 },
  };

  it('o mesmo plano dá a mesma confirmação, venha na ordem que vier', () => {
    const outraOrdem = { tetos: { mes: 100000, semana: null, dia: 5000 }, aSairCentavos: 10231, modelo: 'promo_sexta', naFila: 318, destinatarios: 320, situacao: 'rascunho', produto: 'liame', campanhaId: plano.campanhaId };
    expect(confirmacaoDoPlano(plano)).toBe(confirmacaoDoPlano(outraOrdem));
    expect(confirmacaoDoPlano(plano)).toMatch(/^[0-9a-f]{32}$/);
  });

  it.each([
    ['o público mudou', { naFila: 317 }],
    ['o custo mudou', { aSairCentavos: 10200 }],
    ['o dono mudou o teto', { tetos: { dia: 3000, semana: null, mes: 100000 } }],
    ['o dono tirou um teto', { tetos: { dia: null, semana: null, mes: 100000 } }],
    ['a campanha já não é rascunho', { situacao: 'agendada' }],
    ['o modelo é outro', { modelo: 'promo_sabado' }],
    ['é outra campanha', { campanhaId: '8d9d5c1e-4b0f-4f5e-9a51-2f0a8c6f7a12' }],
    ['é outro aplicativo', { produto: 'regem' }],
  ])('%s: a confirmação muda', (_nome, mudanca) => {
    expect(confirmacaoDoPlano({ ...plano, ...mudanca })).not.toBe(confirmacaoDoPlano(plano));
  });
});
