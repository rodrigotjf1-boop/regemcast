/**
 * Testes das regras de modelo.
 *
 * Cada caso aqui é uma recusa que a Meta já devolveu para alguém. O objetivo do
 * arquivo sob teste é que ela pare de acontecer lá, onde a mensagem é genérica
 * e chega horas depois, e passe a acontecer aqui, em português, na hora.
 */
import {
  BOTAO_SAIDA,
  botoesComSaida,
  conferirModelo,
  ehBotaoDeSaida,
  quantasVariaveis,
  variaveisDe,
  type ModeloParaValidar,
} from './regras-modelo';

/** Um modelo que passa em tudo — a base dos casos negativos. */
function modeloValido(): ModeloParaValidar {
  return {
    nome: 'promo_frete_gratis',
    idioma: 'pt_BR',
    categoria: 'MARKETING',
    corpo: 'Olá {{1}}, hoje o frete é por nossa conta.',
    corpoExemplos: ['Maria'],
  };
}

/** As mensagens de um campo, para o teste checar sem depender da ordem. */
function problemasDe(m: ModeloParaValidar, campo: string): string[] {
  return conferirModelo(m)
    .filter((p) => p.campo === campo)
    .map((p) => p.mensagem);
}

describe('modelo válido', () => {
  it('passa sem nenhum problema', () => {
    expect(conferirModelo(modeloValido())).toEqual([]);
  });

  it('devolve TODOS os problemas de uma vez, não só o primeiro', () => {
    // Corrigir um erro por vez, com uma ida ao servidor entre cada, é o que faz
    // a pessoa desistir no meio.
    const ruim: ModeloParaValidar = {
      ...modeloValido(),
      nome: 'Promo Frete',
      corpo: '',
      rodape: 'x'.repeat(100),
    };
    expect(conferirModelo(ruim).length).toBeGreaterThan(2);
  });
});

describe('nome técnico', () => {
  it('recusa maiúscula, espaço e acento', () => {
    for (const nome of ['Promo', 'promo frete', 'promoção', 'promo-frete']) {
      expect(problemasDe({ ...modeloValido(), nome }, 'nome')).not.toHaveLength(0);
    }
  });

  it('aceita minúscula, número e underline', () => {
    expect(problemasDe({ ...modeloValido(), nome: 'promo_2026_v2' }, 'nome')).toEqual([]);
  });
});

describe('variáveis do corpo', () => {
  it('recusa numeração que pula', () => {
    const m = { ...modeloValido(), corpo: 'Olá {{1}}, seu pedido {{3}} saiu.', corpoExemplos: ['a', 'b'] };
    expect(problemasDe(m, 'corpo').join(' ')).toContain('sequência');
  });

  it('recusa variável no começo da mensagem', () => {
    // Regra real da Meta, e que não aparece no formulário dela.
    const m = { ...modeloValido(), corpo: '{{1}}, temos novidade para você.' };
    expect(problemasDe(m, 'corpo').join(' ')).toContain('começar');
  });

  it('recusa variável no fim da mensagem', () => {
    const m = { ...modeloValido(), corpo: 'Seu código é {{1}}' };
    expect(problemasDe(m, 'corpo').join(' ')).toContain('terminar');
  });

  it('recusa duas variáveis coladas', () => {
    const m = { ...modeloValido(), corpo: 'Olá {{1}}{{2}}, tudo bem?', corpoExemplos: ['a', 'b'] };
    expect(problemasDe(m, 'corpo').join(' ')).toContain('coladas');
  });

  it('cobra um exemplo para cada variável', () => {
    const m = { ...modeloValido(), corpo: 'Olá {{1}}, seu pedido {{2}} saiu.', corpoExemplos: ['Maria'] };
    expect(problemasDe(m, 'corpo').join(' ')).toContain('exemplo');
  });

  it('conta variáveis DISTINTAS, não ocorrências', () => {
    // Contar ocorrências faz mandar dois exemplos para uma variável só — que é
    // exatamente o erro 132000 da Meta, o que a auditoria do Regem encontrou.
    expect(variaveisDe('Olá {{1}}, até logo {{1}}!')).toEqual([1, 1]);
    expect(quantasVariaveis('Olá {{1}}, até logo {{1}}!')).toBe(1);

    const m = { ...modeloValido(), corpo: 'Olá {{1}}, tudo bem? Até logo, {{1}}, e bom domingo!', corpoExemplos: ['Maria'] };
    expect(problemasDe(m, 'corpo')).toEqual([]);
  });

  it('aceita variável com espaço dentro das chaves', () => {
    expect(variaveisDe('Olá {{ 1 }}')).toEqual([1]);
  });
});

