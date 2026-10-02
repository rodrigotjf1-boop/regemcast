import {
  calcularCusto,
  categoriaNaMeta,
  custoParaTela,
  dinheiro,
  precoDaMensagem,
  SEM_MOEDA,
  tarifaPara,
  type GrupoDeMensagens,
  type TarifaDaTabela,
} from './custo.regras';

/** Valores de EXEMPLO: não são a tarifa da Meta. */
const TARIFAS: TarifaDaTabela[] = [
  { ddi: '55', categoria: 'marketing', valorMicros: 312_500, vigenteDe: '2026-04-01' },
  { ddi: '55', categoria: 'marketing', valorMicros: 321_700, vigenteDe: '2026-07-01' },
  { ddi: '55', categoria: 'marketing', valorMicros: 335_000, vigenteDe: '2027-01-01' },
  { ddi: '55', categoria: 'utility', valorMicros: 35_000, vigenteDe: '2026-07-01' },
  { ddi: '1', categoria: 'marketing', valorMicros: 137_300, vigenteDe: '2026-07-01' },
  { ddi: '1809', categoria: 'marketing', valorMicros: 400_000, vigenteDe: '2026-07-01' },
];

const grupo = (g: Partial<GrupoDeMensagens>): GrupoDeMensagens => ({
  prefixo: '5521',
  categoria: 'marketing',
  dia: '2026-10-02',
  situacao: 'a_sair',
  quantas: 1,
  ...g,
});

describe('categoriaNaMeta', () => {
  it.each([
    ['marketing', 'marketing'],
    ['utilidade', 'utility'],
    ['autenticação', 'authentication'],
    ['Autenticação', 'authentication'],
    ['MARKETING', 'marketing'],
    ['UTILITY', 'utility'],
    ['marketing_lite', 'marketing_lite'],
  ])('%s → %s', (daCampanha, esperada) => {
    expect(categoriaNaMeta(daCampanha)).toBe(esperada);
  });

  it.each([[null], [undefined], [''], ['  '], ['categoria com espaço'], [12]])('%p não é categoria', (valor) => {
    expect(categoriaNaMeta(valor)).toBeNull();
  });
});

describe('tarifaPara', () => {
  it('pega a vigência mais recente que já tinha começado no dia', () => {
    expect(tarifaPara(TARIFAS, '5521', 'marketing', '2026-10-02')?.valorMicros).toBe(321_700);
    expect(tarifaPara(TARIFAS, '5521', 'marketing', '2026-06-30')?.valorMicros).toBe(312_500);
    expect(tarifaPara(TARIFAS, '5521', 'marketing', '2027-01-01')?.valorMicros).toBe(335_000);
  });

  it('no dia da virada já vale a nova; na véspera, a anterior', () => {
    expect(tarifaPara(TARIFAS, '5511', 'marketing', '2026-07-01')?.valorMicros).toBe(321_700);
    expect(tarifaPara(TARIFAS, '5511', 'marketing', '2026-06-30')?.valorMicros).toBe(312_500);
  });

  it('antes da primeira vigência não há tarifa', () => {
    expect(tarifaPara(TARIFAS, '5521', 'marketing', '2026-03-31')).toBeNull();
  });

  it('o código de país mais longo ganha', () => {
    expect(tarifaPara(TARIFAS, '1809', 'marketing', '2026-10-02')?.valorMicros).toBe(400_000);
    expect(tarifaPara(TARIFAS, '1212', 'marketing', '2026-10-02')?.valorMicros).toBe(137_300);
  });

  it('outra categoria, outro país ou categoria desconhecida: sem tarifa', () => {
    expect(tarifaPara(TARIFAS, '5521', 'authentication', '2026-10-02')).toBeNull();
    expect(tarifaPara(TARIFAS, '3519', 'marketing', '2026-10-02')).toBeNull();
    expect(tarifaPara(TARIFAS, '5521', null, '2026-10-02')).toBeNull();
  });

  it('a categoria não se mistura: utilidade não pega o preço de marketing', () => {
    expect(tarifaPara(TARIFAS, '5521', 'utility', '2026-10-02')?.valorMicros).toBe(35_000);
    expect(tarifaPara(TARIFAS, '5521', 'utility', '2026-06-30')).toBeNull();
  });
});

