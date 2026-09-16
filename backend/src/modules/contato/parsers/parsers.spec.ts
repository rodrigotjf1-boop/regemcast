/**
 * Testes dos leitores de arquivo.
 *
 * Cada caso aqui é um arquivo real que já quebrou algum import em algum lugar:
 * o `.vcf` do iPhone com `item1.TEL`, o do Android com QUOTED-PRINTABLE
 * quebrado no meio do nome, o CSV do Excel brasileiro com ponto e vírgula e
 * BOM, a planilha com buraco no meio das colunas.
 *
 * Nada aqui toca banco nem rede.
 */
import {
  decodificarQuotedPrintable,
  lerVcard,
  pareceVcard,
} from './vcard';
import {
  detectarColunas,
  detectarSeparador,
  lerCsv,
  lerTexto,
  separarLinhaCsv,
} from './tabela';

describe('vCard', () => {
  it('reconhece — e recusa — o que não é vCard', () => {
    expect(pareceVcard('BEGIN:VCARD\nEND:VCARD')).toBe(true);
    expect(pareceVcard('nome;telefone')).toBe(false);
  });

  it('lê nome e telefone de um cartão simples', () => {
    const vcf = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Maria Souza',
      'TEL;TYPE=CELL:+55 21 98975-1705',
      'END:VCARD',
    ].join('\n');

    expect(lerVcard(vcf)).toEqual([
      { nome: 'Maria Souza', telefones: ['+55 21 98975-1705'] },
    ]);
  });

  it('tira o prefixo do iPhone (item1.TEL), senão nenhum telefone é achado', () => {
    const vcf = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Joao',
      'item1.TEL:21989751705',
      'END:VCARD',
    ].join('\n');

    expect(lerVcard(vcf)[0].telefones).toEqual(['21989751705']);
  });

  it('monta o nome a partir do N estruturado quando não há FN', () => {
    const vcf = ['BEGIN:VCARD', 'N:Souza;Maria;;;', 'TEL:21989751705', 'END:VCARD'].join('\n');
    expect(lerVcard(vcf)[0].nome).toBe('Maria Souza');
  });

  it('coloca o celular na frente do fixo', () => {
    const vcf = [
      'BEGIN:VCARD',
      'FN:Loja',
      'TEL;TYPE=WORK:2122223333',
      'TEL;TYPE=CELL:21989751705',
      'END:VCARD',
    ].join('\n');

    // Numa base de disparo, fixo quase nunca tem WhatsApp.
    expect(lerVcard(vcf)[0].telefones[0]).toBe('21989751705');
  });

  it('junta a linha continuada do RFC (folding)', () => {
    // O RFC manda remover a quebra E o espaço de folding. Então o espaço que
    // deve sobrar entre as palavras é o SEGUNDO — a linha dobrada começa com
    // dois. Quem remove só a quebra deixa um espaço a mais no meio do nome;
    // quem remove os dois espaços cola as palavras.
    const vcf = [
      'BEGIN:VCARD',
      'FN:Maria Aparecida da',
      '  Conceicao',
      'TEL:21989751705',
      'END:VCARD',
    ].join('\n');

    expect(lerVcard(vcf)[0].nome).toBe('Maria Aparecida da Conceicao');
  });

  it('não inventa espaço quando o folding parte a palavra no meio', () => {
    const vcf = ['BEGIN:VCARD', 'FN:Concei', ' cao', 'TEL:21989751705', 'END:VCARD'].join('\n');
    expect(lerVcard(vcf)[0].nome).toBe('Conceicao');
  });

  it('decodifica QUOTED-PRINTABLE em UTF-8 — o padrão do Android', () => {
    const vcf = [
      'BEGIN:VCARD',
      'VERSION:2.1',
      'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jo=C3=A3o Concei=C3=A7=C3=A3o',
      'TEL:21989751705',
      'END:VCARD',
    ].join('\n');

    expect(lerVcard(vcf)[0].nome).toBe('João Conceição');
  });

  it('decodifica QUOTED-PRINTABLE em ISO-8859-1 sem virar mojibake', () => {
    // Em latin1 'é' é UM byte (=E9). Decodificar como UTF-8 produz lixo.
    expect(decodificarQuotedPrintable('Jos=E9', 'ISO-8859-1')).toBe('José');
    expect(decodificarQuotedPrintable('Jos=C3=A9', 'UTF-8')).toBe('José');
  });

  it('junta o soft line break do QUOTED-PRINTABLE, que não tem espaço à frente', () => {
    // Regra diferente do folding do RFC: quem trata só uma das duas corta nomes.
    const vcf = [
      'BEGIN:VCARD',
      'VERSION:2.1',
      'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Maria da=',
      ' Concei=C3=A7=C3=A3o',
      'TEL:21989751705',
      'END:VCARD',
    ].join('\n');

    expect(lerVcard(vcf)[0].nome).toContain('Conceição');
  });

  it('lê vários cartões no mesmo arquivo', () => {
    const vcf = [
      'BEGIN:VCARD',
      'FN:A',
      'TEL:21989751705',
      'END:VCARD',
      'BEGIN:VCARD',
      'FN:B',
      'TEL:21988887777',
      'END:VCARD',
    ].join('\n');

    expect(lerVcard(vcf)).toHaveLength(2);
  });
});

