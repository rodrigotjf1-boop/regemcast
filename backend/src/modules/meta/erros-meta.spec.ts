import {
  ACAO_SEM_NOVA_TENTATIVA,
  codigoDoErro,
  deveRetentar,
  erroParaTela,
  erroSemCodigo,
  frasesDoErro,
  linkNaMensagemDaMeta,
  mensagemDoErroMeta,
  pausaPorErro,
  tituloDoErroMeta,
  traduzirErroMeta,
} from './erros-meta';

/** A frase que a Meta mandou no teste do dono, em 01/10/2026 (ids trocados). */
const FRASE_DO_PAGAMENTO =
  'Message failed to send because your WhatsApp Business account currency is not configured. Visit https://business.facebook.com/billing_hub/accounts/details/?business_id=111&asset_id=222&wizard_name=CHANGE_COUNTRY_CURRENCY&account_type=whatsapp-business-account to resolve this issue.';

/** Todos os códigos da lista oficial que o catálogo cobre (conferida em 01/10/2026). */
const DA_LISTA_OFICIAL = [
  0, 1, 2, 3, 4, 10, 33, 100, 190, 200, 299, 368, 80007, 130403, 130429, 130472, 130497, 131000, 131005, 131008,
  131009, 131016, 131021, 131026, 131031, 131037, 131042, 131045, 131047, 131048, 131049, 131050, 131051, 131052,
  131053, 131056, 131057, 131063, 131064, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 132068, 132069,
  133000, 133004, 133005, 133006, 133008, 133009, 133010, 133015, 133016, 134011, 135000, 2388012, 2388019, 2388039,
  2388040, 2388047, 2388072, 2388073, 2388293, 2388299, 2593107, 2593108,
];

describe('traduzirErroMeta', () => {
  it('traduz os códigos que já apareceram em produção', () => {
    expect(traduzirErroMeta(133010).titulo).toMatch(/registrado/i);
    expect(traduzirErroMeta(132000).titulo).toMatch(/variáve/i);
    expect(traduzirErroMeta(131049).titulo).toMatch(/segurou/i);
    expect(traduzirErroMeta(131026).titulo).toMatch(/não recebe/i);
    expect(traduzirErroMeta(131050).titulo).toBe('Parou o marketing pelo WhatsApp');
  });

  it('escreve para quem opera, não para quem programa', () => {
    // A explicação precisa dizer o que fazer. Nada de "invalid parameter".
    for (const codigo of [133010, 132000, 132001, 131049, 131026, 190]) {
      const t = traduzirErroMeta(codigo);
      expect(t.explicacao.length).toBeGreaterThan(40);
      expect(t.explicacao).not.toMatch(/[a-z]_[a-z]/); // sem nome_de_campo cru
      expect(t.explicacao).toMatch(/[.!]$/); // frase terminada
    }
  });

  it('não inventa diagnóstico para código desconhecido', () => {
    const t = traduzirErroMeta(999999);
    expect(t.titulo).toContain('999999');
    expect(t.explicacao).toMatch(/ainda não conhece/i);
    expect(t.acao).toContain('999999');
    expect(t.quem).toBe('nos');
    // Desconhecido NÃO retenta: retentar em laço queimaria destinatário.
    expect(deveRetentar(t)).toBe(false);
  });

  it('código desconhecido: a frase da Meta fica guardada à parte, nunca no meio da explicação', () => {
    const t = traduzirErroMeta(999999, 'Something went terribly wrong');
    expect(t.daMeta).toBe('Something went terribly wrong');
    expect(t.explicacao).not.toContain('Something');
    expect(t.titulo).not.toContain('Something');
  });

  it('código conhecido: a frase da Meta fica à parte, e a explicação continua a nossa', () => {
    const t = traduzirErroMeta(132012, 'Parameter of type image is missing');
    expect(t.daMeta).toBe('Parameter of type image is missing');
    expect(t.explicacao).not.toContain('Parameter');
    expect(traduzirErroMeta(131026).daMeta).toBeUndefined();
  });

  it('sem código não é "código 0": 0 é credencial na lista da Meta, e ausência não é', () => {
    const semCodigo = traduzirErroMeta(null);
    expect(semCodigo.classe).toBe('config');
    expect(semCodigo.titulo).toBe('A Meta recusou a mensagem');
    expect(pausaPorErro(semCodigo)).toBeNull();
    expect(traduzirErroMeta(0).classe).toBe('credencial');
  });

  it('prefere a nossa frase à da Meta quando conhece o código', () => {
    // A frase deles vem em inglês e escrita para quem programa.
    const t = traduzirErroMeta(133010, 'Phone number not registered');
    expect(t.explicacao).not.toContain('Phone number not registered');
    expect(t.explicacao).toMatch(/registrad/i);
  });

  it('aguenta código ausente ou inválido', () => {
    expect(traduzirErroMeta(null).codigo).toBe(0);
    expect(traduzirErroMeta(undefined).codigo).toBe(0);
    expect(traduzirErroMeta(Number.NaN).codigo).toBe(0);
  });
});

