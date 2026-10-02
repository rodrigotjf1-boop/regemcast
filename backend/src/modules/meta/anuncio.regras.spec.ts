import {
  aberturasPorAnuncio,
  itemDoContrato,
  lerCursor,
  lerDesde,
  lerLimite,
  LIMITE_MAXIMO,
  LIMITE_PADRAO,
  montarCursor,
  montarPagina,
  numeroEmE164,
  type LinhaDeAbertura,
} from './anuncio.regras';

/** O aviso `messages` como a Meta o manda, com a origem do anúncio na mensagem. */
function aviso(...mensagens: Record<string, unknown>[]) {
  return {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '5521900000000', phone_number_id: '100000000000001' },
    contacts: [{ profile: { name: 'Fulana' }, wa_id: '5521988887777' }],
    messages: mensagens,
  };
}

const referral = {
  source_url: 'https://fb.me/abc123',
  source_id: '120215566771111',
  source_type: 'ad',
  headline: 'Combo de sexta',
  body: 'Peça pelo WhatsApp',
  media_type: 'image',
  image_url: 'https://exemplo.invalid/imagem.jpg',
  ctwa_clid: 'ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO2E4Nx0-eM-GABDLOPaOdRMv',
  welcome_message: { text: 'Olá! Como posso ajudar?' },
};

const mensagem = {
  from: '5521988887777',
  id: 'wamid.HBgLNTUyMTk4ODg4Nzc3NxUCABIYFDNBMDAwMDAwMDAwMDAwMDAwMDAxAA==',
  timestamp: '1790622760',
  type: 'text',
  text: { body: 'Quero o combo' },
  referral,
};

describe('aberturasPorAnuncio', () => {
  it('lê a origem do anúncio da mensagem: id, tipo, clique, endereço, momento e telefone', () => {
    expect(aberturasPorAnuncio(aviso(mensagem))).toEqual([
      {
        wamid: mensagem.id,
        telefone: '5521988887777',
        abertaEm: new Date(1790622760 * 1000),
        origemTipo: 'ad',
        origemId: '120215566771111',
        ctwaClid: referral.ctwa_clid,
        origemUrl: 'https://fb.me/abc123',
      },
    ]);
  });

  it('não leva conteúdo nenhum: nem o texto da mensagem, nem o do anúncio', () => {
    const lido = JSON.stringify(aberturasPorAnuncio(aviso(mensagem)));
    expect(lido).not.toMatch(/Quero o combo|Combo de sexta|Peça pelo WhatsApp|Olá!|imagem\.jpg|Fulana/);
  });

  it('mensagem sem origem de anúncio fica de fora', () => {
    expect(aberturasPorAnuncio(aviso({ ...mensagem, referral: undefined }))).toEqual([]);
    expect(aberturasPorAnuncio(aviso({ ...mensagem, referral: null }))).toEqual([]);
    expect(aberturasPorAnuncio(aviso({ ...mensagem, referral: 'ad' }))).toEqual([]);
  });

  it('anúncio no Status do WhatsApp vem sem o identificador do clique: entra, com nulo', () => {
    const semClique = { ...referral, ctwa_clid: undefined };
    expect(aberturasPorAnuncio(aviso({ ...mensagem, referral: semClique }))[0]).toMatchObject({ ctwaClid: null, origemId: '120215566771111' });
  });

  it('publicação também abre conversa: o tipo sai como a Meta manda', () => {
    expect(aberturasPorAnuncio(aviso({ ...mensagem, referral: { ...referral, source_type: 'POST' } }))[0]).toMatchObject({ origemTipo: 'post' });
  });

  it.each([
    ['sem o id da origem', { ...referral, source_id: undefined }],
    ['id da origem vazio', { ...referral, source_id: '  ' }],
    ['id da origem grande demais (cortado seria outro id)', { ...referral, source_id: '9'.repeat(101) }],
    ['sem o tipo', { ...referral, source_type: undefined }],
    ['tipo que não é uma palavra', { ...referral, source_type: 'ad; drop' }],
  ])('%s: fica de fora', (_nome, r) => {
    expect(aberturasPorAnuncio(aviso({ ...mensagem, referral: r }))).toEqual([]);
  });

  it('sem id da mensagem ou sem telefone de quem escreveu: fica de fora', () => {
    expect(aberturasPorAnuncio(aviso({ ...mensagem, id: undefined }))).toEqual([]);
    expect(aberturasPorAnuncio(aviso({ ...mensagem, from: 'abc' }))).toEqual([]);
  });

  it('celular antigo, que a Meta manda sem o 9º dígito, entra no formato do contato', () => {
    expect(aberturasPorAnuncio(aviso({ ...mensagem, from: '552188887777' }))[0]?.telefone).toBe('5521988887777');
  });

  it('a mesma mensagem duas vezes no aviso vira uma linha', () => {
    expect(aberturasPorAnuncio(aviso(mensagem, mensagem))).toHaveLength(1);
  });

  it('endereço ou clique absurdamente grande não entra, mas a abertura entra', () => {
    const r = { ...referral, source_url: `https://fb.me/${'x'.repeat(2100)}`, ctwa_clid: 'c'.repeat(1001) };
    expect(aberturasPorAnuncio(aviso({ ...mensagem, referral: r }))[0]).toMatchObject({ origemUrl: null, ctwaClid: null, origemId: '120215566771111' });
  });

  it('sem a hora da mensagem, vale agora', () => {
    const antes = Date.now();
    const [a] = aberturasPorAnuncio(aviso({ ...mensagem, timestamp: undefined }));
    expect(a!.abertaEm.getTime()).toBeGreaterThanOrEqual(antes);
  });

  it.each([[undefined], [null], ['texto'], [{}], [{ messages: 'x' }], [{ statuses: [{ id: 'wamid.x', status: 'read' }] }]])(
    'aviso sem mensagem (%p) não quebra',
    (value) => {
      expect(aberturasPorAnuncio(value)).toEqual([]);
    },
  );
});

