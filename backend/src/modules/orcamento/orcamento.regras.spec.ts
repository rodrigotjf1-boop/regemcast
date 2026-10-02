import type { TarifaDaTabela } from './custo.regras';
import {
  avisoDoOrcamento,
  conferirTetos,
  frasePausaPeloOrcamento,
  fraseSemFolga,
  lerTeto,
  niveisAtingidos,
  ORCAMENTO_SEM_MOEDA,
  ORCAMENTO_SEM_TARIFA,
  orcamentoParaTela,
  periodosCheios,
  precoDaRodada,
  quantasCabem,
  tetoParaCampo,
  usoDoOrcamento,
  voltaEm,
  type GrupoDoOrcamento,
  type Janelas,
  type Tetos,
  type UsoDoPeriodo,
} from './orcamento.regras';

/** Valores de EXEMPLO: não são a tarifa da Meta. */
const TARIFAS: TarifaDaTabela[] = [
  { ddi: '55', categoria: 'marketing', valorMicros: 321_700, vigenteDe: '2026-07-01' },
  { ddi: '55', categoria: 'utility', valorMicros: 35_000, vigenteDe: '2026-07-01' },
  { ddi: '1', categoria: 'marketing', valorMicros: 137_300, vigenteDe: '2026-07-01' },
];
const HOJE = '2026-10-02';
const JANELAS: Janelas = {
  dia: { inicio: '2026-10-02', viraEm: new Date('2026-10-03T03:00:00Z') },
  semana: { inicio: '2026-09-28', viraEm: new Date('2026-10-05T03:00:00Z') },
  mes: { inicio: '2026-10-01', viraEm: new Date('2026-11-01T03:00:00Z') },
};
const PRECO = 321_700;

const grupo = (g: Partial<GrupoDoOrcamento>): GrupoDoOrcamento => ({
  prefixo: '5521',
  categoria: 'marketing',
  dia: 0,
  semana: 0,
  mes: 0,
  ...g,
});
const uso = (u: Partial<UsoDoPeriodo>): UsoDoPeriodo => ({
  periodo: 'dia',
  tetoCentavos: 5000,
  gastoMicros: 0,
  semTarifa: 0,
  inicio: JANELAS.dia.inicio,
  viraEm: JANELAS.dia.viraEm,
  ...u,
});

describe('lerTeto', () => {
  it.each([
    ['50', 5000],
    ['50,5', 5050],
    ['50,00', 5000],
    ['R$ 50,00', 5000],
    ['1.250,00', 125_000],
    ['1.250', 125_000],
    ['1250.50', 125_050],
    ['0,01', 1],
    [' 300 ', 30_000],
    [50, 5000],
    ['9.999.999,99', 999_999_999],
  ])('%p → %d centavos', (valor, centavos) => {
    expect(lerTeto(valor)).toBe(centavos);
  });

  it.each([[''], ['   '], [null], [undefined]])('%p = sem teto', (valor) => {
    expect(lerTeto(valor)).toBeNull();
  });

  it.each([['abc'], ['50,123'], ['-5'], ['1,2,3'], ['12345678'], [{}], [true]])('%p é recusado com uma frase', (valor) => {
    expect(lerTeto(valor)).toEqual({ erro: expect.any(String) });
  });

  it('zero não é teto: para tirar, é o campo vazio', () => {
    expect(lerTeto('0')).toEqual({ erro: expect.stringMatching(/deixe o campo vazio/) });
    expect(lerTeto('0,00')).toEqual({ erro: expect.stringMatching(/maior que zero/) });
  });
});

describe('conferirTetos', () => {
  it('aceita os três, em ordem', () => {
    expect(conferirTetos({ dia: '50', semana: '300', mes: '1.000,00' })).toEqual({ dia: 5000, semana: 30_000, mes: 100_000 });
  });

  it('campo vazio ou ausente tira o teto daquele período', () => {
    expect(conferirTetos({ dia: '', mes: '1000' })).toEqual({ dia: null, semana: null, mes: 100_000 });
    expect(conferirTetos({})).toEqual({ dia: null, semana: null, mes: null });
  });

  it('tetos iguais valem', () => {
    expect(conferirTetos({ dia: '100', semana: '100', mes: '100' })).toEqual({ dia: 10_000, semana: 10_000, mes: 10_000 });
  });

  it.each([
    [{ dia: '500', semana: '300' }, 'O teto do dia não pode ser maior que o da semana.'],
    [{ dia: '500', mes: '300' }, 'O teto do dia não pode ser maior que o do mês.'],
    [{ semana: '500', mes: '300' }, 'O teto da semana não pode ser maior que o do mês.'],
  ])('%p: o período maior contém o menor', (entrada, erro) => {
    expect(conferirTetos(entrada)).toEqual({ erro });
  });

  it('valor errado: diz em qual campo', () => {
    expect(conferirTetos({ dia: '50', semana: 'muito' })).toEqual({ erro: expect.stringMatching(/^Teto da semana: /) });
  });
});

