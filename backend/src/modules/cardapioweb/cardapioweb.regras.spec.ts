/**
 * Quem do Cardápio Web vira contato, quem entra descadastrado e quem fica fora.
 *
 * O erro caro aqui é mandar campanha para quem desligou o WhatsApp na loja —
 * ou transformar um celular gaúcho (DDD 55) em número inválido por confundir o
 * DDD com o DDI.
 */
import { decidir, saldoDoCliente, saldosDaPagina, separarPagina, telefoneDoCliente } from './cardapioweb.regras';

describe('telefoneDoCliente', () => {
  it('junta DDI e número', () => {
    expect(telefoneDoCliente({ ddi: '55', phone_number: '11999998888' })).toBe('5511999998888');
  });

  it('não confunde o DDD 55 (RS) com o DDI', () => {
    expect(telefoneDoCliente({ ddi: '55', phone_number: '55999998888' })).toBe('5555999998888');
  });

  it('aceita número que já traz o DDI', () => {
    expect(telefoneDoCliente({ ddi: '55', phone_number: '5521988887777' })).toBe('5521988887777');
  });

  it('sem DDI assume Brasil, como a importação de arquivo', () => {
    expect(telefoneDoCliente({ ddi: null, phone_number: '(21) 98888-7777' })).toBe('5521988887777');
  });

  it('recusa 0800 (número mascarado de marketplace) e vazio', () => {
    expect(telefoneDoCliente({ ddi: '55', phone_number: '08007270600' })).toBe('');
    expect(telefoneDoCliente({ ddi: '55', phone_number: '' })).toBe('');
    expect(telefoneDoCliente({ ddi: '55', phone_number: null })).toBe('');
  });
});

describe('decidir', () => {
  it('WhatsApp liberado vira contato', () => {
    expect(decidir({ id: 1, name: ' Ana ', ddi: '55', phone_number: '11999998888', notifications_enabled: true })).toEqual({
      tipo: 'contato',
      telefone: '5511999998888',
      nome: 'Ana',
      desde: null,
      email: null,
      dataNascimento: null,
    });
  });

  it('traz e-mail e aniversário quando são válidos', () => {
    const d = decidir({ id: 5, ddi: '55', phone_number: '11999998888', email: ' Ana@Loja.com ', birth_date: '1990-03-12' });
    expect(d).toMatchObject({ email: 'ana@loja.com', dataNascimento: '1990-03-12' });
    expect(decidir({ id: 6, ddi: '55', phone_number: '11999998888', email: 'sem-arroba', birth_date: '12/03' })).toMatchObject({
      email: null,
      dataNascimento: null,
    });
  });

  it('WhatsApp desligado entra descadastrado', () => {
    expect(decidir({ id: 2, ddi: '55', phone_number: '11999998888', notifications_enabled: false }).tipo).toBe('bloqueado');
  });

  it('campo ausente vale como liberado (padrão do Cardápio Web)', () => {
    expect(decidir({ id: 3, ddi: '55', phone_number: '11999998888' }).tipo).toBe('contato');
  });
});

describe('separarPagina', () => {
  it('o mesmo número em dois cadastros: se um pediu para sair, vale a saída', () => {
    const r = separarPagina([
      { id: 1, ddi: '55', phone_number: '11999998888', notifications_enabled: true },
      { id: 2, ddi: '55', phone_number: '11999998888', notifications_enabled: false },
      { id: 3, ddi: '55', phone_number: '11999998888', notifications_enabled: true },
      { id: 4, ddi: '55', phone_number: '0800' },
    ]);
    expect(r.contatos).toHaveLength(0);
    expect(r.bloqueados).toHaveLength(1);
    expect(r.invalidos).toBe(1);
  });
});