describe('calcularCusto', () => {
  it('soma em micros e arredonda uma vez só', () => {
    // 3 grupos de 1 mensagem a 0,3217: grupo a grupo daria 32 + 32 + 32 = 96; a soma certa é 96,51 → 97.
    const c = calcularCusto(
      [grupo({ prefixo: '5521' }), grupo({ prefixo: '5511' }), grupo({ prefixo: '5531' })],
      TARIFAS,
    );
    expect(c.aSair).toEqual({ centavos: 97, mensagens: 3, semTarifa: 0, unitarioMicros: 321_700 });
  });

  it('a conta grande fecha no centavo', () => {
    const c = calcularCusto([grupo({ quantas: 50_000 })], TARIFAS);
    expect(c.aSair.centavos).toBe(1_608_500);
  });

  it('separa o que foi cobrado do que ainda pode sair', () => {
    const c = calcularCusto(
      [
        grupo({ situacao: 'cobrada', quantas: 100, dia: '2026-10-01' }),
        grupo({ situacao: 'a_sair', quantas: 200 }),
        grupo({ situacao: 'gratis', quantas: 12 }),
        grupo({ situacao: 'sem_aviso', quantas: 2 }),
      ],
      TARIFAS,
    );
    expect(c.gasto).toEqual({ centavos: 3217, mensagens: 100, semTarifa: 0, unitarioMicros: 321_700 });
    expect(c.aSair).toEqual({ centavos: 6434, mensagens: 200, semTarifa: 0, unitarioMicros: 321_700 });
    expect(c.gratis).toBe(12);
    expect(c.semAviso).toBe(2);
  });

  it('a cobrada sai pela tarifa do dia da entrega, não pela de hoje', () => {
    const c = calcularCusto(
      [
        grupo({ situacao: 'cobrada', quantas: 10, dia: '2026-06-30' }),
        grupo({ situacao: 'cobrada', quantas: 10, dia: '2026-07-01' }),
      ],
      TARIFAS,
    );
    // 10 × 0,3125 + 10 × 0,3217
    expect(c.gasto.centavos).toBe(634);
    expect(c.gasto.unitarioMicros).toBeNull();
  });

  it('mensagem sem tarifa NÃO vira zero: sai da soma e é contada à parte', () => {
    const c = calcularCusto(
      [grupo({ quantas: 10 }), grupo({ prefixo: '3519', quantas: 4 }), grupo({ categoria: null, quantas: 3 })],
      TARIFAS,
    );
    expect(c.aSair).toEqual({ centavos: 322, mensagens: 10, semTarifa: 7, unitarioMicros: 321_700 });
  });

  it('a categoria que a Meta cobrou pode ser outra que a do modelo', () => {
    const c = calcularCusto([grupo({ situacao: 'cobrada', categoria: 'utility', quantas: 100 })], TARIFAS);
    expect(c.gasto.centavos).toBe(350);
  });

  it('ignora grupo vazio ou com quantidade que não é número', () => {
    const c = calcularCusto([grupo({ quantas: 0 }), grupo({ quantas: -3 }), grupo({ quantas: Number.NaN })], TARIFAS);
    expect(c.aSair).toEqual({ centavos: 0, mensagens: 0, semTarifa: 0, unitarioMicros: null });
  });
});

describe('dinheiro e precoDaMensagem', () => {
  it.each([
    [0, 'BRL', 'R$ 0,00'],
    [5, 'BRL', 'R$ 0,05'],
    [9651, 'BRL', 'R$ 96,51'],
    [123_456_789, 'BRL', 'R$ 1.234.567,89'],
    [9651, 'USD', 'USD 96,51'],
  ])('%d centavos em %s → %s', (centavos, moeda, texto) => {
    expect(dinheiro(centavos, moeda)).toBe(texto);
  });

  it.each([
    [321_700, 'R$ 0,3217'],
    [35_000, 'R$ 0,035'],
    [300_000, 'R$ 0,30'],
    [1_000_000, 'R$ 1,00'],
    [31_500, 'R$ 0,0315'],
    [123_456, 'R$ 0,123456'],
  ])('%d micros → %s', (micros, texto) => {
    expect(precoDaMensagem(micros, 'BRL')).toBe(texto);
  });
});