describe('tetoParaCampo', () => {
  it('devolve o que a pessoa digitaria — e lerTeto lê de volta', () => {
    expect(tetoParaCampo(5000)).toBe('50,00');
    expect(tetoParaCampo(125_050)).toBe('1.250,50');
    expect(tetoParaCampo(null)).toBe('');
    expect(lerTeto(tetoParaCampo(125_050))).toBe(125_050);
  });
});

describe('usoDoOrcamento', () => {
  const tetos: Tetos = { dia: 5000, semana: null, mes: 100_000 };

  it('só os períodos com teto, cada um com o que saiu nele', () => {
    const usos = usoDoOrcamento(tetos, [grupo({ dia: 10, semana: 40, mes: 100 })], TARIFAS, HOJE, JANELAS);
    expect(usos.map((u) => u.periodo)).toEqual(['dia', 'mes']);
    expect(usos[0]).toMatchObject({ tetoCentavos: 5000, gastoMicros: 3_217_000, semTarifa: 0, viraEm: JANELAS.dia.viraEm });
    expect(usos[1]).toMatchObject({ tetoCentavos: 100_000, gastoMicros: 32_170_000, inicio: '2026-10-01' });
  });

  it('soma países e categorias, cada um pelo preço dele', () => {
    const usos = usoDoOrcamento(
      tetos,
      [grupo({ dia: 10 }), grupo({ categoria: 'utility', dia: 100 }), grupo({ prefixo: '1212', dia: 10 })],
      TARIFAS,
      HOJE,
      JANELAS,
    );
    // 10 × 0,3217 + 100 × 0,035 + 10 × 0,1373
    expect(usos[0]!.gastoMicros).toBe(3_217_000 + 3_500_000 + 1_373_000);
  });

  it('mensagem sem tarifa não vira zero nem custo: é contada à parte', () => {
    const usos = usoDoOrcamento(
      tetos,
      [grupo({ dia: 10 }), grupo({ prefixo: '3519', dia: 4 }), grupo({ categoria: null, dia: 3 })],
      TARIFAS,
      HOJE,
      JANELAS,
    );
    expect(usos[0]).toMatchObject({ gastoMicros: 3_217_000, semTarifa: 7 });
  });

  it('conta sem teto nenhum: nada a contar', () => {
    expect(usoDoOrcamento({ dia: null, semana: null, mes: null }, [grupo({ dia: 10 })], TARIFAS, HOJE, JANELAS)).toEqual([]);
  });
});

describe('precoDaRodada', () => {
  it('o preço de quem está na vez; com mais de um país, o maior', () => {
    expect(precoDaRodada(TARIFAS, ['5521', '5511'], 'marketing', HOJE)).toBe(321_700);
    expect(precoDaRodada(TARIFAS, ['1212', '5521'], 'marketing', HOJE)).toBe(321_700);
    expect(precoDaRodada(TARIFAS, ['1212'], 'marketing', HOJE)).toBe(137_300);
  });

  it('ninguém da vez tem tarifa: sem preço', () => {
    expect(precoDaRodada(TARIFAS, ['3519'], 'marketing', HOJE)).toBeNull();
    expect(precoDaRodada(TARIFAS, ['5521'], 'authentication', HOJE)).toBeNull();
    expect(precoDaRodada(TARIFAS, [], 'marketing', HOJE)).toBeNull();
  });
});

