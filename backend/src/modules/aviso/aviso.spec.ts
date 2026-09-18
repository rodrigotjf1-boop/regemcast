/**
 * Push: a leitura da credencial e das preferências.
 *
 * O envio em si fala com o Google e não é testado aqui; o que se tranca é o
 * que decide SE e PARA QUEM o aviso sai.
 */
jest.mock('../../config/env', () => ({ env: { push: { contaServico: '' } } }));

import { avisosDe } from './aviso.service';
import { lerContaServico } from './fcm.service';

describe('avisosDe', () => {
  it('liga tudo quando nada foi gravado', () => {
    expect(avisosDe(null)).toEqual({ campanhas: true, modelos: true, cobranca: true });
  });

  it('só desliga o que foi desligado de propósito', () => {
    expect(avisosDe({ modelos: false, cobranca: 'x' })).toEqual({
      campanhas: true,
      modelos: false,
      cobranca: true,
    });
  });
});

describe('lerContaServico', () => {
  const conta = { project_id: 'regemcast', client_email: 'fcm@regemcast.iam', private_key: 'PEM' };

  it('aceita o JSON puro e em base64', () => {
    expect(lerContaServico(JSON.stringify(conta))?.project_id).toBe('regemcast');
    expect(lerContaServico(Buffer.from(JSON.stringify(conta)).toString('base64'))?.client_email).toBe(
      'fcm@regemcast.iam',
    );
  });

  it('desliga o push com variável vazia ou torta', () => {
    expect(lerContaServico('')).toBeNull();
    expect(lerContaServico('nao-e-json')).toBeNull();
    expect(lerContaServico(JSON.stringify({ project_id: 'x' }))).toBeNull();
  });
});