describe('o catálogo guia: o que houve, o que fazer e quem resolve', () => {
  it.each(DA_LISTA_OFICIAL)('%d está no catálogo, com as duas frases em português', (codigo) => {
    const t = traduzirErroMeta(codigo);
    expect(t.titulo).not.toMatch(/código/i); // "código N" é o título de quem NÃO está no catálogo
    for (const frase of [t.explicacao, t.acao]) {
      expect(frase.length).toBeGreaterThan(15);
      expect(frase).toMatch(/[.!]$/);
      expect(frase).not.toMatch(/[a-z]_[a-z]/); // sem nome_de_campo cru
      expect(frase).not.toMatch(/\b(the|failed|message|invalid|error)\b/i); // sem inglês da Meta
    }
    expect(t.titulo.length).toBeLessThanOrEqual(52); // cabe na coluna e no aviso do celular
    expect(['voce', 'nos', 'ninguem']).toContain(t.quem);
  });

  it('não promete nova tentativa em erro que não é retentado', () => {
    for (const codigo of DA_LISTA_OFICIAL) {
      const t = traduzirErroMeta(codigo);
      if (!deveRetentar(t)) expect(`${t.explicacao} ${t.acao}`).not.toMatch(/tentamos de novo|retoma sozinha/i);
    }
  });

  it('erro passageiro que virou falha definitiva não diz "tentamos de novo sozinhos"', () => {
    const tela = erroParaTela(traduzirErroMeta(131016), { definitivo: true });
    expect(tela.acao).toBe(ACAO_SEM_NOVA_TENTATIVA);
    expect(tela.quem).toBe('ninguem');
    // Enquanto ainda vai tentar, a ação é a do catálogo.
    expect(erroParaTela(traduzirErroMeta(131016)).acao).toMatch(/tentamos de novo sozinhos/);
    // E a recusa que não é passageira não muda por ser definitiva.
    expect(erroParaTela(traduzirErroMeta(131026), { definitivo: true }).acao).toBe(traduzirErroMeta(131026).acao);
    expect(erroParaTela(traduzirErroMeta(131049), { definitivo: true }).acao).toMatch(/24 horas/);
  });

  it('a frase gravada no dia da falha entra no lugar da explicação, quando é passada', () => {
    const tela = erroParaTela(traduzirErroMeta(130429), {
      definitivo: true,
      explicacao: 'A Meta recusou 4 vezes seguidas (ritmo acima do permitido).',
    });
    expect(tela.explicacao).toBe('A Meta recusou 4 vezes seguidas (ritmo acima do permitido).');
    expect(frasesDoErro(tela)).toBe(`A Meta recusou 4 vezes seguidas (ritmo acima do permitido). ${ACAO_SEM_NOVA_TENTATIVA}`);
  });

  it('200 a 299 é permissão retirada, como o 10', () => {
    for (const codigo of [200, 250, 299]) {
      expect(traduzirErroMeta(codigo).titulo).toBe(traduzirErroMeta(10).titulo);
      expect(traduzirErroMeta(codigo).classe).toBe('credencial');
    }
    expect(traduzirErroMeta(300).titulo).toContain('300');
  });

  it('erro nosso (rede, resposta sem identificador) tem as mesmas duas partes e não pausa nada', () => {
    const t = erroSemCodigo({ classe: 'transitorio', titulo: 'Sem conexão', explicacao: 'A conexão caiu.', acao: 'Tente de novo.' });
    expect(t.alcance).toBe('passageiro');
    expect(frasesDoErro(t)).toBe('A conexão caiu. Tente de novo.');
    expect(pausaPorErro(t)).toBeNull();
  });
});

