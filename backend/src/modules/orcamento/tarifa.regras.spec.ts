/**
 * As regras da tarifa da Meta: o que o operador digita, e a conta do dinheiro.
 *
 * O que estes testes trancam:
 *
 *   1. a conta é exata — sem o centavo a mais ou a menos do ponto flutuante;
 *   2. preço que parece erro de digitação não entra (vírgula no lugar errado);
 *   3. o texto que o banco devolve volta ao mesmo valor que entrou.
 */
import { conferirTarifa, custoEmCentavos, microsParaNumeric, numericParaMicros, paraMicros } from './tarifa.regras';

describe('paraMicros — o preço de uma mensagem, do jeito que o operador digita', () => {
  it.each([
    ['0,3217', 321_700],
    ['0.3217', 321_700],
    ['R$ 0,0350', 35_000],
    ['0,035', 35_000],
    ['1', 1_000_000],
    ['0,000001', 1],
    ['12,5', 12_500_000],
    [' 0,32 ', 320_000],
  ])('%p → %d micros', (texto, esperado) => {
    expect(paraMicros(texto)).toBe(esperado);
  });

  it.each(['', '0', '0,0', '-1', 'abc', '0,1234567', '1.000,50', '1000', '0,3,2', null, undefined])(
    '%p não é um preço por mensagem: nulo',
    (texto) => {
      expect(paraMicros(texto)).toBeNull();
    },
  );
});

describe('micros ↔ numeric do banco', () => {
  it.each([
    [321_700, '0.321700'],
    [35_000, '0.035000'],
    [1, '0.000001'],
    [12_500_000, '12.500000'],
  ])('%d micros ↔ %s', (micros, numeric) => {
    expect(microsParaNumeric(micros)).toBe(numeric);
    expect(numericParaMicros(numeric)).toBe(micros);
  });

  it('o que o banco não devolveu vira zero, e zero não custa nada', () => {
    expect(numericParaMicros(null)).toBe(0);
    expect(custoEmCentavos(numericParaMicros(null), 100)).toBe(0);
  });
});

describe('custoEmCentavos — a conta, sem ponto flutuante', () => {
  it('multiplica e arredonda UMA vez, no total', () => {
    // 4.820 mensagens a R$ 0,3217 = R$ 1.550,594 → 155.059 centavos.
    expect(custoEmCentavos(321_700, 4_820)).toBe(155_059);
    // 932 a R$ 0,3217 = R$ 299,8244 → 29.982 centavos.
    expect(custoEmCentavos(321_700, 932)).toBe(29_982);
  });

  it('o caso em que o ponto flutuante erra: 0,1 + 0,2', () => {
    // Em `number`, 3 × 0.1 = 0.30000000000000004. Em micros, é 30 centavos e pronto.
    expect(custoEmCentavos(paraMicros('0,1')!, 3)).toBe(30);
    expect(custoEmCentavos(paraMicros('0,035')!, 1_000_000)).toBe(3_500_000);
  });

  it('uma mensagem de fração de centavo arredonda para o centavo mais próximo', () => {
    expect(custoEmCentavos(35_000, 1)).toBe(4); // R$ 0,035 → 4 centavos
    expect(custoEmCentavos(4_000, 1)).toBe(0); // R$ 0,004 → 0
    expect(custoEmCentavos(4_000, 3)).toBe(1); // R$ 0,012 → 1
  });

  it('nada a enviar, ou sem tarifa: zero', () => {
    expect(custoEmCentavos(321_700, 0)).toBe(0);
    expect(custoEmCentavos(0, 100)).toBe(0);
    expect(custoEmCentavos(321_700, -5)).toBe(0);
    expect(custoEmCentavos(Number.NaN, 5)).toBe(0);
  });
});

describe('conferirTarifa — o que o console aceita', () => {
  const boa = { moeda: 'brl', ddi: '+55', categoria: 'Marketing', valor: '0,3217', vigenteDe: '2026-07-01', fonte: ' Arquivo BRL de 01/07/2026 ' };

  it('normaliza: moeda em maiúsculas, DDI sem o +, categoria em minúsculas, fonte aparada', () => {
    expect(conferirTarifa(boa)).toEqual({
      moeda: 'BRL',
      ddi: '55',
      categoria: 'marketing',
      valorMicros: 321_700,
      vigenteDe: '2026-07-01',
      fonte: 'Arquivo BRL de 01/07/2026',
    });
  });

  it('categoria nova da Meta, no formato dela, entra', () => {
    expect(conferirTarifa({ ...boa, categoria: 'authentication-international' })).toMatchObject({ categoria: 'authentication-international' });
  });

  it.each([
    [{ moeda: 'REAL' }, /moeda com três letras/],
    [{ moeda: '' }, /moeda com três letras/],
    [{ ddi: 'BR' }, /código do país/],
    [{ ddi: '055' }, /código do país/],
    [{ ddi: '55555' }, /código do país/],
    [{ categoria: 'Marketing e vendas' }, /categoria como a Meta escreve/],
    [{ valor: '32,17' }, undefined],
    [{ valor: '0' }, /preço de UMA mensagem/],
    // Ponto é separador decimal: "1.000" é 1 (uma unidade da moeda), não mil.
    [{ valor: '1.000' }, undefined],
    [{ valor: '1000' }, /preço de UMA mensagem/],
    [{ valor: 'trinta' }, /preço de UMA mensagem/],
    [{ vigenteDe: '01/07/2026' }, /data em que o valor passa a valer/],
    [{ vigenteDe: '2026-13-40' }, /data em que o valor passa a valer/],
    [{ vigenteDe: '' }, /data em que o valor passa a valer/],
  ])('%j', (mudanca, erro) => {
    const r = conferirTarifa({ ...boa, ...mudanca });
    if (erro) expect(r).toEqual({ erro: expect.stringMatching(erro) });
    else expect('erro' in r).toBe(false);
  });

  it('sem fonte: nulo, e não texto vazio', () => {
    expect(conferirTarifa({ ...boa, fonte: '   ' })).toMatchObject({ fonte: null });
  });
});
