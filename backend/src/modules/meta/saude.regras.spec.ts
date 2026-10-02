/**
 * A saúde da conta: ler o `health_status` da Meta e dizer, na tela, se dá para
 * enviar e o que resolver.
 *
 * O que estes testes trancam:
 *
 *   1. **"Não sei" não vira "pode enviar".** Resposta sem veredito reconhecível
 *      não é lida, e a tela diz que ainda não conferiu.
 *   2. **A frase da Meta nunca é a explicação.** Ela não publica os códigos da
 *      saúde: o título sai do que está com problema, e a descrição dela fica à
 *      parte.
 *   3. **Só o veredito da Meta barra o disparo.** O pagamento a conferir e a
 *      conexão para vencer são avisos nossos.
 */
import {
  ehDeChamadas,
  lerSaude,
  oQueImpedeOEnvio,
  pior,
  problemaDaSaude,
  saudeGuardada,
  saudeParaTela,
  type DadosDaSaude,
  type EntidadeDaSaude,
  type SaudeParaTela,
} from './saude.regras';

/** O exemplo da documentação da Meta para um número com tudo em ordem. */
const DISPONIVEL = {
  can_send_message: 'AVAILABLE',
  entities: [
    { entity_type: 'PHONE_NUMBER', id: '106540352242922', can_send_message: 'AVAILABLE' },
    { entity_type: 'WABA', id: '102290129340398', can_send_message: 'AVAILABLE' },
    { entity_type: 'BUSINESS', id: '2729063490586005', can_send_message: 'AVAILABLE' },
    { entity_type: 'APP', id: '670843887433847', can_send_message: 'AVAILABLE' },
  ],
};

/**
 * Uma conta bloqueada, no formato da documentação. O código e as frases do erro
 * são do teste: a Meta não publica a lista dos códigos da saúde, só o formato.
 */
const BLOQUEADO = {
  can_send_message: 'BLOCKED',
  entities: [
    {
      entity_type: 'WABA',
      id: '102290129340398',
      can_send_message: 'BLOCKED',
      errors: [
        {
          error_code: 141006,
          error_description: 'There is an error with the payment method.',
          possible_solution: 'There was an error with your payment method. Please add a new payment method to the account. https://business.facebook.com/billing_hub/x',
        },
      ],
    },
    { entity_type: 'BUSINESS', id: '2729063490586005', can_send_message: 'AVAILABLE' },
    { entity_type: 'APP', id: '670843887433847', can_send_message: 'LIMITED', additional_info: ['Your app is in development mode.'] },
  ],
};

const AGORA = new Date('2026-10-02T12:00:00Z');
const dados = (parcial: Partial<DadosDaSaude> = {}): DadosDaSaude => ({
  conta: { estado: 'disponivel', entidades: lerSaude(DISPONIVEL)!.entidades, lidaEm: AGORA },
  numeros: [
    {
      phoneNumberId: '106540352242922',
      telefone: '+5521999990000',
      saude: { estado: 'disponivel', entidades: lerSaude(DISPONIVEL)!.entidades },
    },
  ],
  cobranca: { moedaLida: true, pagamentoLido: true, moeda: 'BRL', fuso: 'America/Sao_Paulo', pagamentoId: '2056000000000001', url: 'https://business.facebook.com/billing_hub/accounts/details/?business_id=1&asset_id=2&account_type=whatsapp-business-account' },
  tokenExpiraEm: new Date('2026-11-20T12:00:00Z'),
  agora: AGORA,
  ...parcial,
});
const item = (chave: string, d: DadosDaSaude) => saudeParaTela(d).itens.find((i) => i.chave === chave);

