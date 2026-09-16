/**
 * Testes das regras de modelo.
 *
 * Cada caso aqui é uma recusa que a Meta já devolveu para alguém. O objetivo do
 * arquivo sob teste é que ela pare de acontecer lá, onde a mensagem é genérica
 * e chega horas depois, e passe a acontecer aqui, em português, na hora.
 */
import { conferirModelo, quantasVariaveis, variaveisDe, type ModeloParaValidar } from './regras-modelo';

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

    const m = { ...modeloValido(), corpo: 'Olá {{1}}, até logo {{1}}!', corpoExemplos: ['Maria'] };
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
