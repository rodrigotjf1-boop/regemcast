import {
  codigoDoErro,
  deveRetentar,
  mensagemDoErroMeta,
  traduzirErroMeta,
} from './erros-meta';

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
    expect(t.explicacao).toMatch(/não está mapeado/i);
    // Desconhecido NÃO retenta: retentar em laço queimaria destinatário.
    expect(deveRetentar(t)).toBe(false);
  });

  it('repassa a mensagem da Meta quando não conhece o código', () => {
    const t = traduzirErroMeta(999999, 'Something went terribly wrong');
    expect(t.explicacao).toContain('Something went terribly wrong');
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