describe('lerSaude — o que a Meta devolve', () => {
  it('lê o veredito e cada item por trás dele, com os nossos nomes', () => {
    const s = lerSaude(DISPONIVEL)!;
    expect(s.estado).toBe('disponivel');
    expect(s.entidades.map((e) => `${e.tipo}:${e.estado}`)).toEqual([
      'numero:disponivel',
      'conta:disponivel',
      'empresa:disponivel',
      'aplicativo:disponivel',
    ]);
  });

  it('lê o erro com o código, a descrição e a solução; e a informação que não é erro', () => {
    const s = lerSaude(BLOQUEADO)!;
    expect(s.estado).toBe('bloqueado');
    expect(s.entidades[0]!.erros).toEqual([
      {
        codigo: 141006,
        descricao: 'There is an error with the payment method.',
        solucao: 'There was an error with your payment method. Please add a new payment method to the account. https://business.facebook.com/billing_hub/x',
      },
    ]);
    expect(s.entidades[2]).toMatchObject({ tipo: 'aplicativo', estado: 'limitado', info: ['Your app is in development mode.'] });
  });

  it('sem veredito reconhecível, não lê — "não sei" não vira "pode enviar"', () => {
    expect(lerSaude(null)).toBeNull();
    expect(lerSaude(undefined)).toBeNull();
    expect(lerSaude('AVAILABLE')).toBeNull();
    expect(lerSaude({})).toBeNull();
    expect(lerSaude({ can_send_message: 'TALVEZ', entities: [] })).toBeNull();
  });

  it('estado novo num item conta como restrição, e tipo novo aparece como "outro"', () => {
    const s = lerSaude({
      can_send_message: 'LIMITED',
      entities: [{ entity_type: 'CATALOG', id: '9', can_send_message: 'PAUSED' }, 'lixo', null],
    })!;
    expect(s.entidades).toEqual([{ tipo: 'outro', id: '9', estado: 'limitado', erros: [], info: [] }]);
  });

  it('pior de dois estados', () => {
    expect(pior('disponivel', 'limitado')).toBe('limitado');
    expect(pior('bloqueado', 'limitado')).toBe('bloqueado');
    expect(pior('disponivel', 'disponivel')).toBe('disponivel');
  });

  it('a saúde guardada volta ao tipo — e o que não serve vira nulo', () => {
    expect(saudeGuardada({ entidades: [] })).toEqual({
      entidades: [],
      cobrancaLidos: [],
      cobrancaRecusada: [],
      cobrancaRecusadaEm: null,
      ultimaFalha: null,
    });
    expect(saudeGuardada(null)).toBeNull();
    expect(saudeGuardada({ entidades: 'x' })).toBeNull();
  });

  it('leitura gravada antes da calibração: `cobrancaLida: true` valia para os quatro campos', () => {
    expect(saudeGuardada({ entidades: [], cobrancaLida: true })?.cobrancaLidos).toEqual([
      'currency',
      'timezone_id',
      'primary_funding_id',
      'business_verification_status',
    ]);
    expect(saudeGuardada({ entidades: [], cobrancaLida: false })?.cobrancaLidos).toEqual([]);
  });

  it('guarda quais campos da cobrança a Meta deixou ler, quais recusou e a última falha', () => {
    const g = saudeGuardada({
      entidades: [],
      cobrancaLidos: ['currency', 'timezone_id', 'campo_inventado'],
      cobrancaRecusada: [{ campo: 'primary_funding_id', codigo: 100 }, { campo: 'outro', codigo: 1 }, 'lixo'],
      cobrancaRecusadaEm: '2026-10-02T03:22:00.000Z',
      ultimaFalha: { codigo: 190, em: '2026-10-02T03:25:00.000Z' },
    })!;
    expect(g.cobrancaLidos).toEqual(['currency', 'timezone_id']);
    expect(g.cobrancaRecusada).toEqual([{ campo: 'primary_funding_id', codigo: 100 }]);
    expect(g.cobrancaRecusadaEm).toEqual(new Date('2026-10-02T03:22:00.000Z'));
    expect(g.ultimaFalha).toEqual({ codigo: 190, em: new Date('2026-10-02T03:25:00.000Z') });
    // Data que não é data não vira falha.
    expect(saudeGuardada({ entidades: [], ultimaFalha: { codigo: 190, em: 'ontem' } })?.ultimaFalha).toBeNull();
  });
});

