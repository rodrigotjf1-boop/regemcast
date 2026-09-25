/**
 * Os pedidos seguem o exemplo da documentação oficial do Cardápio Web
 * (`GET /orders/{id}`, conferido em 25/09/2026).
 */
import {
  centavos,
  compraDoPedido,
  fimDaJanela,
  HORAS_MAXIMAS_DE_CONSULTA,
  inicioMaisAntigo,
  progressoDaCarga,
  tipoDaCompra,
  type PedidoDetalhe,
} from './cardapioweb.pedidos.regras';

const EXEMPLO: PedidoDetalhe = {
  id: 7637462,
  status: 'closed',
  order_type: 'delivery',
  sales_channel: 'catalog',
  total: 103.8,
  created_at: '2023-06-25T10:40:33.744-03:00',
  updated_at: '2023-06-25T10:40:34.207-03:00',
  customer: { id: 991, name: '  Maria  da Silva ', phone: '21989751705', ddi: '55' },
  delivery_address: { neighborhood: 'Tijuca' },
  items: [
    { name: 'Hamburguer', quantity: 2, total_price: 103.8 },
    { name: '', quantity: 1, total_price: 5 },
    { name: 'Brinde', quantity: 0, total_price: 0 },
  ],
};

describe('compraDoPedido', () => {
  it('pedido fechado vira compra: centavos, tipo, bairro, itens e a data do pedido', () => {
    expect(compraDoPedido(EXEMPLO)).toEqual({
      idExterno: '7637462',
      telefone: '5521989751705',
      clienteId: '991',
      nome: 'Maria da Silva',
      feitaEm: new Date('2023-06-25T10:40:33.744-03:00'),
      valorCentavos: 10380,
      tipo: 'entrega',
      canal: 'catalog',
      bairro: 'Tijuca',
      itens: [{ n: 'Hamburguer', q: 2, v: 10380 }],
      atualizadaNaFonte: new Date('2023-06-25T10:40:34.207-03:00'),
    });
  });

  it('só pedido FECHADO conta', () => {
    for (const status of ['confirmed', 'canceled', 'waiting_confirmation', 'delivered', null]) {
      expect(compraDoPedido({ ...EXEMPLO, status })).toEqual({ ignorado: 'nao_fechado' });
    }
  });

  it('marketplace fica de fora — o cliente é do marketplace', () => {
    for (const canal of ['ifood', 'iFood', 'food99', '99food', 'keeta', 'aiqfome']) {
      expect(compraDoPedido({ ...EXEMPLO, sales_channel: canal })).toEqual({ ignorado: 'marketplace' });
    }
  });

  it('sem cliente, sem telefone ou com o 0800 mascarado: fica de fora', () => {
    expect(compraDoPedido({ ...EXEMPLO, customer: null })).toEqual({ ignorado: 'sem_telefone' });
    expect(compraDoPedido({ ...EXEMPLO, customer: { phone: '' } })).toEqual({ ignorado: 'sem_telefone' });
    expect(compraDoPedido({ ...EXEMPLO, customer: { phone: '08007001234', ddi: '55' } })).toEqual({ ignorado: 'sem_telefone' });
  });

  it('data que não se lê: fica de fora (não inventa data)', () => {
    expect(compraDoPedido({ ...EXEMPLO, created_at: 'ontem' })).toEqual({ ignorado: 'sem_data' });
  });

  it('corta o que passa do necessário: 30 itens, nome de 80 letras', () => {
    const muitos = Array.from({ length: 40 }, (_, i) => ({ name: `Item ${i} ${'x'.repeat(100)}`, quantity: 1, total_price: 1 }));
    const c = compraDoPedido({ ...EXEMPLO, items: muitos });
    expect('itens' in c && c.itens).toHaveLength(30);
    expect('itens' in c && c.itens[0]!.n.length).toBe(80);
  });
});

describe('centavos', () => {
  it('sem erro de ponto flutuante', () => {
    expect(centavos(103.8)).toBe(10380);
    expect(centavos(0.1 + 0.2)).toBe(30);
    expect(centavos('12,90')).toBe(1290);
    expect(centavos('abc')).toBe(0);
    expect(centavos(-5)).toBe(0);
  });
});

describe('tipoDaCompra', () => {
  it('traduz o tipo do pedido', () => {
    expect(tipoDaCompra('delivery')).toBe('entrega');
    expect(tipoDaCompra('takeout')).toBe('retirada');
    expect(tipoDaCompra('onsite')).toBe('salao');
    expect(tipoDaCompra('closed_table')).toBe('salao');
    expect(tipoDaCompra('drone')).toBe('outro');
  });
});

describe('janelas da carga', () => {
  const de = new Date('2023-01-01T00:00:00Z');
  const ate = new Date('2024-01-01T00:00:00Z');

  it('janela de 180 dias, sem passar do fim', () => {
    expect(fimDaJanela(de, ate)).toEqual(new Date('2023-06-30T00:00:00Z'));
    expect(fimDaJanela(new Date('2023-12-01T00:00:00Z'), ate)).toEqual(ate);
  });

  it('progresso pela posição da janela e da página', () => {
    expect(progressoDaCarga(de, ate, de, 0, null)).toBe(0);
    expect(progressoDaCarga(de, ate, de, 5, 10)).toBe(24);
    expect(progressoDaCarga(de, ate, ate, 0, null)).toBe(100);
  });
});

describe('limites da API', () => {
  it('o início mais antigo fica DENTRO dos 3 anos, com 2 dias de folga', () => {
    expect(inicioMaisAntigo(new Date('2026-09-25T12:00:00Z'))).toEqual(new Date('2023-09-27T12:00:00Z'));
  });

  it('a consulta de alterados só devolve 8 h: o buraco maior que 7 h vai para a carga', () => {
    expect(HORAS_MAXIMAS_DE_CONSULTA).toBeLessThan(8);
  });
});
