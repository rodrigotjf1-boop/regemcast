/**
 * Regras do Mercado Pago que não podem errar em silêncio: se o aviso é
 * autêntico e o que cada estado de fatura significa para o cliente.
 */
import { createHmac } from 'node:crypto';

import {
  avisoAutentico,
  lerXSignature,
  manifestoDoAviso,
  motivoDaRecusa,
  paraCentavos,
  paraReais,
  statusDaFatura,
} from './mercadopago';

const SEGREDO = 'segredo-de-teste-do-webhook';

function assinar(dataId: string | undefined, requestId: string | undefined, ts: string) {
  const v1 = createHmac('sha256', SEGREDO).update(manifestoDoAviso(dataId, requestId, ts)).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

describe('assinatura do aviso (webhook)', () => {
  it('monta o manifesto no formato da documentação', () => {
    expect(manifestoDoAviso('123456', 'req-1', '1704908010')).toBe('id:123456;request-id:req-1;ts:1704908010;');
  });

  it('campo ausente sai do manifesto', () => {
    expect(manifestoDoAviso('123456', undefined, '1')).toBe('id:123456;ts:1;');
    expect(manifestoDoAviso(undefined, 'req', '1')).toBe('request-id:req;ts:1;');
  });

  it('id alfanumérico vai em minúsculas', () => {
    expect(manifestoDoAviso('2C938084ABC', 'r', '1')).toBe('id:2c938084abc;request-id:r;ts:1;');
  });

  it('lê o cabeçalho x-signature', () => {
    expect(lerXSignature('ts=1704908010,v1=abc123')).toEqual({ ts: '1704908010', v1: 'abc123' });
    expect(lerXSignature('v1=abc')).toBeNull();
    expect(lerXSignature(undefined)).toBeNull();
  });

  it('aceita o aviso assinado com o segredo certo', () => {
    const xSignature = assinar('987654', 'req-42', '1704908010');
    expect(avisoAutentico({ xSignature, xRequestId: 'req-42', dataId: '987654', segredo: SEGREDO })).toBe(true);
  });

  it('RECUSA quando alguém troca o id do recurso (aviso forjado com assinatura de outro)', () => {
    const xSignature = assinar('987654', 'req-42', '1704908010');
    expect(avisoAutentico({ xSignature, xRequestId: 'req-42', dataId: '111111', segredo: SEGREDO })).toBe(false);
  });

  it('recusa segredo errado, cabeçalho ausente e segredo não configurado', () => {
    const xSignature = assinar('987654', 'req-42', '1');
    expect(avisoAutentico({ xSignature, xRequestId: 'req-42', dataId: '987654', segredo: 'outro' })).toBe(false);
    expect(avisoAutentico({ xSignature: undefined, xRequestId: 'req-42', dataId: '987654', segredo: SEGREDO })).toBe(false);
    // Sem segredo configurado, NADA é autêntico — nunca "passa por falta de configuração".
    expect(avisoAutentico({ xSignature, xRequestId: 'req-42', dataId: '987654', segredo: '' })).toBe(false);
  });
});

describe('estado da fatura', () => {
  it('quem manda é o pagamento dentro da fatura', () => {
    expect(statusDaFatura({ status: 'processed', payment: { status: 'approved' } })).toBe('aprovada');
    expect(statusDaFatura({ status: 'processed', payment: { status: 'rejected' } })).toBe('recusada');
    expect(statusDaFatura({ status: 'processed', payment: { status: 'refunded' } })).toBe('estornada');
    expect(statusDaFatura({ status: 'processed', payment: { status: 'in_process' } })).toBe('pendente');
  });

  it('sem pagamento, vale o estado da fatura', () => {
    expect(statusDaFatura({ status: 'scheduled' })).toBe('pendente');
    expect(statusDaFatura({ status: 'recycling' })).toBe('recusada');
    expect(statusDaFatura({ status: 'cancelled' })).toBe('cancelada');
  });

  it('pagamento cancelado numa fatura em nova tentativa é recusa, não cancelamento', () => {
    expect(statusDaFatura({ status: 'recycling', payment: { status: 'cancelled' } })).toBe('recusada');
  });

  it('motivo da recusa em texto do cliente, com padrão para o desconhecido', () => {
    expect(motivoDaRecusa('cc_rejected_insufficient_amount')).toMatch(/insuficiente/);
    expect(motivoDaRecusa('algo_novo')).toMatch(/não foi aprovado/);
    expect(motivoDaRecusa(undefined)).toMatch(/não foi aprovado/);
  });
});

describe('valores', () => {
  it('centavos e reais sem erro de ponto flutuante', () => {
    expect(paraReais(24900)).toBe(249);
    expect(paraReais(9900)).toBe(99);
    expect(paraCentavos(99.9)).toBe(9990);
    expect(paraCentavos('249.00')).toBe(24900);
    expect(paraCentavos(null)).toBe(0);
  });
});