describe('problemaDaSaude — o que a tela diz de cada bloqueio', () => {
  const conta: Pick<EntidadeDaSaude, 'tipo' | 'estado'> = { tipo: 'conta', estado: 'bloqueado' };
  const erro = lerSaude(BLOQUEADO)!.entidades[0]!.erros[0]!;

  it('o título diz O QUE está com problema e QUANTO, em português; a frase da Meta fica à parte', () => {
    const p = problemaDaSaude(conta, erro);
    expect(p.titulo).toBe('A Meta bloqueou o envio por um problema da conta do WhatsApp');
    expect(`${p.titulo} ${p.explicacao} ${p.acao}`).not.toMatch(/payment|There|https?:/);
    expect(p.daMeta).toMatch(/^There is an error with the payment method\. There was an error/);
    expect(p.codigo).toBe(141006);
    expect(p.quem).toBe('voce');
    expect(p.acao).toMatch(/O que a Meta respondeu/);
    expect(p.acao).toMatch(/código 141006/);
  });

  it('o endereço que a Meta manda na solução vira o botão', () => {
    expect(problemaDaSaude(conta, erro).link).toEqual({ rotulo: 'Abrir na Meta', url: 'https://business.facebook.com/billing_hub/x' });
  });

  it('restrição não é bloqueio: o texto diz que as mensagens saem', () => {
    const p = problemaDaSaude({ tipo: 'numero', estado: 'limitado' }, null, ['Display name not approved.']);
    expect(p.titulo).toBe('A Meta limitou o envio por um problema do número');
    expect(p.explicacao).toMatch(/As mensagens saem, mas com restrição/);
    expect(p.daMeta).toBe('Display name not approved.');
    expect(p.codigo).toBeNull();
  });

  it('problema do aplicativo é conosco: manda falar com o suporte', () => {
    const p = problemaDaSaude({ tipo: 'aplicativo', estado: 'bloqueado' }, { codigo: 141010, descricao: 'App is blocked.', solucao: '' });
    expect(p.quem).toBe('nos');
    expect(p.acao).toBe('Fale com o suporte informando o código 141010: é conosco.');
  });

  it('sem frase nenhuma da Meta, não promete "veja abaixo"', () => {
    const p = problemaDaSaude(conta, null);
    expect(p.daMeta).toBeNull();
    expect(p.acao).not.toMatch(/O que a Meta respondeu/);
    expect(p.acao).toMatch(/Gerenciador do WhatsApp/);
  });
});