describe('oferta por tempo limitado', () => {
  it('só existe em MARKETING', () => {
    const m: ModeloParaValidar = { ...modeloValido(), categoria: 'UTILITY', ltoAtivo: true };
    expect(problemasDe(m, 'lto').join(' ')).toContain('MARKETING');
  });

  it('proíbe rodapé', () => {
    const m: ModeloParaValidar = { ...modeloValido(), ltoAtivo: true, rodape: 'Válido só hoje' };
    expect(problemasDe(m, 'rodape').join(' ')).toContain('rodapé');
  });

  it('proíbe cabeçalho de texto — imagem e vídeo continuam valendo', () => {
    const comTexto: ModeloParaValidar = {
      ...modeloValido(),
      ltoAtivo: true,
      cabecalhoFormato: 'TEXT',
      cabecalhoTexto: 'Oferta',
    };
    expect(problemasDe(comTexto, 'cabecalho')).not.toHaveLength(0);

    const comImagem: ModeloParaValidar = {
      ...modeloValido(),
      ltoAtivo: true,
      cabecalhoFormato: 'IMAGE',
      cabecalhoMidia: 'midia/123',
    };
    expect(problemasDe(comImagem, 'cabecalho')).toEqual([]);
  });
});

describe('cabeçalho de texto', () => {
  it('recusa quebra de linha e formatação', () => {
    for (const texto of ['Oferta\nda semana', 'Oferta *da* semana']) {
      const m: ModeloParaValidar = { ...modeloValido(), cabecalhoFormato: 'TEXT', cabecalhoTexto: texto };
      expect(problemasDe(m, 'cabecalho')).not.toHaveLength(0);
    }
  });

  it('aceita no máximo uma variável, e ela precisa ser {{1}}', () => {
    const duas: ModeloParaValidar = {
      ...modeloValido(),
      cabecalhoFormato: 'TEXT',
      cabecalhoTexto: 'Oi {{1}} {{2}}',
      cabecalhoExemplo: 'Maria',
    };
    expect(problemasDe(duas, 'cabecalho').join(' ')).toContain('uma variável');

    const errada: ModeloParaValidar = {
      ...modeloValido(),
      cabecalhoFormato: 'TEXT',
      cabecalhoTexto: 'Oi {{2}}',
      cabecalhoExemplo: 'Maria',
    };
    expect(problemasDe(errada, 'cabecalho').join(' ')).toContain('{{1}}');
  });

  it('exige o exemplo quando há variável', () => {
    // A Meta EXIGE `example.header_text` nesse caso. Sem ele a recusa é certa.
    const m: ModeloParaValidar = {
      ...modeloValido(),
      cabecalhoFormato: 'TEXT',
      cabecalhoTexto: 'Oferta pra você, {{1}}!',
    };
    expect(problemasDe(m, 'cabecalho').join(' ')).toContain('exemplo');
  });

  it('cobra o arquivo quando o cabeçalho é mídia', () => {
    const m: ModeloParaValidar = { ...modeloValido(), cabecalhoFormato: 'IMAGE' };
    expect(problemasDe(m, 'cabecalho').join(' ')).toContain('arquivo');
  });
});

describe('rodapé', () => {
  it('não aceita variáveis', () => {
    const m = { ...modeloValido(), rodape: 'Válido até {{1}}' };
    expect(problemasDe(m, 'rodape').join(' ')).toContain('variáveis');
  });

  it('respeita o limite de 60 caracteres', () => {
    const m = { ...modeloValido(), rodape: 'x'.repeat(61) };
    expect(problemasDe(m, 'rodape')).not.toHaveLength(0);
  });
});