describe('131042 — o pagamento da conta na Meta (o teste do dono, 01/10/2026)', () => {
  const t = traduzirErroMeta(131042, FRASE_DO_PAGAMENTO);

  it('diz o que houve e o que fazer, em português, sem a frase da Meta no meio', () => {
    expect(t.titulo).toBe('Falta acertar o pagamento na Meta');
    expect(t.explicacao).toMatch(/pagamento da conta do WhatsApp Business/);
    expect(t.acao).toMatch(/Acerte o pagamento/);
    expect(`${t.titulo} ${t.explicacao} ${t.acao}`).not.toMatch(/https?:|Message failed/);
    expect(t.quem).toBe('voce');
  });

  it('o endereço que a Meta mandou vira o botão, com rótulo curto', () => {
    expect(t.link).toEqual({
      rotulo: 'Abrir o pagamento na Meta',
      url: 'https://business.facebook.com/billing_hub/accounts/details/?business_id=111&asset_id=222&wizard_name=CHANGE_COUNTRY_CURRENCY&account_type=whatsapp-business-account',
    });
    expect(t.daMeta).toBe(FRASE_DO_PAGAMENTO);
  });

  it('é da CONTA: a campanha para; e não é retentado', () => {
    expect(t.alcance).toBe('conta');
    expect(pausaPorErro(t)).toBe('conta_meta');
    expect(deveRetentar(t)).toBe(false);
  });

  it('sem a frase da Meta, não inventa endereço', () => {
    expect(traduzirErroMeta(131042).link).toBeUndefined();
  });
});

describe('linkNaMensagemDaMeta — só endereço da própria Meta vira botão', () => {
  it('tira a pontuação que vem colada no fim', () => {
    expect(linkNaMensagemDaMeta('Veja https://business.facebook.com/a?b=1.')).toBe('https://business.facebook.com/a?b=1');
    expect(linkNaMensagemDaMeta('(https://www.facebook.com/x)')).toBe('https://www.facebook.com/x');
  });

  it('aceita os domínios da Meta e nenhum outro', () => {
    expect(linkNaMensagemDaMeta('https://developers.facebook.com/docs')).toBe('https://developers.facebook.com/docs');
    expect(linkNaMensagemDaMeta('https://business.whatsapp.com/policy')).toBe('https://business.whatsapp.com/policy');
    expect(linkNaMensagemDaMeta('https://facebook.com.golpe.example/pagar')).toBeNull();
    expect(linkNaMensagemDaMeta('https://golpe.example/facebook.com')).toBeNull();
    expect(linkNaMensagemDaMeta('http://business.facebook.com/sem-tls')).toBeNull();
  });

  it('passa pelo endereço de fora e pega o da Meta', () => {
    expect(linkNaMensagemDaMeta('https://golpe.example/x e https://business.facebook.com/y')).toBe('https://business.facebook.com/y');
  });

  it('sem endereço, nulo', () => {
    expect(linkNaMensagemDaMeta('Message undeliverable')).toBeNull();
    expect(linkNaMensagemDaMeta(null)).toBeNull();
    expect(linkNaMensagemDaMeta('')).toBeNull();
  });
});

describe('pausaPorErro — o erro que não é da pessoa para a campanha na primeira', () => {
  it.each([132000, 132001, 132005, 132007, 132012, 132015, 132016, 131053])('%d é do modelo', (codigo) => {
    expect(pausaPorErro(traduzirErroMeta(codigo))).toBe('modelo');
  });

  it.each([131042, 131031, 368, 131048, 131063, 131064, 131037, 131045, 133010, 134011, 33])(
    '%d é da conta na Meta',
    (codigo) => {
      expect(pausaPorErro(traduzirErroMeta(codigo))).toBe('conta_meta');
    },
  );

  it.each([190, 0, 3, 10, 131005, 200, 299])('%d é credencial: a pausa é a de conexão', (codigo) => {
    expect(pausaPorErro(traduzirErroMeta(codigo))).toBe('conexao');
  });

  it.each([131026, 131049, 131050, 131021, 130472, 130497, 131009, 100, 130429, 131016, 80007, 999999])(
    '%d é da pessoa, ou passageiro: a rodada segue',
    (codigo) => {
      expect(pausaPorErro(traduzirErroMeta(codigo))).toBeNull();
    },
  );

  it('código fora da lista: o intervalo diz a quem atinge', () => {
    expect(pausaPorErro(traduzirErroMeta(132099))).toBe('modelo');
    expect(pausaPorErro(traduzirErroMeta(133099))).toBe('conta_meta');
    expect(pausaPorErro(traduzirErroMeta(131999))).toBeNull();
  });
});

