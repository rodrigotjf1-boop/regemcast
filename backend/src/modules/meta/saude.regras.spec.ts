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
  lerSaude,
  oQueImpedeOEnvio,
  pior,
  problemaDaSaude,
  saudeGuardada,
  saudeParaTela,
  type DadosDaSaude,
  type EntidadeDaSaude,
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
  cobranca: { lida: true, moeda: 'BRL', fuso: 'America/Sao_Paulo', pagamentoId: '2056000000000001', url: 'https://business.facebook.com/billing_hub/accounts/details/?business_id=1&asset_id=2&account_type=whatsapp-business-account' },
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
    expect(saudeGuardada({ entidades: [], cobrancaLida: true })).toEqual({ entidades: [], cobrancaLida: true });
    expect(saudeGuardada({ entidades: [] })?.cobrancaLida).toBe(false);
    expect(saudeGuardada(null)).toBeNull();
    expect(saudeGuardada({ entidades: 'x' })).toBeNull();
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
    const d = dados({ cobranca: { lida: true, moeda: null, fuso: null, pagamentoId: null, url: 'https://business.facebook.com/billing_hub/accounts/details/?business_id=1&asset_id=2&account_type=whatsapp-business-account' } });
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
    const d = dados({ cobranca: { lida: false, moeda: null, fuso: null, pagamentoId: null, url: null } });
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
    const s = saudeParaTela(dados({ conta: null, numeros: [], cobranca: { lida: false, moeda: null, fuso: null, pagamentoId: null, url: null } }));
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
