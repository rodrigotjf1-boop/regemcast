/**
 * O que o modelo exige no envio, e o JSON que sai para a Meta.
 *
 * Os JSONs esperados são os exemplos da documentação da Meta (conferida em
 * 01/10/2026): "Custom marketing templates" (cabeçalho de imagem), "Coupon code
 * templates", "Limited-time offer templates" e "Media card carousel templates".
 * Os componentes de entrada são os que `GET /{waba}/message_templates` devolve.
 */
import {
  CabecalhoSemValor,
  componentesDoEnvio,
  exigenciasDoEnvio,
  HORAS_DA_OFERTA_PADRAO,
  lerPlano,
  MidiaForaDoPlano,
  midiasDoPlano,
  soPedeOCorpo,
  type MidiaNaMeta,
  type PlanoDeEnvio,
} from './envio.regras';

const AGORA = new Date('2026-10-01T15:00:00Z');
const semMidia = new Map<string, MidiaNaMeta>();

describe('exigenciasDoEnvio — o que o modelo pede', () => {
  it('modelo só de texto, com rodapé e botões comuns: o envio é o de sempre', () => {
    const e = exigenciasDoEnvio([
      { type: 'HEADER', format: 'TEXT', text: 'Promoção de sexta' },
      { type: 'BODY', text: 'Oi, {{1}}! Hoje tem {{2}}.' },
      { type: 'FOOTER', text: 'Responda SAIR para não receber.' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: 'Ver cardápio', url: 'https://loja.example/cardapio' },
          { type: 'PHONE_NUMBER', text: 'Ligar', phone_number: '+5521999998888' },
          { type: 'QUICK_REPLY', text: 'Parar promoções' },
        ],
      },
    ]);
    expect(soPedeOCorpo(e)).toBe(true);
    expect(e).toEqual({ cabecalho: null, oferta: false, cupomNoBotao: null, cartoes: [], semSuporte: [] });
  });

  it.each([
    ['IMAGE', 'image'],
    ['VIDEO', 'video'],
    ['DOCUMENT', 'document'],
  ])('cabeçalho %s pede a mídia no envio', (format, esperado) => {
    const e = exigenciasDoEnvio([
      { type: 'HEADER', format, example: { header_handle: ['https://scontent.whatsapp.net/v/exemplo'] } },
      { type: 'BODY', text: 'Olha só!' },
    ]);
    expect(e.cabecalho).toBe(esperado);
    expect(soPedeOCorpo(e)).toBe(false);
  });

  it('cabeçalho de texto COM variável pede o valor; sem variável, nada', () => {
    const com = exigenciasDoEnvio([
      { type: 'HEADER', format: 'TEXT', text: 'Oi, {{1}}!', example: { header_text: ['Ana'] } },
      { type: 'BODY', text: 'Tem novidade.' },
    ]);
    expect(com.cabecalho).toBe('texto');
    expect(exigenciasDoEnvio([{ type: 'HEADER', format: 'TEXT', text: 'Oi!' }]).cabecalho).toBeNull();
  });

  it('variável nomeada no título também conta', () => {
    expect(exigenciasDoEnvio([{ type: 'HEADER', format: 'TEXT', text: 'Oi, {{first_name}}!' }]).cabecalho).toBe('texto');
  });

  it('oferta por tempo limitado só exige a validade quando o modelo foi criado com ela', () => {
    const oferta = (has_expiration: boolean) =>
      exigenciasDoEnvio([
        { type: 'LIMITED_TIME_OFFER', limited_time_offer: { text: 'Só hoje!', has_expiration } },
        { type: 'BODY', text: 'Corre!' },
      ]).oferta;
    expect(oferta(true)).toBe(true);
    expect(oferta(false)).toBe(false);
  });

  it('o cupom é achado pela POSIÇÃO na lista de botões da Meta', () => {
    const cupomEm = (buttons: unknown[]) => exigenciasDoEnvio([{ type: 'BUTTONS', buttons }]).cupomNoBotao;
    expect(cupomEm([{ type: 'COPY_CODE', example: 'VOLTA10' }, { type: 'URL', text: 'Pedir', url: 'https://x.example' }])).toBe(0);
    expect(cupomEm([{ type: 'URL', text: 'Pedir', url: 'https://x.example' }, { type: 'COPY_CODE', example: 'VOLTA10' }])).toBe(1);
    expect(cupomEm([{ type: 'QUICK_REPLY', text: 'Parar promoções' }])).toBeNull();
  });

  it('carrossel: cada cartão pede a mídia, e as respostas rápidas vão pela posição', () => {
    const cartao = (format: string) => ({
      components: [
        { type: 'HEADER', format, example: { header_handle: ['https://scontent.whatsapp.net/x'] } },
        { type: 'BODY', text: 'X-tudo' },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'URL', text: 'Pedir', url: 'https://loja.example/x-tudo' },
            { type: 'QUICK_REPLY', text: 'Quero este' },
          ],
        },
      ],
    });
    const e = exigenciasDoEnvio([
      { type: 'BODY', text: 'Os mais pedidos, {{1}}:' },
      { type: 'CAROUSEL', cards: [cartao('IMAGE'), cartao('VIDEO')] },
    ]);
    expect(e.cartoes).toEqual([
      { tipo: 'image', respostas: [{ indice: 1, texto: 'Quero este' }] },
      { tipo: 'video', respostas: [{ indice: 1, texto: 'Quero este' }] },
    ]);
    expect(e.semSuporte).toEqual([]);
    expect(soPedeOCorpo(e)).toBe(false);
  });

  it.each([
    ['cabeçalho de localização', [{ type: 'HEADER', format: 'LOCATION' }], 'localização'],
    [
      'botão de link com variável',
      [{ type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Ver', url: 'https://x.example/{{1}}', example: ['https://x.example/abc'] }] }],
      'link com variável',
    ],
    ['modelo de código de verificação', [{ type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] }], 'código de verificação'],
    [
      'cartão com variável no texto',
      [{ type: 'CAROUSEL', cards: [{ components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Só {{1}}' }] }] }],
      'variável no texto',
    ],
    [
      'cartão com link variável',
      [
        {
          type: 'CAROUSEL',
          cards: [
            {
              components: [
                { type: 'HEADER', format: 'IMAGE' },
                { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Ver', url: 'https://x.example/{{1}}' }] },
              ],
            },
          ],
        },
      ],
      'link com variável',
    ],
    ['cartão sem mídia', [{ type: 'CAROUSEL', cards: [{ components: [{ type: 'BODY', text: 'x' }] }] }], 'não tem imagem nem vídeo'],
  ])('diz o que o disparo NÃO sabe mandar: %s', (_caso, componentes, trecho) => {
    const e = exigenciasDoEnvio(componentes);
    expect(e.semSuporte.join(' | ')).toContain(trecho);
    expect(soPedeOCorpo(e)).toBe(false);
  });

  it('tipo de botão que não conhecemos não é recusado de antemão: a Meta decide na primeira mensagem', () => {
    const e = exigenciasDoEnvio([{ type: 'BUTTONS', buttons: [{ type: 'VOICE_CALL', text: 'Ligar pelo WhatsApp' }] }]);
    expect(e.semSuporte).toEqual([]);
    expect(soPedeOCorpo(e)).toBe(true);
  });

  it('o tipo vem em maiúsculas da Meta, mas minúsculas também servem', () => {
    expect(exigenciasDoEnvio([{ type: 'header', format: 'image' }]).cabecalho).toBe('image');
  });

  it.each([null, undefined, 'texto', 7, {}, [null, 3, 'x', []]])('aguenta componentes malformados (%p)', (entrada) => {
    expect(soPedeOCorpo(exigenciasDoEnvio(entrada))).toBe(true);
  });
});

describe('componentesDoEnvio — o JSON de uma mensagem', () => {
  it('sem plano e sem variável não manda `components` (vazio, a Meta recusa com 132000)', () => {
    expect(componentesDoEnvio(null, { variaveis: [], midias: semMidia, agora: AGORA })).toBeUndefined();
  });

  it('sem plano, com variáveis: só o corpo, como sempre foi', () => {
    expect(componentesDoEnvio(null, { variaveis: ['Ana', '10%'], midias: semMidia, agora: AGORA })).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: '10%' }] },
    ]);
  });

  it('cabeçalho de imagem: o exemplo da Meta ("Custom marketing templates")', () => {
    const plano: PlanoDeEnvio = { cabecalho: { tipo: 'image', midia: 'midia:aaa' } };
    const midias = new Map<string, MidiaNaMeta>([['midia:aaa', { id: '1339522734477770', nomeArquivo: 'promo.jpg' }]]);

    expect(componentesDoEnvio(plano, { variaveis: ['Jessica', 'WELCOME25', '25%'], midias, agora: AGORA })).toEqual([
      { type: 'header', parameters: [{ type: 'image', image: { id: '1339522734477770' } }] },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Jessica' },
          { type: 'text', text: 'WELCOME25' },
          { type: 'text', text: '25%' },
        ],
      },
    ]);
  });

  it('vídeo vai como `video`, e documento leva o nome do arquivo', () => {
    const midias = new Map<string, MidiaNaMeta>([
      ['midia:v', { id: 'V1', nomeArquivo: 'chamada.mp4' }],
      ['midia:d', { id: 'D1', nomeArquivo: 'cardapio.pdf' }],
    ]);
    expect(componentesDoEnvio({ cabecalho: { tipo: 'video', midia: 'midia:v' } }, { variaveis: [], midias, agora: AGORA })).toEqual([
      { type: 'header', parameters: [{ type: 'video', video: { id: 'V1' } }] },
    ]);
    expect(componentesDoEnvio({ cabecalho: { tipo: 'document', midia: 'midia:d' } }, { variaveis: [], midias, agora: AGORA })).toEqual([
      { type: 'header', parameters: [{ type: 'document', document: { id: 'D1', filename: 'cardapio.pdf' } }] },
    ]);
  });

  it('mídia que é um endereço público vai como `link`', () => {
    const midias = new Map<string, MidiaNaMeta>([['https://loja.example/promo.jpg', { link: 'https://loja.example/promo.jpg' }]]);
    expect(
      componentesDoEnvio({ cabecalho: { tipo: 'image', midia: 'https://loja.example/promo.jpg' } }, { variaveis: [], midias, agora: AGORA }),
    ).toEqual([{ type: 'header', parameters: [{ type: 'image', image: { link: 'https://loja.example/promo.jpg' } }] }]);
  });

  it('cupom: o exemplo da Meta ("Coupon code templates"), na posição que a Meta deu ao botão', () => {
    expect(
      componentesDoEnvio({ cupom: { indice: 1, codigo: 'WINTER25' } }, { variaveis: [], midias: semMidia, agora: AGORA }),
    ).toEqual([
      {
        type: 'button',
        sub_type: 'copy_code',
        index: 1,
        parameters: [{ type: 'coupon_code', coupon_code: 'WINTER25' }],
      },
    ]);
  });

  it('oferta por tempo limitado: o exemplo da Meta, com a validade como instante ABSOLUTO', () => {
    const plano: PlanoDeEnvio = {
      cabecalho: { tipo: 'image', midia: 'midia:lto' },
      oferta: { horas: HORAS_DA_OFERTA_PADRAO },
      cupom: { indice: 0, codigo: 'CARIBE25' },
    };
    const midias = new Map<string, MidiaNaMeta>([['midia:lto', { id: '1602186516975000' }]]);

    expect(componentesDoEnvio(plano, { variaveis: ['Pablo', 'CARIBE25'], midias, agora: AGORA })).toEqual([
      { type: 'header', parameters: [{ type: 'image', image: { id: '1602186516975000' } }] },
      { type: 'body', parameters: [{ type: 'text', text: 'Pablo' }, { type: 'text', text: 'CARIBE25' }] },
      {
        type: 'limited_time_offer',
        parameters: [
          {
            type: 'limited_time_offer',
            // 3 horas depois do envio — e não 10.800.000, que seria uma duração.
            limited_time_offer: { expiration_time_ms: AGORA.getTime() + 3 * 3_600_000 },
          },
        ],
      },
      { type: 'button', sub_type: 'copy_code', index: 0, parameters: [{ type: 'coupon_code', coupon_code: 'CARIBE25' }] },
    ]);
  });

  it('carrossel: o formato da Meta ("Media card carousel templates")', () => {
    const plano: PlanoDeEnvio = {
      cartoes: [
        { tipo: 'image', midia: 'midia:c0', respostas: [{ indice: 0, texto: 'Quero este' }] },
        { tipo: 'image', midia: 'midia:c1', respostas: [{ indice: 0, texto: 'Quero este' }] },
      ],
    };
    const midias = new Map<string, MidiaNaMeta>([
      ['midia:c0', { id: 'ASSET0' }],
      ['midia:c1', { id: 'ASSET1' }],
    ]);

    expect(componentesDoEnvio(plano, { variaveis: ['Ana'], midias, agora: AGORA })).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Ana' }] },
      {
        type: 'carousel',
        cards: [
          {
            card_index: 0,
            components: [
              { type: 'header', parameters: [{ type: 'image', image: { id: 'ASSET0' } }] },
              { type: 'button', sub_type: 'quick_reply', index: 0, parameters: [{ type: 'payload', payload: 'Quero este' }] },
            ],
          },
          {
            card_index: 1,
            components: [
              { type: 'header', parameters: [{ type: 'image', image: { id: 'ASSET1' } }] },
              { type: 'button', sub_type: 'quick_reply', index: 0, parameters: [{ type: 'payload', payload: 'Quero este' }] },
            ],
          },
        ],
      },
    ]);
  });

  it('variável do título: vai o valor da pessoa, aparado', () => {
    expect(
      componentesDoEnvio({ cabecalho: { tipo: 'texto' } }, { variaveis: ['10%'], cabecalhoTexto: ' Ana ', midias: semMidia, agora: AGORA }),
    ).toEqual([
      { type: 'header', parameters: [{ type: 'text', text: 'Ana' }] },
      { type: 'body', parameters: [{ type: 'text', text: '10%' }] },
    ]);
  });

  it.each([null, undefined, '', '   '])('variável do título sem valor (%p) não sai: a Meta recusaria', (valor) => {
    expect(() =>
      componentesDoEnvio({ cabecalho: { tipo: 'texto' } }, { variaveis: [], cabecalhoTexto: valor, midias: semMidia, agora: AGORA }),
    ).toThrow(CabecalhoSemValor);
  });

  it('mídia do plano que ninguém resolveu é erro nosso, com a referência no texto', () => {
    expect(() =>
      componentesDoEnvio({ cabecalho: { tipo: 'image', midia: 'midia:sumiu' } }, { variaveis: [], midias: semMidia, agora: AGORA }),
    ).toThrow(MidiaForaDoPlano);
  });
});

