/**
 * As regras da integração com o Regem, no contrato pedido ao projeto Regem em
 * 30/09/2026 (`/api/v1/integracao/clientes` e `/pedidos`, snake_case, dinheiro
 * em centavos, telefone E.164 com `+55`).
 */
import {
  bairroDoRegem,
  compraDaVenda,
  decidirCliente,
  escoposQueFaltam,
  lojaDaResposta,
  telefoneDoRegem,
  tipoDaVenda,
  type ClienteRegem,
  type VendaRegem,
} from './regem.regras';

const SEM_99 = { incluir99: false };
const COM_99 = { incluir99: true };

describe('telefoneDoRegem', () => {
  it('E.164 do Regem vira o formato do contato (sem o +)', () => {
    expect(telefoneDoRegem('+5521989751705')).toBe('5521989751705');
    expect(telefoneDoRegem('5521989751705')).toBe('5521989751705');
    expect(telefoneDoRegem('+55 (21) 98975-1705')).toBe('5521989751705');
  });

  it('0800 (o número mascarado do marketplace), vazio e inválido não servem', () => {
    expect(telefoneDoRegem('08007001234')).toBe('');
    expect(telefoneDoRegem('+5508007001234')).toBe('');
    expect(telefoneDoRegem(null)).toBe('');
    expect(telefoneDoRegem('')).toBe('');
    expect(telefoneDoRegem('+5521')).toBe('');
  });
});

describe('bairroDoRegem e tipoDaVenda', () => {
  it('a distância que a loja por quilômetro guarda no lugar do bairro não é bairro', () => {
    expect(bairroDoRegem('~3.2 km')).toBeNull();
    expect(bairroDoRegem('3,5 km')).toBeNull();
    expect(bairroDoRegem('  Tijuca ')).toBe('Tijuca');
    expect(bairroDoRegem(null)).toBeNull();
  });

  it('balcão e mesa contam como salão; o desconhecido e o vazio, como outro (a coluna não aceita vazio)', () => {
    expect(tipoDaVenda('entrega')).toBe('entrega');
    expect(tipoDaVenda('RETIRADA')).toBe('retirada');
    expect(tipoDaVenda('balcao')).toBe('salao');
    expect(tipoDaVenda('mesa')).toBe('salao');
    expect(tipoDaVenda('drive_thru')).toBe('outro');
    expect(tipoDaVenda(null)).toBe('outro');
  });
});

describe('lojaDaResposta e escoposQueFaltam', () => {
  it('token da empresa: a empresa, as lojas (sem id não entra) e os escopos', () => {
    expect(
      lojaDaResposta({
        empresa_id: 'e1',
        empresa_nome: ' Grupo  Sabor ',
        lojas: [{ id: 'l1', nome: 'Centro' }, { id: '', nome: 'Sem id' }, { id: 'l2', nome: 'Tijuca' }],
        escopos: ['clientes.ler', 'pedidos.ler'],
      }),
    ).toEqual({
      empresaId: 'e1',
      empresaNome: 'Grupo Sabor',
      lojas: [
        { id: 'l1', nome: 'Centro' },
        { id: 'l2', nome: 'Tijuca' },
      ],
      escopos: ['clientes.ler', 'pedidos.ler'],
    });
  });

  it('token de uma loja (o formato de hoje): a loja vira a lista', () => {
    expect(lojaDaResposta({ loja_id: 'l1', loja_nome: 'Centro', empresa_nome: 'Grupo Sabor', escopos: ['pedidos.ler'] })).toEqual({
      empresaId: null,
      empresaNome: 'Grupo Sabor',
      lojas: [{ id: 'l1', nome: 'Centro' }],
      escopos: ['pedidos.ler'],
    });
    expect(lojaDaResposta(null).empresaNome).toBe('Empresa no Regem');
  });

  it('a conexão precisa de clientes, vendas e telefone', () => {
    expect(escoposQueFaltam(['pedidos.ler'])).toEqual(['clientes.ler', 'clientes.telefone.ler']);
    expect(escoposQueFaltam(['clientes.ler', 'pedidos.ler', 'clientes.telefone.ler', 'vendas.99food.ler'])).toEqual([]);
  });
});