describe('botões', () => {
  it('aceita no máximo 2 links, 1 telefone e 1 cupom', () => {
    const tresLinks: ModeloParaValidar = {
      ...modeloValido(),
      botoes: [
        { tipo: 'URL', texto: 'A', url: 'https://a.com' },
        { tipo: 'URL', texto: 'B', url: 'https://b.com' },
        { tipo: 'URL', texto: 'C', url: 'https://c.com' },
      ],
    };
    expect(problemasDe(tresLinks, 'botoes').join(' ')).toContain('2 botões de link');
  });

  it('cobra o link do botão de link, e exige http', () => {
    const semUrl: ModeloParaValidar = { ...modeloValido(), botoes: [{ tipo: 'URL', texto: 'Ir' }] };
    expect(problemasDe(semUrl, 'botoes').join(' ')).toContain('link');

    const semEsquema: ModeloParaValidar = {
      ...modeloValido(),
      botoes: [{ tipo: 'URL', texto: 'Ir', url: 'loja.com' }],
    };
    expect(problemasDe(semEsquema, 'botoes').join(' ')).toContain('https://');
  });

  it('cobra o texto do botão e respeita o limite', () => {
    const m: ModeloParaValidar = {
      ...modeloValido(),
      botoes: [{ tipo: 'QUICK_REPLY', texto: 'x'.repeat(26) }],
    };
    expect(problemasDe(m, 'botoes')).not.toHaveLength(0);
  });

  it('aceita a combinação máxima sem reclamar', () => {
    const m: ModeloParaValidar = {
      ...modeloValido(),
      botoes: [
        { tipo: 'URL', texto: 'Peça agora', url: 'https://loja.com' },
        { tipo: 'URL', texto: 'Ver site', url: 'https://site.com' },
        { tipo: 'PHONE_NUMBER', texto: 'Ligar', telefone: '5521999998888' },
        { tipo: 'QUICK_REPLY', texto: 'Sair das ofertas' },
      ],
    };
    expect(problemasDe(m, 'botoes')).toEqual([]);
  });
});

describe('limites de tamanho', () => {
  it('recusa corpo acima de 1024 caracteres', () => {
    const m = { ...modeloValido(), corpo: `Olá {{1}}, ${'x'.repeat(1030)}.` };
    expect(problemasDe(m, 'corpo').join(' ')).toContain('1024');
  });

  it('recusa cabeçalho acima de 60', () => {
    const m: ModeloParaValidar = {
      ...modeloValido(),
      cabecalhoFormato: 'TEXT',
      cabecalhoTexto: 'x'.repeat(61),
    };
    expect(problemasDe(m, 'cabecalho').join(' ')).toContain('60');
  });
});