describe('saudeParaTela — o sinal e a lista', () => {
  it('tudo em ordem: pode enviar, com um item por coisa conferida', () => {
    const s = saudeParaTela(dados());
    expect(s.sinal).toBe('pode_enviar');
    expect(s.titulo).toBe('Pode enviar');
    expect(s.itens.map((i) => i.chave).sort()).toEqual(
      ['aplicativo', 'conexao', 'conta', 'empresa', 'numero:106540352242922', 'pagamento'].sort(),
    );
    expect(s.itens.every((i) => i.sinal === 'pode_enviar' && i.problemas.length === 0)).toBe(true);
    expect(item('pagamento', dados())!.resumo).toBe('Cobrança em BRL, com forma de pagamento cadastrada.');
    expect(item('numero:106540352242922', dados())!.rotulo).toBe('Número +5521999990000');
    expect(oQueImpedeOEnvio(s)).toBeNull();
  });

  it('a conta bloqueada pela Meta: o sinal é bloqueado, o item vem primeiro, e barra o disparo', () => {
    const lida = lerSaude(BLOQUEADO)!;
    const d = dados({ conta: { estado: lida.estado, entidades: lida.entidades, lidaEm: AGORA } });
    const s = saudeParaTela(d);

    expect(s.sinal).toBe('bloqueado');
    expect(s.titulo).toBe('Não pode enviar agora');
    expect(s.itens[0]!.chave).toBe('conta');
    expect(s.itens[0]!.problemas[0]!.codigo).toBe(141006);
    // O aplicativo limitado também aparece, com a informação da Meta à parte.
    expect(item('aplicativo', d)).toMatchObject({ sinal: 'com_restricao' });
    expect(item('aplicativo', d)!.problemas[0]!.daMeta).toBe('Your app is in development mode.');
    expect(s.resumo).toMatch(/^Há 2 pontos a resolver/);
    expect(oQueImpedeOEnvio(s)?.codigo).toBe(141006);
  });

  it('o número bloqueado barra; conta, empresa e aplicativo repetidos na leitura do número não duplicam', () => {
    const d = dados({
      numeros: [
        {
          phoneNumberId: '106540352242922',
          telefone: '+5521999990000',
          saude: {
            estado: 'bloqueado',
            entidades: [
              { tipo: 'numero', id: '106540352242922', estado: 'bloqueado', erros: [{ codigo: 141000, descricao: 'Phone number is not registered.', solucao: 'Register it.' }], info: [] },
              { tipo: 'conta', id: '1', estado: 'disponivel', erros: [], info: [] },
            ],
          },
        },
      ],
    });
    const s = saudeParaTela(d);
    expect(s.sinal).toBe('bloqueado');
    expect(s.itens.filter((i) => i.chave === 'conta')).toHaveLength(1);
    expect(oQueImpedeOEnvio(s)?.titulo).toBe('A Meta bloqueou o envio por um problema do número');
  });

  it('pagamento: sem moeda e sem forma de pagamento é AVISO nosso — atenção, com o botão, e não barra', () => {
    const d = dados({ cobranca: { moedaLida: true, pagamentoLido: true, moeda: null, fuso: null, pagamentoId: null, url: 'https://business.facebook.com/billing_hub/accounts/details/?business_id=1&asset_id=2&account_type=whatsapp-business-account' } });
    const s = saudeParaTela(d);
    const p = item('pagamento', d)!;

    expect(s.sinal).toBe('com_restricao');
    expect(p.sinal).toBe('com_restricao');
    expect(p.resumo).toBe('A Meta não informa a moeda e a forma de pagamento desta conta.');
    expect(p.problemas[0]).toMatchObject({ titulo: 'Confira o pagamento da conta na Meta', quem: 'voce' });
    expect(p.problemas[0]!.link).toEqual({ rotulo: 'Abrir o pagamento na Meta', url: d.cobranca.url });
    expect(oQueImpedeOEnvio(s)).toBeNull();
  });

  it('pagamento: diz exatamente o que falta', () => {
    const so = (c: Partial<DadosDaSaude['cobranca']>) => item('pagamento', dados({ cobranca: { ...dados().cobranca, ...c } }))!.resumo;
    expect(so({ moeda: null })).toBe('A Meta não informa a moeda desta conta.');
    expect(so({ pagamentoId: null })).toBe('A Meta não informa a forma de pagamento desta conta.');
  });

  it('pagamento que não deu para ler não aparece: nada é afirmado', () => {
    const d = dados({ cobranca: { moedaLida: false, pagamentoLido: false, moeda: null, fuso: null, pagamentoId: null, url: null } });
    expect(item('pagamento', d)).toBeUndefined();
    expect(saudeParaTela(d).sinal).toBe('pode_enviar');
  });

  it('conexão: avisa na última semana e bloqueia quando venceu', () => {
    const em = (iso: string) => item('conexao', dados({ tokenExpiraEm: new Date(iso) }))!;
    expect(em('2026-10-20T12:00:00Z')).toMatchObject({ sinal: 'pode_enviar', resumo: 'Autorização em dia: vence em 18 dias.' });
    expect(em('2026-10-05T12:00:00Z')).toMatchObject({ sinal: 'com_restricao', resumo: 'A autorização vence em 3 dias.' });
    expect(em('2026-10-03T12:00:00Z').resumo).toBe('A autorização vence em 1 dia.');
    expect(em('2026-10-01T12:00:00Z')).toMatchObject({ sinal: 'bloqueado', resumo: 'A autorização venceu.' });
    expect(em('2026-10-01T12:00:00Z').problemas[0]).toMatchObject({ tela: 'whatsapp', quem: 'voce' });
    expect(item('conexao', dados({ tokenExpiraEm: null }))!.sinal).toBe('pode_enviar');
  });

  it('autorização vencida barra o disparo; para vencer, não', () => {
    expect(oQueImpedeOEnvio(saudeParaTela(dados({ tokenExpiraEm: new Date('2026-10-01T12:00:00Z') })))?.titulo).toBe('A autorização da conta venceu');
    expect(oQueImpedeOEnvio(saudeParaTela(dados({ tokenExpiraEm: new Date('2026-10-05T12:00:00Z') })))).toBeNull();
  });

  it('nunca lida: "ainda não conferimos" — e não "pode enviar"', () => {
    const s = saudeParaTela(dados({ conta: null, numeros: [], cobranca: { moedaLida: false, pagamentoLido: false, moeda: null, fuso: null, pagamentoId: null, url: null } }));
    expect(s.sinal).toBe('desconhecido');
    expect(s.titulo).toBe('Ainda não conferimos com a Meta');
    expect(s.lidaEm).toBeNull();
    expect(oQueImpedeOEnvio(s)).toBeNull();
  });

  it('nunca lida, mas com a autorização vencida: o que se sabe aparece', () => {
    const s = saudeParaTela(dados({ conta: null, numeros: [], tokenExpiraEm: new Date('2026-09-01T12:00:00Z') }));
    expect(s.sinal).toBe('bloqueado');
  });

  it('nenhum texto da tela traz inglês da Meta nem nome de campo', () => {
    const lida = lerSaude(BLOQUEADO)!;
    const s = saudeParaTela(dados({ conta: { estado: lida.estado, entidades: lida.entidades, lidaEm: AGORA } }));
    for (const i of s.itens) {
      for (const frase of [i.rotulo, i.resumo, ...i.problemas.flatMap((p) => [p.titulo, p.explicacao, p.acao ?? ''])]) {
        expect(frase).not.toMatch(/\b(the|payment|error|your|blocked)\b/i);
        expect(frase).not.toMatch(/[a-z]_[a-z]/);
      }
    }
  });
});