describe('decidirCliente', () => {
  const base: ClienteRegem = { id: 'c1', nome: '  Ana   Souza ', telefone: '+5521989751705', canais: ['cardapio'] };

  it('cliente de canal próprio vira contato, com a declaração do dono (sem aceite do cliente)', () => {
    expect(decidirCliente(base, SEM_99)).toEqual({
      tipo: 'contato',
      regemId: 'c1',
      telefone: '5521989751705',
      nome: 'Ana Souza',
      canais: ['cardapio'],
      so99: false,
      aceite: null,
    });
  });

  it('o aceite que o próprio cliente deu no Regem vai junto (data, origem, texto)', () => {
    const d = decidirCliente(
      { ...base, aceite_marketing: { aceito: true, em: '2026-09-30T12:00:00Z', origem: 'cardapio_checkout', texto: 'Quero receber promoções' } },
      SEM_99,
    );
    expect(d).toMatchObject({
      tipo: 'contato',
      aceite: { em: new Date('2026-09-30T12:00:00Z'), origem: 'cardapio_checkout', texto: 'Quero receber promoções' },
    });
  });

  it('pediu para sair no Regem, ou recusou o aceite: bloqueado', () => {
    expect(decidirCliente({ ...base, opt_out: { ativo: true } }, SEM_99)).toMatchObject({ tipo: 'bloqueado', telefone: '5521989751705' });
    expect(decidirCliente({ ...base, aceite_marketing: { aceito: false } }, SEM_99)).toMatchObject({ tipo: 'bloqueado' });
    expect(decidirCliente({ ...base, opt_out: { ativo: false } }, SEM_99)).toMatchObject({ tipo: 'contato' });
  });

  it('só comprou pela 99: fica de fora sem a autorização do dono; com ela, entra marcado', () => {
    const so99: ClienteRegem = { ...base, canais: ['99food'] };
    expect(decidirCliente(so99, SEM_99)).toEqual({ tipo: 'ignorado', regemId: 'c1', motivo: 'so_99' });
    expect(decidirCliente(so99, COM_99)).toMatchObject({ tipo: 'contato', so99: true });
  });

  it('99 e outro marketplace, sem canal próprio: a relação é a da 99 (entra só autorizada)', () => {
    const mista: ClienteRegem = { ...base, canais: ['ifood', '99food'] };
    expect(decidirCliente(mista, SEM_99)).toMatchObject({ tipo: 'ignorado', motivo: 'so_99' });
    expect(decidirCliente(mista, COM_99)).toMatchObject({ tipo: 'contato', so99: true });
  });

  it('só marketplace (sem a 99) nunca entra, nem com a 99 autorizada', () => {
    expect(decidirCliente({ ...base, canais: ['ifood', 'keeta'] }, COM_99)).toMatchObject({ tipo: 'ignorado', motivo: 'marketplace' });
  });

  it('comprou pela 99 E por canal próprio: é da loja, entra sempre (e não é só-99)', () => {
    expect(decidirCliente({ ...base, canais: ['99food', 'anotaai'] }, SEM_99)).toMatchObject({ tipo: 'contato', so99: false });
  });

  it('sem canal nenhum (cadastrou no cardápio e ainda não pediu): é da loja', () => {
    expect(decidirCliente({ ...base, canais: [] }, SEM_99)).toMatchObject({ tipo: 'contato', so99: false });
    expect(decidirCliente({ ...base, canais: null }, SEM_99)).toMatchObject({ tipo: 'contato' });
  });

  it('lápide vence tudo — mesmo sem telefone (o Regem já apagou)', () => {
    expect(decidirCliente({ id: 'c9', removido: true, telefone: null }, SEM_99)).toEqual({ tipo: 'removido', regemId: 'c9' });
  });

  it('telefone que não serve: inválido', () => {
    expect(decidirCliente({ ...base, telefone: '08001234567' }, SEM_99)).toEqual({ tipo: 'invalido', regemId: 'c1' });
  });
});