describe('carrossel', () => {
  /** Um carrossel mínimo que passa: dois cartões iguais em estrutura. */
  function carrosselValido(): ModeloParaValidar {
    const cartao = {
      imagem: 'midia/1',
      corpo: 'Hambúrguer artesanal com fritas.',
      botoes: [{ tipo: 'URL' as const, texto: 'Peça agora', url: 'https://loja.com' }],
    };
    return {
      nome: 'catalogo_semana',
      idioma: 'pt_BR',
      categoria: 'MARKETING',
      tipo: 'carrossel',
      corpo: 'Olá {{1}}, veja o que separamos para hoje.',
      corpoExemplos: ['Maria'],
      cartoes: [cartao, { ...cartao, imagem: 'midia/2' }],
    };
  }

  it('passa com dois cartões bem formados', () => {
    expect(conferirModelo(carrosselValido())).toEqual([]);
  });

  it('exige pelo menos dois cartões', () => {
    const m = { ...carrosselValido(), cartoes: [carrosselValido().cartoes![0]] };
    expect(problemasDe(m, 'cartoes').join(' ')).toContain('2 cartões');
  });

  it('recusa mais de dez cartões', () => {
    const base = carrosselValido();
    const m = { ...base, cartoes: Array.from({ length: 11 }, () => base.cartoes![0]) };
    expect(problemasDe(m, 'cartoes').join(' ')).toContain('10 cartões');
  });

  it('cobra imagem e texto de cada cartão', () => {
    const base = carrosselValido();
    const m = {
      ...base,
      cartoes: [{ ...base.cartoes![0], imagem: '' }, { ...base.cartoes![1], corpo: '' }],
    };
    const achados = problemasDe(m, 'cartoes').join(' ');
    expect(achados).toContain('Cartão 1');
    expect(achados).toContain('Cartão 2');
  });

  it('cobra ao menos um botão por cartão', () => {
    const base = carrosselValido();
    const m = { ...base, cartoes: base.cartoes!.map((c) => ({ ...c, botoes: [] })) };
    expect(problemasDe(m, 'cartoes').join(' ')).toContain('pelo menos um botão');
  });

  it('exige a MESMA estrutura de botões em todos os cartões', () => {
    // É a recusa que a Meta não explica: ela devolve o carrossel inteiro
    // recusado, sem dizer qual cartão está diferente.
    const base = carrosselValido();
    const m = {
      ...base,
      cartoes: [
        base.cartoes![0],
        { ...base.cartoes![1], botoes: [{ tipo: 'QUICK_REPLY' as const, texto: 'Quero' }] },
      ],
    };
    expect(problemasDe(m, 'cartoes').join(' ')).toContain('cartão 2 está diferente');
  });

  it('avisa que carrossel não tem cabeçalho, rodapé nem oferta', () => {
    const m: ModeloParaValidar = {
      ...carrosselValido(),
      cabecalhoFormato: 'TEXT',
      cabecalhoTexto: 'Oferta',
      rodape: 'Válido hoje',
      ltoAtivo: true,
    };
    expect(problemasDe(m, 'cabecalho')).not.toHaveLength(0);
    expect(problemasDe(m, 'rodape')).not.toHaveLength(0);
    expect(problemasDe(m, 'lto')).not.toHaveLength(0);
  });

  it('continua cobrando as regras de variável do corpo principal', () => {
    const m = { ...carrosselValido(), corpo: 'Veja o que separamos {{1}}' };
    expect(problemasDe(m, 'corpo').join(' ')).toContain('terminar');
  });
});

describe('botão de saída do marketing', () => {
  it('entra por último, com as respostas rápidas agrupadas no fim', () => {
    const botoes = botoesComSaida({
      categoria: 'MARKETING',
      tipo: 'simples',
      botoes: [
        { tipo: 'QUICK_REPLY', texto: 'Quero' },
        { tipo: 'URL', texto: 'Ver ofertas', url: 'https://loja.com' },
        { tipo: 'PHONE_NUMBER', texto: 'Ligar', telefone: '5521999998888' },
      ],
    });

    expect(botoes.map((b) => b.tipo)).toEqual(['URL', 'PHONE_NUMBER', 'QUICK_REPLY', 'QUICK_REPLY']);
    expect(botoes[botoes.length - 1]).toEqual(BOTAO_SAIDA);
  });

  it('não duplica quando o modelo já traz o botão de saída', () => {
    const uma = botoesComSaida({ categoria: 'MARKETING', tipo: 'simples', botoes: [BOTAO_SAIDA] });
    const duas = botoesComSaida({ categoria: 'MARKETING', tipo: 'simples', botoes: uma });
    expect(duas.filter(ehBotaoDeSaida)).toHaveLength(1);
  });

  it('não entra em utilidade, autenticação nem carrossel', () => {
    const nenhum = [
      botoesComSaida({ categoria: 'UTILITY', tipo: 'simples', botoes: [] }),
      botoesComSaida({ categoria: 'AUTHENTICATION', tipo: 'simples', botoes: [] }),
      botoesComSaida({ categoria: 'MARKETING', tipo: 'carrossel', botoes: [] }),
    ];
    expect(nenhum.flat()).toHaveLength(0);
  });

  it('recusa mais de 9 botões do cliente no marketing, explicando o décimo', () => {
    const m: ModeloParaValidar = {
      ...modeloValido(),
      categoria: 'MARKETING',
      botoes: Array.from({ length: 10 }, (_, i) => ({ tipo: 'QUICK_REPLY' as const, texto: `Opção ${i + 1}` })),
    };
    expect(problemasDe(m, 'botoes').join(' ')).toContain(BOTAO_SAIDA.texto);
  });

  it('aceita 9 do cliente mais o nosso', () => {
    const m: ModeloParaValidar = {
      ...modeloValido(),
      categoria: 'MARKETING',
      botoes: Array.from({ length: 9 }, (_, i) => ({ tipo: 'QUICK_REPLY' as const, texto: `Opção ${i + 1}` })),
    };
    expect(problemasDe(m, 'botoes')).toEqual([]);
  });
});

