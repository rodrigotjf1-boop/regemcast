/**
 * O e-mail ao dono a cada ligação por clique (Hub DMS B1-4): o que o aplicativo pode e o que não pode, sem prometer
 * o que deixou de ser verdade quando ele ganha permissão de gravar (F5 parte D). Dados fictícios (repositório público).
 */
import { emailAplicativoLigado } from './modelos-email';

const base = {
  nome: 'Paulo Exemplo',
  aplicativo: 'Liame',
  contaNome: 'Hamburgueria Exemplo',
  contaQuePede: { nome: 'Agência Exemplo', cnpj: '44.555.666/0001-00' },
  quando: 'às 10:12 de 12/11/2026',
  tipo: 'nova' as const,
  link: 'https://cast.exemplo/integracoes',
};

describe('o e-mail da ligação por clique', () => {
  it('só leituras: "pode ver" e "não pode enviar mensagens", como sempre', () => {
    const e = emailAplicativoLigado('dono@exemplo.test', { ...base, liberadas: ['situação da conta', 'orçamento de disparos'] });
    expect(e.texto).toContain('O Liame pode ver:\n- situação da conta\n- orçamento de disparos');
    expect(e.texto).toContain('Ele não pode enviar mensagens, mudar campanhas nem ver a sua lista de contatos.');
    expect(e.html).toContain('O Liame pode ver:');
  });

  it('com gravação: "liberado" e o que ele não pode de verdade (disparar sem aprovação, mexer no que não é dele)', () => {
    const e = emailAplicativoLigado('dono@exemplo.test', {
      ...base,
      tipo: 'mais',
      liberadas: ['situação da conta', 'pedir o disparo de campanha'],
      grava: true,
    });
    expect(e.texto).toContain('Liberado ao Liame:\n- situação da conta\n- pedir o disparo de campanha');
    expect(e.texto).toContain('Ele não pode disparar sem você, ou quem você autorizou, aprovar no RegemCast, mexer no que não é dele nem ver a sua lista de contatos.');
    expect(e.texto).not.toContain('não pode enviar mensagens');
    expect(e.texto).not.toContain('pode ver:');
    expect(e.html).toContain('Liberado ao Liame:');
    expect(e.html).not.toContain('pode ver:');
  });
});
