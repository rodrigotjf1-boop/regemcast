/**
 * Os payloads seguem os exemplos da documentação oficial da Meta (mensagens
 * recebidas, ecos do app e histórico da coexistência).
 */
import {
  conteudo,
  deduplicar,
  ecosDoCelular,
  mensagensDoHistorico,
  mensagensRecebidas,
  resumoDaMensagem,
  statusDaMeta,
  statusesRecebidos,
  totaisDoLote,
  type MensagemNormalizada,
} from './conversas.regras';

const metadata = { display_phone_number: '15550783881', phone_number_id: '106540352242922' };

describe('mensagensRecebidas', () => {
  it('lê o texto, a data original e o nome de perfil', () => {
    const r = mensagensRecebidas({
      messaging_product: 'whatsapp',
      metadata,
      contacts: [{ profile: { name: 'Maria' }, wa_id: '16505551234' }],
      messages: [{ from: '16505551234', id: 'wamid.A', timestamp: '1739321024', type: 'text', text: { body: 'Oi, tem x-bacon?' } }],
    });
    expect(r.mensagens).toEqual([
      expect.objectContaining({
        wamid: 'wamid.A',
        telefone: '16505551234',
        direcao: 'entrada',
        origem: 'cliente',
        tipo: 'text',
        texto: 'Oi, tem x-bacon?',
        status: null,
        criadaEm: new Date(1739321024 * 1000),
      }),
    ]);
    expect(r.nomes.get('16505551234')).toBe('Maria');
  });

  it('celular antigo do Brasil chega com o 9, igual ao contato', () => {
    const r = mensagensRecebidas({ messages: [{ from: '552189751705', id: 'wamid.B', timestamp: '1', type: 'text', text: { body: 'oi' } }] });
    expect(r.mensagens[0]!.telefone).toBe('5521989751705');
  });

  it('descarta o que não tem id ou telefone', () => {
    const r = mensagensRecebidas({ messages: [{ from: '5521989751705', type: 'text' }, { id: 'wamid.C', type: 'text' }] });
    expect(r.mensagens).toEqual([]);
  });
});

describe('ecosDoCelular', () => {
  it('a pessoa é o `to`, a direção é saída e a origem é o celular', () => {
    const [m] = ecosDoCelular({
      messaging_product: 'whatsapp',
      metadata,
      message_echoes: [
        { from: '15550783881', to: '16505551234', id: 'wamid.E', timestamp: '1700255121', type: 'text', text: { body: "Here's the info you requested!" } },
      ],
    });
    expect(m).toMatchObject({ telefone: '16505551234', direcao: 'saida', origem: 'celular', status: 'enviada', texto: "Here's the info you requested!" });
  });
});

describe('mensagensDoHistorico', () => {
  const lote = {
    messaging_product: 'whatsapp',
    metadata,
    history: [
      {
        metadata: { phase: 0, chunk_order: 1, progress: 55 },
        threads: [
          {
            id: '16505551234',
            messages: [
              { from: '15550783881', id: 'wamid.H1', timestamp: '1739230955', type: 'text', text: { body: "Here's the info you requested!" }, history_context: { status: 'READ' } },
              { from: '16505551234', id: 'wamid.H2', timestamp: '1739230900', type: 'text', text: { body: 'Me manda o cardápio?' }, history_context: { status: 'READ' } },
            ],
          },
        ],
      },
    ],
  };

  it('a empresa mandou → saída com o status do histórico; o cliente mandou → entrada', () => {
    const r = mensagensDoHistorico(lote);
    expect(r.find((m) => m.wamid === 'wamid.H1')).toMatchObject({ telefone: '16505551234', direcao: 'saida', origem: 'historico', status: 'lida' });
    expect(r.find((m) => m.wamid === 'wamid.H2')).toMatchObject({ telefone: '16505551234', direcao: 'entrada', origem: 'historico', status: null });
  });

  it('o aviso à parte com mídia (value.messages) vira entrada com a mídia', () => {
    const [m] = mensagensDoHistorico({
      messaging_product: 'whatsapp',
      metadata,
      messages: [
        { from: '16505551234', id: 'wamid.M1', timestamp: '1738796547', type: 'image', image: { caption: 'Black Prince echeveria', mime_type: 'image/jpeg', id: '24230790383178626' } },
      ],
    });
    expect(m).toMatchObject({ wamid: 'wamid.M1', direcao: 'entrada', tipo: 'image', midiaId: '24230790383178626', midiaMime: 'image/jpeg', texto: 'Black Prince echeveria' });
  });

  it('mídia enviada pela empresa sem `to` fica de fora: não dá para saber a conversa', () => {
    const r = mensagensDoHistorico({
      metadata,
      messages: [{ from: '15550783881', id: 'wamid.M2', timestamp: '1', type: 'image', image: { id: '1' } }],
    });
    expect(r).toEqual([]);
  });

  it('o aviso de recusa (2593109) não produz mensagem', () => {
    expect(mensagensDoHistorico({ metadata, history: [{ errors: [{ code: 2593109 }] }] })).toEqual([]);
  });
});

