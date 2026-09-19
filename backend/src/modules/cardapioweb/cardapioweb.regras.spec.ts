/**
 * Quem do Cardápio Web vira contato, quem entra descadastrado e quem fica fora.
 *
 * O erro caro aqui é mandar campanha para quem desligou o WhatsApp na loja —
 * ou transformar um celular gaúcho (DDD 55) em número inválido por confundir o
 * DDD com o DDI.
 */
import { decidir, separarPagina, telefoneDoCliente } from './cardapioweb.regras';

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