describe('custoParaTela', () => {
  it('antes de disparar: uma linha, o teto, e de onde ele saiu', () => {
    const tela = custoParaTela(calcularCusto([grupo({ quantas: 300 })], TARIFAS), 'BRL', 'antes');
    expect(tela.linhas).toEqual([
      { rotulo: 'Custo estimado na Meta', valor: 'até R$ 96,51', detalhe: '300 mensagens × R$ 0,3217' },
    ]);
    expect(tela.avisos).toEqual([]);
    expect(tela.nota).toMatch(/só a mensagem entregue/);
    expect(tela).toMatchObject({ moeda: 'BRL', aSairCentavos: 9651 });
  });

  it('uma mensagem só: singular', () => {
    const tela = custoParaTela(calcularCusto([grupo({ quantas: 1 })], TARIFAS), 'BRL', 'antes');
    expect(tela.linhas[0]!.detalhe).toBe('1 mensagem × R$ 0,3217');
  });

  it('países com preços diferentes: não inventa um preço único', () => {
    const tela = custoParaTela(
      calcularCusto([grupo({ quantas: 10 }), grupo({ prefixo: '1212', quantas: 10 })], TARIFAS),
      'BRL',
      'antes',
    );
    expect(tela.linhas[0]!.detalhe).toBe('20 mensagens, com preços diferentes por país');
  });

  it('saindo: o gasto até agora e o que ainda pode sair', () => {
    const tela = custoParaTela(
      calcularCusto(
        [
          grupo({ situacao: 'cobrada', quantas: 1100 }),
          grupo({ situacao: 'gratis', quantas: 12 }),
          grupo({ situacao: 'a_sair', quantas: 200 }),
        ],
        TARIFAS,
      ),
      'BRL',
      'saindo',
    );
    expect(tela.linhas).toEqual([
      { rotulo: 'Gasto na Meta até agora', valor: 'R$ 353,87', detalhe: '1.100 mensagens cobradas · 12 sem custo' },
      { rotulo: 'Ainda pode sair', valor: 'até R$ 64,34', detalhe: '200 mensagens × R$ 0,3217' },
    ]);
  });

  it('disparada e nada cobrado ainda: zero é zero, e a tela diz', () => {
    const tela = custoParaTela(calcularCusto([grupo({ quantas: 50 })], TARIFAS), 'BRL', 'saindo');
    expect(tela.linhas[0]).toEqual({
      rotulo: 'Gasto na Meta até agora',
      valor: 'R$ 0,00',
      detalhe: 'Nenhuma mensagem cobrada até agora',
    });
    expect(tela.gastoCentavos).toBe(0);
  });

  it('encerrada: o gasto, sem "até agora"', () => {
    const tela = custoParaTela(calcularCusto([grupo({ situacao: 'cobrada', quantas: 1 })], TARIFAS), 'BRL', 'encerrada');
    expect(tela.linhas).toEqual([{ rotulo: 'Gasto na Meta', valor: 'R$ 0,32', detalhe: '1 mensagem cobrada' }]);

    const nada = custoParaTela(calcularCusto([grupo({ situacao: 'gratis', quantas: 3 })], TARIFAS), 'BRL', 'encerrada');
    expect(nada.linhas[0]!.detalhe).toBe('Nenhuma mensagem cobrada · 3 sem custo');
  });

  it('sem moeda: não mostra valor nenhum, e diz por quê', () => {
    const tela = custoParaTela(calcularCusto([grupo({ quantas: 300 })], TARIFAS), null, 'antes');
    expect(tela).toEqual({ moeda: null, gastoCentavos: null, aSairCentavos: null, linhas: [], avisos: [SEM_MOEDA], nota: null });
  });

  it('sem tarifa nenhuma: não mostra R$ 0,00 — diz que não sabe', () => {
    const antes = custoParaTela(calcularCusto([grupo({ quantas: 300 })], []), 'BRL', 'antes');
    expect(antes.linhas).toEqual([]);
    expect(antes.avisos).toEqual([
      'Ainda não temos a tarifa da Meta para este tipo de mensagem: não dá para estimar o custo.',
    ]);
    expect(antes.aSairCentavos).toBeNull();
    expect(antes.nota).toBeNull();

    const depois = custoParaTela(calcularCusto([grupo({ situacao: 'cobrada', quantas: 300 })], []), 'BRL', 'encerrada');
    expect(depois.linhas).toEqual([]);
    expect(depois.gastoCentavos).toBeNull();
    expect(depois.avisos[0]).toMatch(/não dá para calcular o custo/);
  });

  it('parte sem tarifa: mostra o que sabe e conta o que ficou de fora', () => {
    const tela = custoParaTela(
      calcularCusto([grupo({ quantas: 10 }), grupo({ prefixo: '3519', quantas: 4 })], TARIFAS),
      'BRL',
      'antes',
    );
    expect(tela.linhas[0]!.valor).toBe('até R$ 3,22');
    expect(tela.avisos).toEqual([
      '4 mensagens ficaram fora da conta: ainda não temos a tarifa da Meta para elas (outro país ou outro tipo de mensagem).',
    ]);
    expect(tela.aSairCentavos).toBeNull();
  });

  it('entregue sem o aviso de cobrança: não entra no gasto, e a tela conta', () => {
    const tela = custoParaTela(
      calcularCusto([grupo({ situacao: 'cobrada', quantas: 1 }), grupo({ situacao: 'sem_aviso', quantas: 2 })], TARIFAS),
      'BRL',
      'encerrada',
    );
    expect(tela.linhas[0]!.valor).toBe('R$ 0,32');
    expect(tela.avisos).toEqual(['A Meta não disse se cobrou 2 mensagens entregues: elas não entram no gasto.']);
  });

  it('campanha sem ninguém: nada a mostrar', () => {
    for (const fase of ['antes', 'saindo', 'encerrada'] as const) {
      expect(custoParaTela(calcularCusto([], TARIFAS), 'BRL', fase)).toMatchObject({ linhas: [], avisos: [], nota: null });
      expect(custoParaTela(calcularCusto([], TARIFAS), null, fase)).toMatchObject({ linhas: [], avisos: [] });
    }
  });
});