describe('quantasCabem', () => {
  it('quantas mensagens desse preço cabem na folga', () => {
    // R$ 50,00 ÷ 0,3217 = 155,4 → 155
    expect(quantasCabem([uso({})], PRECO)).toBe(155);
    // já saíram 150: sobram 5
    expect(quantasCabem([uso({ gastoMicros: 150 * PRECO })], PRECO)).toBe(5);
  });

  it('com mais de um teto, vale o mais apertado', () => {
    const usos = [uso({ gastoMicros: 0 }), uso({ periodo: 'mes', tetoCentavos: 100_000, gastoMicros: 3100 * PRECO })];
    // o mês tem R$ 1.000 e já saíram 3.100 × 0,3217 = 997,27: sobram 8
    expect(quantasCabem(usos, PRECO)).toBe(8);
  });

  it('folga menor que uma mensagem: zero, nunca negativo', () => {
    expect(quantasCabem([uso({ gastoMicros: 49_900_000 })], PRECO)).toBe(0);
    expect(quantasCabem([uso({ gastoMicros: 80_000_000 })], PRECO)).toBe(0);
  });

  it('sem teto ou sem preço conhecido: nada limita', () => {
    expect(quantasCabem([], PRECO)).toBeNull();
    expect(quantasCabem([uso({})], null)).toBeNull();
  });

  it('nunca deixa passar do teto', () => {
    for (const gasto of [0, 1, 12_345_678, 49_678_300, 49_999_999]) {
      const cabem = quantasCabem([uso({ gastoMicros: gasto })], PRECO)!;
      expect(gasto + cabem * PRECO).toBeLessThanOrEqual(50_000_000);
      expect(gasto + (cabem + 1) * PRECO).toBeGreaterThan(50_000_000);
    }
  });
});

describe('periodosCheios e voltaEm', () => {
  const dia = uso({ gastoMicros: 49_900_000 });
  const mes = uso({ periodo: 'mes', tetoCentavos: 100_000, gastoMicros: 999_900_000, viraEm: JANELAS.mes.viraEm });
  const folgado = uso({ periodo: 'semana', tetoCentavos: 30_000, gastoMicros: 0, viraEm: JANELAS.semana.viraEm });

  it('cheio é o período em que não cabe mais uma mensagem', () => {
    expect(periodosCheios([dia, folgado], PRECO)).toEqual([dia]);
    expect(periodosCheios([folgado], PRECO)).toEqual([]);
  });

  it('a campanha volta na virada mais distante entre os cheios', () => {
    expect(voltaEm([dia])).toEqual(JANELAS.dia.viraEm);
    expect(voltaEm([dia, mes])).toEqual(JANELAS.mes.viraEm);
    expect(voltaEm([])).toBeNull();
  });
});

describe('niveisAtingidos', () => {
  it('abaixo de 80%: nenhum aviso', () => {
    expect(niveisAtingidos([uso({ gastoMicros: 10_000_000 })], PRECO, 20)).toEqual([]);
  });

  it('a rodada cruzou os 80%: aviso de 80, com o gasto já contando o que ela reservou', () => {
    // 39,00 + 20 × 0,3217 = 45,43 (90%)
    expect(niveisAtingidos([uso({ gastoMicros: 39_000_000 })], PRECO, 20)).toEqual([
      { periodo: 'dia', inicio: '2026-10-02', nivel: 80, tetoCentavos: 5000, gastoCentavos: 4543 },
    ]);
  });

  it('depois da rodada não cabe mais uma: aviso de 100', () => {
    // 45,00 + 15 × 0,3217 = 49,83; sobram 0,17 < 0,3217
    const n = niveisAtingidos([uso({ gastoMicros: 45_000_000 })], PRECO, 15);
    expect(n).toEqual([{ periodo: 'dia', inicio: '2026-10-02', nivel: 100, tetoCentavos: 5000, gastoCentavos: 4983 }]);
  });

  it('um aviso por período, o nível mais alto de cada', () => {
    const n = niveisAtingidos(
      [uso({ gastoMicros: 49_900_000 }), uso({ periodo: 'mes', tetoCentavos: 100_000, gastoMicros: 850_000_000, inicio: '2026-10-01' })],
      PRECO,
      0,
    );
    expect(n.map((x) => `${x.periodo}:${x.nivel}`)).toEqual(['dia:100', 'mes:80']);
  });
});