describe('conteudo', () => {
  it('lê cada tipo sem quebrar no desconhecido', () => {
    expect(conteudo({ type: 'document', document: { id: 'd1', mime_type: 'application/pdf', filename: 'cardapio.pdf', caption: 'segue' } })).toEqual({
      tipo: 'document', texto: 'segue', midiaId: 'd1', midiaMime: 'application/pdf', midiaNome: 'cardapio.pdf',
    });
    expect(conteudo({ type: 'audio', audio: { id: 'a1', mime_type: 'audio/ogg' } })).toMatchObject({ tipo: 'audio', midiaId: 'a1', texto: null });
    expect(conteudo({ type: 'location', location: { latitude: -22.9, longitude: -43.2, name: 'Loja', address: 'Rua A, 10' } }).texto).toBe('Loja — Rua A, 10');
    expect(conteudo({ type: 'location', location: { latitude: -22.9, longitude: -43.2 } }).texto).toBe('-22.9, -43.2');
    expect(conteudo({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'x', title: 'Quero' } } }).texto).toBe('Quero');
    expect(conteudo({ type: 'button', button: { text: 'Parar promoções', payload: 'x' } }).texto).toBe('Parar promoções');
    expect(conteudo({ type: 'reaction', reaction: { message_id: 'w', emoji: '👍' } }).texto).toBe('👍');
    expect(conteudo({ type: 'contacts', contacts: [{ name: { formatted_name: 'João' } }] }).texto).toBe('João');
    expect(conteudo({ type: 'algo_novo' })).toMatchObject({ tipo: 'algo_novo', texto: null });
    expect(conteudo({})).toMatchObject({ tipo: 'unsupported', texto: null });
  });
});

describe('resumoDaMensagem', () => {
  it('texto quando há; rótulo pelo tipo quando não há', () => {
    expect(resumoDaMensagem('text', 'Oi')).toBe('Oi');
    expect(resumoDaMensagem('image', null)).toBe('📷 Foto');
    expect(resumoDaMensagem('image', 'legenda')).toBe('legenda');
    expect(resumoDaMensagem('reaction', '👍')).toBe('Reagiu com 👍');
    expect(resumoDaMensagem('desconhecido', null)).toBe('[mensagem]');
  });

  it('corta texto longo', () => {
    expect(resumoDaMensagem('text', 'x'.repeat(300))).toHaveLength(120);
  });
});

describe('status', () => {
  it('entende os dois formatos: webhook e histórico', () => {
    expect(statusDaMeta('delivered')).toBe('entregue');
    expect(statusDaMeta('READ')).toBe('lida');
    expect(statusDaMeta('PLAYED')).toBe('lida');
    expect(statusDaMeta('ERROR')).toBe('falhou');
    expect(statusDaMeta('coisa')).toBeNull();
  });

  it('status do webhook traz o erro real da falha', () => {
    expect(
      statusesRecebidos({ statuses: [{ id: 'wamid.S', status: 'failed', errors: [{ code: 131047, title: 'Re-engagement message' }] }] }),
    ).toEqual([{ wamid: 'wamid.S', status: 'falhou', erroCodigo: 131047, erroTitulo: 'Re-engagement message' }]);
  });
});

describe('deduplicar', () => {
  const base = (wamid: string, midiaId: string | null): MensagemNormalizada => ({
    wamid, telefone: '5521989751705', direcao: 'entrada', origem: 'historico', tipo: 'image',
    texto: null, midiaId, midiaMime: midiaId ? 'image/jpeg' : null, midiaNome: null, status: null, criadaEm: new Date(0),
  });

  it('uma linha por wamid, ficando com a que tem mídia', () => {
    const r = deduplicar([base('w1', null), base('w1', 'mid'), base('w2', null)]);
    expect(r).toHaveLength(2);
    expect(r.find((m) => m.wamid === 'w1')!.midiaId).toBe('mid');
  });
});

describe('totaisDoLote', () => {
  const m = (direcao: 'entrada' | 'saida', origem: MensagemNormalizada['origem'], s: number, textoMsg = 'x') => ({
    direcao, origem, tipo: 'text', texto: textoMsg, criadaEm: new Date(s * 1000),
  });

  it('conta como não lida só a mensagem do cliente ao vivo', () => {
    const t = totaisDoLote([m('entrada', 'cliente', 10), m('entrada', 'historico', 5), m('entrada', 'cliente', 20, 'último')]);
    expect(t).toMatchObject({ novasNaoLidas: 2, zerarNaoLidas: false, ultimaMensagem: 'último', ultimaMensagemEm: new Date(20_000) });
  });

  it('resposta do lojista zera e conta só o que veio depois', () => {
    const t = totaisDoLote([m('entrada', 'cliente', 10), m('saida', 'celular', 15), m('entrada', 'cliente', 20)]);
    expect(t).toMatchObject({ zerarNaoLidas: true, novasNaoLidas: 1 });
  });

  it('a janela de 24h conta da última mensagem do cliente, mesmo do histórico', () => {
    const t = totaisDoLote([m('entrada', 'historico', 30), m('saida', 'historico', 40)]);
    expect(t.ultimaEntradaEm).toEqual(new Date(30_000));
    expect(t.zerarNaoLidas).toBe(false);
  });
});