describe('cashback do cliente (Fase 4C)', () => {
  // O cliente como o schema oficial o descreve, com o exemplo de cada campo
  // (conferido em 27/09/2026 — a página "Listar clientes" mostra, por engano,
  // o exemplo de cupons). O schema não dá exemplo do cashback:
  // `cashback_balance` é `number`, e `cashback_expires_at`, `date` ou nulo.
  const oficial = {
    id: 123456,
    name: 'José da Silva',
    email: 'email@teste.com',
    phone_number: '11999999999',
    ddi: null,
    birth_date: '1980-08-24',
    created_at: '2023-05-10T17:43:40.521-03:00',
    loyalty_points: 150,
    loyalty_points_expires_at: null,
    cashback_balance: 25.9,
    cashback_expires_at: '2026-10-03',
    notifications_enabled: true,
  };

  it('lê o saldo em reais e guarda em centavos, com o dia do vencimento', () => {
    expect(saldoDoCliente(oficial)).toEqual({ centavos: 2590, venceEm: '2026-10-03' });
  });

  it('103.8 vira 10380, nunca 10379 (a conta em ponto flutuante dá 10379,999…)', () => {
    expect(saldoDoCliente({ cashback_balance: 103.8, cashback_expires_at: null })).toEqual({ centavos: 10380, venceEm: null });
  });

  it('texto também serve, com ponto ou vírgula', () => {
    expect(saldoDoCliente({ cashback_balance: '12,5', cashback_expires_at: null })?.centavos).toBe(1250);
    expect(saldoDoCliente({ cashback_balance: '7.05', cashback_expires_at: null })?.centavos).toBe(705);
  });

  it('sem saldo (zero ou negativo): zero, e a data não importa', () => {
    expect(saldoDoCliente({ cashback_balance: 0, cashback_expires_at: '2026-10-03' })).toEqual({ centavos: 0, venceEm: null });
    expect(saldoDoCliente({ cashback_balance: -3, cashback_expires_at: null })).toEqual({ centavos: 0, venceEm: null });
  });

  it('campo ausente ou ilegível: null — quem chama não mexe no que o contato já tem', () => {
    expect(saldoDoCliente({})).toBeNull();
    expect(saldoDoCliente({ cashback_balance: null })).toBeNull();
    expect(saldoDoCliente({ cashback_balance: '  ' })).toBeNull();
    expect(saldoDoCliente({ cashback_balance: 'abc' })).toBeNull();
    expect(saldoDoCliente({ cashback_balance: 1e12 })).toBeNull();
  });

  it('data que não existe no calendário fica sem data; data com hora vale pelo dia', () => {
    expect(saldoDoCliente({ cashback_balance: 5, cashback_expires_at: '2026-02-31' })?.venceEm).toBeNull();
    expect(saldoDoCliente({ cashback_balance: 5, cashback_expires_at: '0000-00-00' })?.venceEm).toBeNull();
    expect(saldoDoCliente({ cashback_balance: 5, cashback_expires_at: 'amanhã' })?.venceEm).toBeNull();
    expect(saldoDoCliente({ cashback_balance: 5, cashback_expires_at: '2026-10-03T23:59:59-03:00' })?.venceEm).toBe('2026-10-03');
  });

  it('saldosDaPagina: o saldo vai para as duas formas do celular (com e sem o 9)', () => {
    const r = saldosDaPagina([oficial]);
    expect(r.get('5511999999999')).toEqual({ centavos: 2590, venceEm: '2026-10-03' });
    expect(r.get('551199999999')).toEqual({ centavos: 2590, venceEm: '2026-10-03' });
    expect(r.size).toBe(2);
  });

  it('saldosDaPagina: o mesmo número em dois cadastros fica com o maior saldo', () => {
    const r = saldosDaPagina([
      { id: 1, ddi: '55', phone_number: '21988887777', cashback_balance: 5, cashback_expires_at: '2026-10-01' },
      { id: 2, ddi: '55', phone_number: '2188887777', cashback_balance: 12, cashback_expires_at: '2026-10-09' },
      { id: 3, ddi: '55', phone_number: '21988887777', cashback_balance: 12, cashback_expires_at: null },
    ]);
    // Empate em 12: vale o sem data (conta como o que vence depois).
    expect(r.get('5521988887777')).toEqual({ centavos: 1200, venceEm: null });
    expect(r.get('552188887777')).toEqual({ centavos: 1200, venceEm: null });
  });

  it('saldosDaPagina: sem telefone que sirva, ou sem saldo legível, fica de fora', () => {
    const r = saldosDaPagina([
      { id: 1, ddi: '55', phone_number: '08007270600', cashback_balance: 9 },
      { id: 2, ddi: '55', phone_number: '21977776666' },
    ]);
    expect(r.size).toBe(0);
  });
});