describe('frases', () => {
  it('o aviso de 80% diz quanto de quanto', () => {
    expect(avisoDoOrcamento({ periodo: 'dia', inicio: HOJE, nivel: 80, tetoCentavos: 5000, gastoCentavos: 4012 }, 'BRL')).toEqual({
      titulo: 'Orçamento de disparos em 80%',
      corpo: 'Você já usou R$ 40,12 dos R$ 50,00 do orçamento de hoje.',
    });
  });

  it.each([
    ['dia', 'O orçamento de hoje (R$ 50,00) foi atingido. As campanhas pausam e voltam a sair sozinhas amanhã.'],
    ['semana', 'O orçamento desta semana (R$ 50,00) foi atingido. As campanhas pausam e voltam a sair sozinhas na segunda-feira.'],
    ['mes', 'O orçamento deste mês (R$ 50,00) foi atingido. As campanhas pausam e voltam a sair sozinhas no dia 1º.'],
  ] as const)('o aviso de 100%% do %s diz quando volta', (periodo, corpo) => {
    expect(avisoDoOrcamento({ periodo, inicio: HOJE, nivel: 100, tetoCentavos: 5000, gastoCentavos: 4990 }, 'BRL')).toEqual({
      titulo: 'Orçamento de disparos atingido',
      corpo,
    });
  });

  it('a campanha pausada cita o teto mais apertado', () => {
    const usos = [
      uso({ gastoMicros: 49_860_000 }),
      uso({ periodo: 'mes', tetoCentavos: 100_000, gastoMicros: 300_000_000 }),
    ];
    expect(frasePausaPeloOrcamento(usos, 'BRL')).toBe('O orçamento de hoje está no limite: R$ 49,86 de R$ 50,00.');
    expect(frasePausaPeloOrcamento([usos[1]!, uso({ gastoMicros: 0 })], 'BRL')).toBe(
      'O orçamento deste mês está no limite: R$ 300,00 de R$ 1.000,00.',
    );
  });

  it('sem moeda ou sem teto: frase que não inventa valor', () => {
    expect(frasePausaPeloOrcamento([], 'BRL')).toBe('O orçamento de disparos foi atingido.');
    expect(frasePausaPeloOrcamento([uso({})], null)).toBe('O orçamento de disparos foi atingido.');
  });

  it('retomar sem folga: diz o teto cheio e o que acontece', () => {
    const usos = [uso({ gastoMicros: 49_860_000 }), uso({ periodo: 'mes', tetoCentavos: 100_000, gastoMicros: 0 })];
    expect(fraseSemFolga(usos, PRECO, 'BRL')).toBe(
      'O orçamento de hoje está no limite: R$ 49,86 de R$ 50,00. A campanha volta sozinha quando o período virar, ou antes se o dono da conta aumentar o orçamento.',
    );
  });
});

describe('orcamentoParaTela', () => {
  const tetos: Tetos = { dia: 5000, semana: null, mes: 100_000 };
  const usos = [
    uso({ gastoMicros: 12_400_000 }),
    uso({ periodo: 'mes', tetoCentavos: 100_000, gastoMicros: 870_000_000 }),
  ];

  it('os períodos com teto, com o texto, a barra e o sinal', () => {
    const tela = orcamentoParaTela(tetos, usos, 'BRL', true, true);
    expect(tela.campos).toEqual({ dia: '50,00', semana: '', mes: '1.000,00' });
    expect(tela.periodos).toEqual([
      { periodo: 'dia', rotulo: 'Hoje', tetoCentavos: 5000, gastoCentavos: 1240, percentual: 24, texto: 'R$ 12,40 de R$ 50,00', sinal: 'ok', zera: 'Zera amanhã' },
      { periodo: 'mes', rotulo: 'Este mês', tetoCentavos: 100_000, gastoCentavos: 87_000, percentual: 87, texto: 'R$ 870,00 de R$ 1.000,00', sinal: 'atencao', zera: 'Zera no dia 1º' },
    ]);
    expect(tela.avisos).toEqual([]);
    expect(tela.podeMudar).toBe(true);
  });

  it('teto cheio: a barra para em 100', () => {
    const tela = orcamentoParaTela({ dia: 5000, semana: null, mes: null }, [uso({ gastoMicros: 61_000_000 })], 'BRL', true, false);
    expect(tela.periodos[0]).toMatchObject({ percentual: 100, sinal: 'cheio', texto: 'R$ 61,00 de R$ 50,00' });
    expect(tela.podeMudar).toBe(false);
  });

  it('sem moeda, sem tarifa, ou mensagens sem tarifa: a tela diz que o orçamento não está contando', () => {
    expect(orcamentoParaTela(tetos, usos, null, true, true).avisos).toEqual([ORCAMENTO_SEM_MOEDA]);
    expect(orcamentoParaTela(tetos, usos, 'BRL', false, true).avisos).toEqual([ORCAMENTO_SEM_TARIFA]);
    expect(orcamentoParaTela(tetos, [uso({ semTarifa: 1200 })], 'BRL', true, true).avisos).toEqual([
      '1.200 mensagens enviadas não entram na conta do orçamento: ainda não temos a tarifa da Meta para elas.',
    ]);
  });

  it('conta sem teto: nada de período nem de aviso', () => {
    const tela = orcamentoParaTela({ dia: null, semana: null, mes: null }, [], null, false, true);
    expect(tela).toMatchObject({ periodos: [], avisos: [], campos: { dia: '', semana: '', mes: '' } });
  });
});