describe('o plano gravado na campanha', () => {
  const completo: PlanoDeEnvio = {
    cabecalho: { tipo: 'image', midia: 'midia:aaa' },
    oferta: { horas: 6 },
    cupom: { indice: 0, codigo: 'VOLTA10' },
    cartoes: [{ tipo: 'video', midia: 'midia:bbb', respostas: [{ indice: 1, texto: 'Quero' }] }],
  };

  it('vai para o jsonb e volta igual', () => {
    expect(lerPlano(JSON.parse(JSON.stringify(completo)))).toEqual(completo);
    expect(lerPlano({ cabecalho: { tipo: 'texto' } })).toEqual({ cabecalho: { tipo: 'texto' } });
  });

  it.each([null, undefined, 'x', 3, [], {}, { cabecalho: { tipo: 'audio', midia: 'midia:x' } }, { oferta: { horas: 0 } }, { cupom: { indice: '0', codigo: 'X' } }])(
    'o que não é plano (%p) vira "sem plano": o envio é o de sempre',
    (json) => {
      expect(lerPlano(json)).toBeNull();
    },
  );

  it('lista cada mídia uma vez, para subir à Meta uma vez por rodada', () => {
    expect(
      midiasDoPlano({
        cabecalho: { tipo: 'image', midia: 'midia:a' },
        cartoes: [
          { tipo: 'image', midia: 'midia:a', respostas: [] },
          { tipo: 'image', midia: 'midia:b', respostas: [] },
        ],
      }),
    ).toEqual(['midia:a', 'midia:b']);
    expect(midiasDoPlano({ cabecalho: { tipo: 'texto' } })).toEqual([]);
    expect(midiasDoPlano(null)).toEqual([]);
  });
});