/**
 * O que a primeira leitura real mostrou (02/10/2026, conta em coexistência). O
 * `health_status` abaixo é o que a Meta devolveu para o número, com os ids
 * trocados.
 */
describe('calibração com a leitura real', () => {
  const NUMERO_REAL = {
    can_send_message: 'LIMITED',
    entities: [
      {
        entity_type: 'PHONE_NUMBER',
        id: '106540352242922',
        can_send_message: 'LIMITED',
        errors: [
          {
            error_code: 138024,
            error_description: 'WhatsApp Business calling cannot use SIP because it is not enabled',
            possible_solution: 'Configure SIP using {PHONE_NUMBER_ID}/settings API',
          },
        ],
        additional_info: ['Your display name has not been approved yet. Your message limit will increase after the display name is approved.'],
      },
      { entity_type: 'WABA', id: '1578', can_send_message: 'AVAILABLE' },
      { entity_type: 'BUSINESS', id: '3237', can_send_message: 'AVAILABLE' },
      {
        entity_type: 'APP',
        id: '111',
        can_send_message: 'AVAILABLE',
        errors: [
          {
            error_code: 138025,
            error_description: 'This app cannot use SIP for WhatsApp Business calling because it has not configured a SIP server for this business phone number',
            possible_solution: 'Configure SIP server using {PHONE_NUMBER_ID}/settings API',
          },
        ],
      },
    ],
  };
  const doNumero = lerSaude(NUMERO_REAL)!;
  const tela = () =>
    saudeParaTela(
      dados({
        conta: { estado: 'disponivel', entidades: doNumero.entidades.filter((e) => e.tipo !== 'numero'), lidaEm: AGORA },
        numeros: [{ phoneNumberId: '106540352242922', telefone: '+5521999990000', saude: { estado: doNumero.estado, entidades: doNumero.entidades } }],
      }),
    );
  const itemDe = (chave: string, s: SaudeParaTela) => s.itens.find((i) => i.chave === chave);

  it.each([
    [{ codigo: 138024, descricao: 'x', solucao: '' }, true],
    [{ codigo: 138000, descricao: 'x', solucao: '' }, true],
    [{ codigo: null, descricao: 'This app cannot use SIP', solucao: '' }, true],
    [{ codigo: 999, descricao: 'Calling is not enabled', solucao: '' }, true],
    [{ codigo: 141006, descricao: 'There is an error with the payment method.', solucao: '' }, false],
    [{ codigo: 137999, descricao: 'x', solucao: '' }, false],
    [{ codigo: 139000, descricao: 'x', solucao: '' }, false],
  ])('erro de chamadas de voz: %j → %s', (erro, esperado) => {
    expect(ehDeChamadas(erro)).toBe(esperado);
  });

  it('o erro de chamadas (SIP) NÃO vira o motivo do número limitado', () => {
    const problemas = itemDe('numero:106540352242922', tela())!.problemas;
    expect(problemas).toHaveLength(1);
    expect(JSON.stringify(problemas)).not.toMatch(/SIP|calling|138024/);
  });

  it('o motivo de verdade veio em additional_info: o nome de exibição ainda não aprovado', () => {
    const [problema] = itemDe('numero:106540352242922', tela())!.problemas;
    expect(problema).toEqual({
      codigo: null,
      titulo: 'O nome de exibição do número ainda não foi aprovado',
      explicacao:
        'Enquanto a Meta não aprova o nome de exibição, o número envia com um limite menor de mensagens. O limite aumenta quando o nome for aprovado.',
      acao: 'Confira o nome de exibição do número no Gerenciador do WhatsApp, na Meta. Se ele foi recusado, ajuste e envie de novo.',
      quem: 'voce',
      tela: null,
      link: null,
      daMeta: 'Your display name has not been approved yet. Your message limit will increase after the display name is approved.',
    });
  });

  it('o aplicativo DISPONÍVEL com erro de chamadas continua sem problema', () => {
    expect(itemDe('aplicativo', tela())).toMatchObject({ sinal: 'pode_enviar', problemas: [] });
  });

  it('o sinal geral é "envia com restrição", com 1 ponto de atenção — e não barra o disparo', () => {
    const s = tela();
    expect(s.sinal).toBe('com_restricao');
    expect(s.resumo).toMatch(/^Há 1 ponto de atenção/);
    expect(oQueImpedeOEnvio(s)).toBeNull();
  });

  it('informação que não conhecemos: o texto genérico, com a frase da Meta à parte', () => {
    const lida = lerSaude({
      can_send_message: 'LIMITED',
      entities: [{ entity_type: 'PHONE_NUMBER', id: '1', can_send_message: 'LIMITED', additional_info: ['Something new from Meta.'] }],
    })!;
    const s = saudeParaTela(dados({ numeros: [{ phoneNumberId: '1', telefone: null, saude: { estado: lida.estado, entidades: lida.entidades } }] }));
    expect(itemDe('numero:1', s)!.problemas[0]).toMatchObject({
      titulo: 'A Meta limitou o envio por um problema do número',
      daMeta: 'Something new from Meta.',
    });
  });

  it('erro de mensagens com informação junto: a informação acompanha a frase da Meta', () => {
    const lida = lerSaude({
      can_send_message: 'BLOCKED',
      entities: [
        {
          entity_type: 'WABA',
          id: '1',
          can_send_message: 'BLOCKED',
          errors: [
            { error_code: 138024, error_description: 'calling cannot use SIP', possible_solution: '' },
            { error_code: 141006, error_description: 'Payment issue.', possible_solution: 'Add a payment method.' },
          ],
          additional_info: ['Restricted since Monday.'],
        },
      ],
    })!;
    const s = saudeParaTela(dados({ conta: { estado: lida.estado, entidades: lida.entidades, lidaEm: AGORA } }));
    expect(itemDe('conta', s)!.problemas).toHaveLength(1);
    expect(itemDe('conta', s)!.problemas[0]).toMatchObject({ codigo: 141006, daMeta: 'Payment issue. Add a payment method. Restricted since Monday.' });
  });
});