describe('o cursor', () => {
  const c = { t: '2026-09-24T19:12:44.382911Z', i: '8d9d5c1e-4b0f-4f5e-9a51-2f0a8c6f7a11' };

  it('vai e volta, com os microssegundos do banco', () => {
    expect(lerCursor(montarCursor(c))).toEqual(c);
  });

  it('é opaco: não tem caractere que precise de escape num endereço', () => {
    expect(montarCursor(c)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([[undefined], [null], ['']])('sem cursor (%p): leitura do começo', (bruto) => {
    expect(lerCursor(bruto)).toBeNull();
  });

  it.each([
    ['não é base64 de JSON', 'isto-nao-e-um-cursor'],
    ['JSON sem os campos', Buffer.from('{"x":1}').toString('base64url')],
    ['hora sem microssegundos', Buffer.from(JSON.stringify({ ...c, t: '2026-09-24T19:12:44Z' })).toString('base64url')],
    ['hora com SQL dentro', Buffer.from(JSON.stringify({ ...c, t: "2026-09-24T19:12:44.382911Z'; drop" })).toString('base64url')],
    ['id que não é uuid', Buffer.from(JSON.stringify({ ...c, i: '1 or 1=1' })).toString('base64url')],
    ['mês 13', Buffer.from(JSON.stringify({ ...c, t: '2026-13-24T19:12:44.382911Z' })).toString('base64url')],
    ['grande demais', 'A'.repeat(401)],
    ['número', 12 as unknown as string],
  ])('%s: inválido', (_nome, bruto) => {
    expect(lerCursor(bruto)).toBe('invalido');
  });
});

describe('lerDesde', () => {
  it.each([
    ['2026-07-01T00:00:00Z', '2026-07-01T00:00:00.000Z'],
    ['2026-07-01T00:00:00-03:00', '2026-07-01T03:00:00.000Z'],
    ['2026-07-01T00:00:00.123456Z', '2026-07-01T00:00:00.123Z'],
    ['2026-07-01T09:30Z', '2026-07-01T09:30:00.000Z'],
  ])('%s é um instante', (bruto, esperado) => {
    expect((lerDesde(bruto) as Date).toISOString()).toBe(esperado);
  });

  it.each([['2026-07-01'], ['2026-07-01T00:00:00'], ['ontem'], ['2026-13-01T00:00:00Z'], [20260701]])('%p não é: precisa do fuso', (bruto) => {
    expect(lerDesde(bruto)).toBe('invalido');
  });

  it('sem valor: sem filtro', () => {
    expect(lerDesde(undefined)).toBeNull();
    expect(lerDesde('')).toBeNull();
  });
});

describe('lerLimite', () => {
  it.each([
    [undefined, LIMITE_PADRAO],
    [null, LIMITE_PADRAO],
    [0, LIMITE_PADRAO],
    [-3, LIMITE_PADRAO],
    [2.5, LIMITE_PADRAO],
    ['muitos', LIMITE_PADRAO],
    [1, 1],
    [500, 500],
    [9999, LIMITE_MAXIMO],
  ])('%p → %p', (bruto, esperado) => {
    expect(lerLimite(bruto)).toBe(esperado);
  });
});

describe('numeroEmE164', () => {
  it('o número da loja está guardado como a Meta o exibe: sai só com o "+" e os dígitos', () => {
    expect(numeroEmE164('+55 21 90000-0000')).toBe('+5521900000000');
    expect(numeroEmE164('5521900000000')).toBe('+5521900000000');
  });

  it('o que não é telefone sai nulo', () => {
    expect(numeroEmE164(null)).toBeNull();
    expect(numeroEmE164('sem número')).toBeNull();
    expect(numeroEmE164('1'.repeat(16))).toBeNull();
  });
});

describe('o item e a página do contrato', () => {
  const linha = (n: number): LinhaDeAbertura => ({
    id: `8d9d5c1e-4b0f-4f5e-9a51-00000000000${n}`,
    registrado: `2026-09-24T19:12:4${n}.000001Z`,
    telefone: '5521988887777',
    numeroDaLoja: '+55 21 90000-0000',
    abertaEm: new Date('2026-09-24T19:12:40Z'),
    origemTipo: 'ad',
    origemId: '120215566771111',
    ctwaClid: n === 2 ? null : 'ARAkLkA',
    origemUrl: 'https://fb.me/abc123',
  });

  it('o item tem exatamente os campos do contrato, com os nomes dele', () => {
    expect(itemDoContrato(linha(1))).toEqual({
      id: '8d9d5c1e-4b0f-4f5e-9a51-000000000001',
      versao: 1,
      atualizado_em: '2026-09-24T19:12:41.000001Z',
      numero_loja: '+5521900000000',
      telefone: '+5521988887777',
      aberta_em: '2026-09-24T19:12:40.000Z',
      anuncio_id: '120215566771111',
      tipo_origem: 'ad',
      ctwa_clid: 'ARAkLkA',
      url_origem: 'https://fb.me/abc123',
    });
  });

  it('clique que a Meta omitiu sai nulo, e não some do item', () => {
    expect(itemDoContrato(linha(2))).toHaveProperty('ctwa_clid', null);
  });

  it('linhas a mais que o limite: a página corta, diz que tem mais e o cursor é o do último item ENTREGUE', () => {
    const p = montarPagina([linha(1), linha(2), linha(3)], 2, null);
    expect(p.itens.map((i) => i.id.slice(-1))).toEqual(['1', '2']);
    expect(p.tem_mais).toBe(true);
    expect(lerCursor(p.proximo_cursor)).toEqual({ t: '2026-09-24T19:12:42.000001Z', i: '8d9d5c1e-4b0f-4f5e-9a51-000000000002' });
  });

  it('última página: sem mais, e o cursor ainda vem — é com ele que a próxima consulta continua', () => {
    const p = montarPagina([linha(1)], 2, null);
    expect(p.tem_mais).toBe(false);
    expect(lerCursor(p.proximo_cursor)).toMatchObject({ i: '8d9d5c1e-4b0f-4f5e-9a51-000000000001' });
  });

  it('nada novo: devolve o mesmo cursor que recebeu', () => {
    const recebido = { t: '2026-09-24T19:12:49.000001Z', i: '8d9d5c1e-4b0f-4f5e-9a51-000000000009' };
    expect(lerCursor(montarPagina([], 2, recebido).proximo_cursor)).toEqual(recebido);
  });

  it('nada, e sem cursor: cursor nulo', () => {
    expect(montarPagina([], 2, null)).toEqual({ itens: [], proximo_cursor: null, tem_mais: false });
  });
});