describe('análise pelos motivos de recusa da Meta (revisão de modelos, 25/09/2026)', () => {
  it('o caso real: {nome} com chave simples é recusado ANTES de ir à Meta, com o que trocar', () => {
    const m = {
      ...modeloValido(),
      corpo: 'Olá {nome}, tudo bem com você? Já experimentou nosso combinado mais vendido?',
      corpoExemplos: [],
    };
    const achados = problemasDe(m, 'corpo');
    expect(achados).toHaveLength(1);
    expect(achados[0]).toContain('"{nome}" não é variável do WhatsApp: troque por {{1}}');
  });

  it('variável com nome, chave aberta e símbolo dentro também são barrados', () => {
    for (const trecho of ['{{nome}}', '{{1}', '{{#1}}', '{{ primeiro_nome }}']) {
      const m = { ...modeloValido(), corpo: `Olá ${trecho}, hoje o frete é por nossa conta, aproveite.` };
      expect(problemasDe(m, 'corpo').join(' ')).toMatch(/não é variável|fora do padrão/);
    }
  });

  it('as chaves certas passam, e o cabeçalho e o rodapé também são conferidos', () => {
    expect(conferirModelo(modeloValido())).toEqual([]);
    const m = { ...modeloValido(), cabecalhoFormato: 'TEXT' as const, cabecalhoTexto: 'Promo {cliente}', rodape: 'Válido até {data}' };
    expect(problemasDe(m, 'cabecalho').join(' ')).toContain('"{cliente}" não é variável');
    expect(problemasDe(m, 'rodape').join(' ')).toContain('"{data}" está fora do padrão');
  });

  it('variável demais para o tamanho do texto: pelo menos 2N + 1 palavras fixas', () => {
    const curto = { ...modeloValido(), corpo: 'Oi {{1}}, pedido {{2}} saiu.', corpoExemplos: ['Ana', '123'] };
    expect(problemasDe(curto, 'corpo').join(' ')).toContain('Escreva pelo menos 5 palavras fora das variáveis (hoje são 3)');
    const bom = { ...curto, corpo: 'Oi {{1}}, o seu pedido {{2}} já saiu para entrega agora.' };
    expect(problemasDe(bom, 'corpo')).toEqual([]);
  });

  it('pedido de dado sensível e tom de ameaça: recusados pela política', () => {
    const senha = { ...modeloValido(), corpo: 'Olá {{1}}, confirme sua senha para liberar o cupom de hoje.' };
    expect(problemasDe(senha, 'corpo').join(' ')).toContain('dado sensível');
    const cpf = { ...modeloValido(), corpo: 'Olá {{1}}, mande seu CPF para ganhar o desconto da semana.' };
    expect(problemasDe(cpf, 'corpo').join(' ')).toContain('"CPF"');
    const ameaca = { ...modeloValido(), corpo: 'Olá {{1}}, pague hoje ou seu nome vai para o Serasa amanhã cedo.' };
    expect(problemasDe(ameaca, 'corpo').join(' ')).toContain('tom de ameaça');
    // Palavra que só CONTÉM as letras não conta ("carga" tem "rg"; "spcial" não é "spc").
    const inocente = { ...modeloValido(), corpo: 'Olá {{1}}, a carga de hoje chegou fresquinha para você.' };
    expect(problemasDe(inocente, 'corpo')).toEqual([]);
  });

  it('botões: sem chaves no texto, link fixo e telefone de até 20 caracteres', () => {
    const m = {
      ...modeloValido(),
      botoes: [
        { tipo: 'QUICK_REPLY' as const, texto: 'Quero {promo}' },
        { tipo: 'URL' as const, texto: 'Ver cardápio', url: 'https://loja.com/{{1}}' },
        { tipo: 'PHONE_NUMBER' as const, texto: 'Ligar', telefone: '+55 (21) 99999-9999 ramal 12' },
      ],
    };
    const achados = problemasDe(m, 'botoes').join(' ');
    expect(achados).toContain('o texto do botão não aceita variável nem chaves');
    expect(achados).toContain('use o link completo');
    expect(achados).toContain('o telefone precisa ter até 20 caracteres');
  });
});