describe('a cobrança só afirma o que foi lido', () => {
  const cobranca = (c: Partial<DadosDaSaude['cobranca']>) => ({
    cobranca: { moedaLida: true, pagamentoLido: true, moeda: 'BRL', fuso: '25', pagamentoId: '2056000000000001', url: null, ...c },
  });
  const pagamento = (c: Partial<DadosDaSaude['cobranca']>) => saudeParaTela(dados(cobranca(c))).itens.find((i) => i.chave === 'pagamento');

  it('a Meta não deixou ler a forma de pagamento: diz só a moeda, sem alarme', () => {
    expect(pagamento({ pagamentoLido: false, pagamentoId: null })).toMatchObject({ sinal: 'pode_enviar', resumo: 'Cobrança em BRL.', problemas: [] });
  });

  it('leu a forma de pagamento e veio vazia: aí sim, atenção', () => {
    const p = pagamento({ pagamentoId: null })!;
    expect(p.sinal).toBe('com_restricao');
    expect(p.resumo).toBe('A Meta não informa a forma de pagamento desta conta.');
  });

  it('não deixou ler a moeda, mas a forma de pagamento sim', () => {
    expect(pagamento({ moedaLida: false, moeda: null })).toMatchObject({ sinal: 'pode_enviar', resumo: 'Forma de pagamento cadastrada.' });
  });

  it('não deixou ler nenhum dos dois: o item nem aparece', () => {
    expect(pagamento({ moedaLida: false, pagamentoLido: false, moeda: null, pagamentoId: null })).toBeUndefined();
  });
});