describe('CSV', () => {
  it('usa ponto e vírgula, que é o que o Excel em português escreve', () => {
    expect(detectarSeparador('nome;telefone')).toBe(';');
    expect(detectarSeparador('nome,telefone')).toBe(',');
  });

  it('respeita a vírgula dentro de aspas', () => {
    expect(separarLinhaCsv('"Silva, João";21989751705', ';')).toEqual([
      'Silva, João',
      '21989751705',
    ]);
  });

  it('entende aspas duplicadas dentro do campo', () => {
    expect(separarLinhaCsv('"Bar ""do Zé""";21989751705', ';')).toEqual([
      'Bar "do Zé"',
      '21989751705',
    ]);
  });

  it('remove o BOM que o Excel escreve no começo do arquivo', () => {
    const comBom = '﻿nome;telefone\nMaria;21989751705';
    expect(lerCsv(comBom)[0][0]).toBe('nome');
  });

  it('ignora linhas em branco', () => {
    expect(lerCsv('nome;telefone\n\nMaria;21989751705\n\n')).toHaveLength(2);
  });
});

describe('detectarColunas', () => {
  it('acha as colunas pelo cabeçalho, com ou sem acento', () => {
    const c = detectarColunas([
      ['Nome', 'Telefone'],
      ['Maria', '21989751705'],
    ]);
    expect(c).toEqual({ telefone: 1, nome: 0, temCabecalho: true });
  });

  it('reconhece os apelidos comuns da coluna de telefone', () => {
    for (const titulo of ['Celular', 'WhatsApp', 'Fone', 'Número']) {
      const c = detectarColunas([['Nome', titulo], ['Maria', '21989751705']]);
      expect(c.telefone).toBe(1);
    }
  });

  it('sem cabeçalho, escolhe a coluna que mais parece telefone', () => {
    const c = detectarColunas([
      ['Maria', '21989751705'],
      ['João', '21988887777'],
    ]);
    expect(c.temCabecalho).toBe(false);
    expect(c.telefone).toBe(1);
    expect(c.nome).toBe(0);
  });

  it('não estoura com arquivo vazio', () => {
    expect(detectarColunas([])).toEqual({ telefone: -1, nome: -1, temCabecalho: false });
  });
});

describe('texto colado', () => {
  it('aceita quebra de linha, vírgula e ponto e vírgula', () => {
    const linhas = lerTexto('21989751705\n21988887777;21977776666');
    expect(linhas).toHaveLength(3);
  });

  it('aceita "nome, telefone" por linha, que é como as pessoas colam', () => {
    const linhas = lerTexto('Maria, 21989751705');
    expect(linhas[0]).toEqual(['Maria', '21989751705']);
    expect(detectarColunas(linhas).telefone).toBe(1);
  });

  it('ignora linhas vazias', () => {
    expect(lerTexto('\n\n21989751705\n\n')).toHaveLength(1);
  });
});