describe('tituloDoErroMeta — a bolha da conversa', () => {
  it('código conhecido: o nosso título, em português', () => {
    expect(tituloDoErroMeta(131042, 'Business eligibility payment issue')).toBe('Falta acertar o pagamento na Meta');
    expect(tituloDoErroMeta(131047, 'Re-engagement message')).toBe('Janela de 24 horas fechada');
  });

  it('código desconhecido: o título da Meta, que ainda diz mais que "código N"', () => {
    expect(tituloDoErroMeta(999999, ' Something new ')).toBe('Something new');
    expect(tituloDoErroMeta(null, 'Sem código')).toBe('Sem código');
    expect(tituloDoErroMeta(null, null)).toBeNull();
  });
});

describe('deveRetentar — a decisão que custa dinheiro', () => {
  it('retenta o que é soluço do outro lado', () => {
    // 131016 (serviço fora), 130429 (ritmo), 133004 (servidor ocupado).
    for (const c of [131016, 130429, 133004, 80007]) {
      expect(deveRetentar(traduzirErroMeta(c))).toBe(true);
    }
  });

  it('NÃO retenta erro permanente — repetir queima destinatário e cobra de novo', () => {
    for (const c of [131026, 131050, 132000, 132001, 132007, 132012, 132015, 132016, 133010, 133005]) {
      expect(deveRetentar(traduzirErroMeta(c))).toBe(false);
    }
  });

  it('131049 é retentável, mas só depois de 24 horas', () => {
    const t = traduzirErroMeta(131049);
    expect(deveRetentar(t)).toBe(true);
    expect(t.esperaSegundos).toBe(86_400);
  });

  it('não retenta com credencial caída — precisa reconectar antes', () => {
    const t = traduzirErroMeta(190);
    expect(t.classe).toBe('credencial');
    expect(deveRetentar(t)).toBe(false);
  });

  it('não retenta erro de política — exige ação humana, e rápido', () => {
    for (const c of [132007, 132015, 132016, 131048, 131031, 368]) {
      const t = traduzirErroMeta(c);
      expect(t.classe).toBe('politica');
      expect(deveRetentar(t)).toBe(false);
    }
  });

  it('todo código retentável diz quanto esperar', () => {
    for (const c of [131016, 130429, 133004, 80007, 131049, 133008]) {
      const t = traduzirErroMeta(c);
      if (deveRetentar(t)) expect(t.esperaSegundos).toBeGreaterThan(0);
    }
  });
});

describe('codigoDoErro — ler o código onde a Meta o esconde', () => {
  it('lê do formato de envio: { error: { code } }', () => {
    expect(codigoDoErro({ error: { code: 131049, message: 'x' } })).toBe(131049);
  });

  it('lê do webhook de status: { errors: [ { code } ] }', () => {
    // Ler só um dos dois formatos é o que faz metade dos erros chegar sem código.
    expect(codigoDoErro({ errors: [{ code: 131026, title: 'x' }] })).toBe(131026);
  });

  it('aceita código vindo como texto', () => {
    expect(codigoDoErro({ error: { code: '132000' } })).toBe(132000);
  });

  it('devolve null quando não há código, em vez de chutar zero', () => {
    expect(codigoDoErro({ error: { message: 'sem código' } })).toBeNull();
    expect(codigoDoErro({})).toBeNull();
    expect(codigoDoErro(null)).toBeNull();
    expect(codigoDoErro('texto solto')).toBeNull();
    expect(codigoDoErro({ errors: [] })).toBeNull();
  });
});

describe('mensagemDoErroMeta', () => {
  it('prefere error_user_msg, que é a frase que a Meta escreveu para o usuário', () => {
    expect(
      mensagemDoErroMeta({
        error: { message: 'técnico', error_user_msg: 'para o usuário' },
      }),
    ).toBe('para o usuário');
  });

  it('cai para o detalhe do error_data, que costuma ser o mais específico', () => {
    expect(
      mensagemDoErroMeta({
        error: { message: 'genérico', error_data: { details: 'o detalhe exato' } },
      }),
    ).toBe('o detalhe exato');
  });

  it('lê o detalhe do webhook de status', () => {
    expect(
      mensagemDoErroMeta({
        errors: [{ title: 'título', error_data: { details: 'detalhe do status' } }],
      }),
    ).toBe('detalhe do status');
  });

  it('devolve vazio sem estourar quando não há nada legível', () => {
    expect(mensagemDoErroMeta(null)).toBe('');
    expect(mensagemDoErroMeta({})).toBe('');
    expect(mensagemDoErroMeta('texto')).toBe('');
  });
});