describe('a última conferência falhou', () => {
  const ha = (minutos: number) => new Date(AGORA.getTime() - minutos * 60_000);
  const semCobranca = { moedaLida: false, pagamentoLido: false, moeda: null, fuso: null, pagamentoId: null, url: null };
  const conexao = (s: SaudeParaTela) => s.itens.find((i) => i.chave === 'conexao')!;

  it('conta nunca lida e a Meta recusou a autorização (190): a conexão caiu, e a tela diz', () => {
    const s = saudeParaTela(dados({ conta: null, numeros: [], falha: { codigo: 190, em: ha(1) } }));
    expect(s.sinal).toBe('bloqueado');
    expect(conexao(s)).toMatchObject({ sinal: 'bloqueado', resumo: 'A Meta recusou a autorização desta conta.' });
    expect(conexao(s).problemas[0]).toMatchObject({ codigo: 190, titulo: 'A conexão com a Meta caiu', tela: 'whatsapp' });
  });

  it('outro código: NÃO afirma que a conexão caiu — pode ser só um campo que a Meta não deixa ler', () => {
    const s = saudeParaTela(dados({ conta: null, numeros: [], cobranca: semCobranca, falha: { codigo: 100, em: ha(1) } }));
    expect(s.sinal).toBe('desconhecido');
    expect(conexao(s).sinal).toBe('pode_enviar');
    expect(s.resumo).toBe(
      'A Meta não respondeu à última conferência (código 100). O Regemcast tenta de novo a cada 30 minutos; se continuar, fale com o suporte.',
    );
  });

  it('falha sem código (rede): diz que não respondeu, sem inventar número', () => {
    const s = saudeParaTela(dados({ conta: null, numeros: [], cobranca: semCobranca, falha: { codigo: null, em: ha(1) } }));
    expect(s.resumo).toMatch(/^A Meta não respondeu à última conferência\. O Regemcast tenta/);
  });

  it('falha MAIS ANTIGA que a última leitura boa não conta: a leitura boa vale', () => {
    const s = saudeParaTela(dados({ conta: { estado: 'disponivel', entidades: [], lidaEm: ha(5) }, falha: { codigo: 190, em: ha(60) } }));
    expect(conexao(s).sinal).toBe('pode_enviar');
    expect(s.sinal).toBe('pode_enviar');
  });

  it('190 DEPOIS da última leitura boa: a conexão caiu, mesmo com leitura antiga dizendo "disponível"', () => {
    const s = saudeParaTela(dados({ conta: { estado: 'disponivel', entidades: [], lidaEm: ha(60) }, falha: { codigo: 190, em: ha(5) } }));
    expect(s.sinal).toBe('bloqueado');
    expect(conexao(s).problemas[0]!.titulo).toBe('A conexão com a Meta caiu');
  });
});