describe('compraDaVenda', () => {
  const venda: VendaRegem = {
    id: 'v1',
    atualizado_em: '2026-09-29T20:05:00Z',
    canal: 'cardapio',
    situacao: 'confirmado',
    receita_centavos: 5050,
    cliente: { id: 'c1', telefone: '+5521989751705' },
    criado_em: '2026-09-29T19:00:00Z',
    confirmado_em: '2026-09-29T19:01:00Z',
    faturado_em: '2026-09-29T19:30:00Z',
    tipo: 'entrega',
    bairro: 'Tijuca',
    itens: [
      { nome: 'X-bacon', quantidade: '2.000', receita_centavos: 4000 },
      { nome: 'Refri', quantidade: 1, receita_centavos: 1050 },
      { nome: '', quantidade: 1, receita_centavos: 500 },
      { nome: 'Brinde', quantidade: 0, receita_centavos: 0 },
    ],
  };

  it('confirmada vira compra: faturamento em centavos, data de faturamento, tipo, canal, bairro e itens', () => {
    expect(compraDaVenda(venda, { incluir99: false, cardapioWebDireto: false })).toEqual({
      idExterno: 'v1',
      telefone: '5521989751705',
      feitaEm: new Date('2026-09-29T19:30:00Z'),
      valorCentavos: 5050,
      tipo: 'entrega',
      canal: 'cardapio',
      bairro: 'Tijuca',
      itens: [
        { n: 'X-bacon', q: 2, v: 4000 },
        { n: 'Refri', q: 1, v: 1050 },
      ],
      atualizadaNaFonte: new Date('2026-09-29T20:05:00Z'),
    });
  });

  it('sem faturamento, vale a confirmação; sem ela, a criação; sem data nenhuma, fica de fora', () => {
    const semFatura = { ...venda, faturado_em: null };
    expect(compraDaVenda(semFatura, { incluir99: false, cardapioWebDireto: false })).toMatchObject({ feitaEm: new Date('2026-09-29T19:01:00Z') });
    expect(compraDaVenda({ ...semFatura, confirmado_em: null }, { incluir99: false, cardapioWebDireto: false })).toMatchObject({
      feitaEm: new Date('2026-09-29T19:00:00Z'),
    });
    expect(compraDaVenda({ ...semFatura, confirmado_em: null, criado_em: null }, { incluir99: false, cardapioWebDireto: false })).toEqual({
      ignorado: 'sem_data',
    });
  });

  it('cancelada ou removida desfaz a compra; aberta ainda não conta', () => {
    const o = { incluir99: false, cardapioWebDireto: false };
    expect(compraDaVenda({ ...venda, situacao: 'cancelado' }, o)).toEqual({ desfazer: 'v1' });
    expect(compraDaVenda({ ...venda, situacao: 'removido' }, o)).toEqual({ desfazer: 'v1' });
    expect(compraDaVenda({ ...venda, situacao: 'aberto' }, o)).toEqual({ ignorado: 'nao_confirmado' });
  });

  it('marketplace fica de fora; a 99 só com a autorização do dono', () => {
    expect(compraDaVenda({ ...venda, canal: 'ifood' }, { incluir99: true, cardapioWebDireto: false })).toEqual({ ignorado: 'marketplace' });
    expect(compraDaVenda({ ...venda, canal: '99food' }, { incluir99: false, cardapioWebDireto: false })).toEqual({ ignorado: 'marketplace' });
    expect(compraDaVenda({ ...venda, canal: '99food' }, { incluir99: true, cardapioWebDireto: false })).toMatchObject({ canal: '99food' });
  });

  it('venda do Cardápio Web: fica de fora quando a loja já liga o Cardápio Web direto aqui (não conta duas vezes)', () => {
    const cw = { ...venda, canal: 'cardapio_web' };
    expect(compraDaVenda(cw, { incluir99: false, cardapioWebDireto: true })).toEqual({ ignorado: 'cardapio_web_duplicado' });
    expect(compraDaVenda(cw, { incluir99: false, cardapioWebDireto: false })).toMatchObject({ canal: 'cardapio_web' });
  });

  it('sem cliente ou sem telefone que sirva: fica de fora', () => {
    const o = { incluir99: false, cardapioWebDireto: false };
    expect(compraDaVenda({ ...venda, cliente: null }, o)).toEqual({ ignorado: 'sem_cliente' });
    expect(compraDaVenda({ ...venda, cliente: { id: 'c1', telefone: null } }, o)).toEqual({ ignorado: 'sem_cliente' });
  });

  it('no máximo 30 itens por compra', () => {
    const muitos = { ...venda, itens: Array.from({ length: 40 }, (_, i) => ({ nome: `Item ${i}`, quantidade: 1, receita_centavos: 100 })) };
    const c = compraDaVenda(muitos, { incluir99: false, cardapioWebDireto: false });
    expect('itens' in c && c.itens.length).toBe(30);
  });
});
