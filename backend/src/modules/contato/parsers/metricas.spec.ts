/**
 * Colunas extras das exportações de cardápio: e-mail, aniversário, pedidos,
 * total gasto e última compra. Cada sistema dá um título diferente, e um número
 * lido errado vira cliente "Campeão" que nunca comprou.
 */
import { campoDoTitulo, detectarExtras, lerData, lerDinheiro, lerExtras, rotulosExtras } from './metricas';
import { detectarColunas } from './tabela';

describe('campoDoTitulo', () => {
  it.each([
    ['E-mail', 'email'],
    ['Email', 'email'],
    ['Data de nascimento', 'nascimento'],
    ['Aniversário', 'nascimento'],
    ['Qtd. pedidos', 'pedidos'],
    ['Total de pedidos', 'pedidos'],
    ['Quantidade de compras', 'pedidos'],
    ['Total gasto', 'total'],
    ['Valor total', 'total'],
    ['Faturamento', 'total'],
    ['Última compra', 'ultimoPedido'],
    ['Data do último pedido', 'ultimoPedido'],
    ['Dias sem comprar', 'diasInativo'],
    ['Dias inativo', 'diasInativo'],
    ['Recência', 'diasInativo'],
  ])('"%s" → %s', (titulo, campo) => {
    expect(campoDoTitulo(titulo)).toBe(campo);
  });

  it.each(['Ticket médio', 'Média de dias entre pedidos', 'Bairro', 'Cidade'])('"%s" não é campo', (titulo) => {
    expect(campoDoTitulo(titulo)).toBeNull();
  });
});

describe('telefone × "Número de pedidos"', () => {
  it('"Número de pedidos" não vira a coluna de telefone', () => {
    const linhas = [
      ['Nome', 'WhatsApp', 'Número de pedidos'],
      ['Ana', '(21) 99999-8888', '12'],
    ];
    const c = detectarColunas(linhas);
    expect(c.telefone).toBe(1);
    expect(detectarExtras(linhas[0], [c.telefone, c.nome]).pedidos).toBe(2);
  });
});

describe('valores', () => {
  it.each([
    ['R$ 1.234,56', 123456],
    ['1234,5', 123450],
    ['1234.56', 123456],
    ['R$ 89,90', 8990],
    ['1.234', 123400],
    ['-', undefined],
    ['', undefined],
  ])('dinheiro "%s" → %s centavos', (bruto, centavos) => {
    expect(lerDinheiro(bruto)).toBe(centavos);
  });

  it.each([
    ['12/03/1990', '1990-03-12'],
    ['1990-03-12', '1990-03-12'],
    ['31/02/2024', undefined],
    ['45000', '2023-03-15'],
    ['-', undefined],
  ])('data "%s" → %s', (bruto, iso) => {
    expect(lerData(bruto)).toBe(iso);
  });
});

describe('lerExtras', () => {
  const hoje = new Date('2026-09-19T15:00:00Z');
  const cab = ['Cliente', 'Contato', 'E-mail', 'Pedidos', 'Total gasto', 'Dias sem comprar'];
  const colunas = detectarExtras(cab, [1, 0]);

  it('lê a linha inteira e converte dias em data da última compra', () => {
    expect(lerExtras(['Ana', '21999998888', 'Ana@Loja.com', '14', 'R$ 1.020,00', '30'], colunas, hoje)).toEqual({
      email: 'ana@loja.com',
      pedidos: 14,
      totalGastoCentavos: 102000,
      ultimoPedidoEm: '2026-08-20T12:00:00.000Z',
    });
  });

  it('valor ilegível fica vazio, nunca inventado', () => {
    expect(lerExtras(['Bia', '21988887777', 'sem email', 'muitos', 'grátis', ''], colunas, hoje)).toEqual({});
  });

  it('diz na prévia o que veio junto', () => {
    expect(rotulosExtras(colunas)).toEqual(['e-mail', 'pedidos', 'total gasto', 'última compra']);
  });
});
