/**
 * Os payloads abaixo são os exemplos da página oficial da Meta ("Onboard
 * WhatsApp Business app users"), com o `value` como chega a cada mudança.
 */
import { historicoRecusado, progressoDaSincronizacao, sincronizacaoConcluida } from './coexistencia.regras';

const metadata = { display_phone_number: '15550783881', phone_number_id: '106540352242922' };

const lote = (progress: unknown, phase = 0, chunk_order = 1) => ({
  messaging_product: 'whatsapp',
  metadata,
  history: [
    {
      metadata: { phase, chunk_order, progress },
      threads: [
        {
          id: '16505551234',
          messages: [
            {
              from: '15550783881',
              id: 'wamid.HBgLMTY0NjcwNDM1OTUVAgARGBIyNDlBOEI5QUQ4NDc0N0FCNjMA',
              timestamp: '1739230955',
              type: 'text',
              text: { body: "Here's the info you requested!" },
              history_context: { status: 'READ' },
            },
          ],
        },
      ],
    },
  ],
});

const recusa = {
  messaging_product: 'whatsapp',
  metadata,
  history: [
    {
      errors: [
        {
          code: 2593109,
          title: 'History sync is turned off by the business from the WhatsApp Business App',
          message: 'History sync is turned off by the business from the WhatsApp Business App',
          error_data: { details: 'History sharing is turned off by the business' },
        },
      ],
    },
  ],
};

describe('progressoDaSincronizacao', () => {
  it('lê o progresso de dentro de history[].metadata, onde a Meta o manda', () => {
    expect(progressoDaSincronizacao(lote(55))).toBe(55);
  });

  it('vale o maior progresso do aviso: os lotes chegam fora de ordem', () => {
    const v = lote(40);
    (v.history as unknown[]).push({ metadata: { phase: 1, chunk_order: 3, progress: 90 }, threads: [] });
    expect(progressoDaSincronizacao(v)).toBe(90);
  });

  it('aceita número em texto e ignora o que não é número', () => {
    expect(progressoDaSincronizacao(lote('100'))).toBe(100);
    expect(progressoDaSincronizacao(lote('abc'))).toBeNull();
    expect(progressoDaSincronizacao({ metadata })).toBeNull();
  });
});

describe('sincronizacaoConcluida', () => {
  it('100 dentro de history[] conclui — antes, isto nunca era visto', () => {
    expect(sincronizacaoConcluida(lote(100, 2))).toBe(true);
  });

  it('abaixo de 100 ainda não', () => {
    expect(sincronizacaoConcluida(lote(99, 2))).toBe(false);
  });

  it('o aviso de agenda (sem progresso) não conclui nada', () => {
    expect(
      sincronizacaoConcluida({
        messaging_product: 'whatsapp',
        metadata,
        state_sync: [{ type: 'contact', contact: { phone_number: '16505551234' }, action: 'add' }],
      }),
    ).toBe(false);
  });

  it('continua aceitando os campos no nível de value', () => {
    expect(sincronizacaoConcluida({ progress: 100 })).toBe(true);
    expect(sincronizacaoConcluida({ sync_status: 'COMPLETED' })).toBe(true);
  });
});

describe('historicoRecusado', () => {
  it('acha o 2593109 dentro de history[].errors, onde a Meta o manda', () => {
    expect(historicoRecusado(recusa)).toBe(true);
  });

  it('continua aceitando errors no nível de value', () => {
    expect(historicoRecusado({ errors: [{ code: 2593109 }] })).toBe(true);
  });

  it('lote normal não é recusa', () => {
    expect(historicoRecusado(lote(55))).toBe(false);
  });
});
