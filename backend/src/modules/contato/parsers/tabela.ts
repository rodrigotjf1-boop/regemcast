/**
 * Leitor de planilha: CSV, Excel e texto colado.
 *
 * Os três terminam no mesmo lugar — uma matriz de células — e daí em diante o
 * caminho é um só. Ter três caminhos separados até o banco é o que faz o CSV
 * aceitar um número que o Excel recusa.
 *
 * O CSV é lido à mão, e não com biblioteca, por um motivo específico: as
 * bibliotecas boas de CSV são grandes e resolvem problemas que uma planilha de
 * contatos não tem. O que uma planilha de contatos TEM é aspas com vírgula
 * dentro ("Silva, João"), separador ponto e vírgula (padrão do Excel em
 * português) e BOM no começo do arquivo — e é exatamente isso que está tratado
 * aqui.
 */
import { Workbook } from 'exceljs';

/** Uma linha de planilha, já separada em células. */
export type Linha = string[];

/** Cabeçalhos que reconhecemos como telefone, em minúsculas e sem acento. */
const COLUNAS_TELEFONE = [
  'telefone', 'celular', 'whatsapp', 'whats', 'fone', 'numero', 'number', 'phone', 'mobile',
];

/** Cabeçalhos que reconhecemos como nome. */
const COLUNAS_NOME = ['nome', 'name', 'contato', 'cliente', 'razao social', 'fantasia'];

/** Tira acento e caixa, para comparar cabeçalho digitado de qualquer jeito. */
function chave(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Separa uma linha de CSV respeitando aspas.
 *
 * Sem isto, `"Silva, João";11999998888` vira três células e o nome é perdido.
 */
export function separarLinhaCsv(linha: string, separador: string): string[] {
  const celulas: string[] = [];
  let atual = '';
  let dentroDeAspas = false;

  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];

    if (c === '"') {
      // Aspas duplicadas dentro de campo entre aspas representam uma aspa.
      if (dentroDeAspas && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else {
        dentroDeAspas = !dentroDeAspas;
      }
      continue;
    }

    if (c === separador && !dentroDeAspas) {
      celulas.push(atual);
      atual = '';
      continue;
    }

    atual += c;
  }

  celulas.push(atual);
  return celulas.map((c) => c.trim());
}

/**
 * Descobre o separador olhando a primeira linha.
 *
 * O Excel em português salva CSV com ponto e vírgula; o resto do mundo usa
 * vírgula. Exigir um dos dois faria metade dos arquivos entrarem numa coluna só.
 */
export function detectarSeparador(primeiraLinha: string): string {
  const candidatos = [';', ',', '\t'];
  let melhor = ',';
  let maior = 0;

  for (const sep of candidatos) {
    const quantos = separarLinhaCsv(primeiraLinha, sep).length;
    if (quantos > maior) {
      maior = quantos;
      melhor = sep;
    }
  }

  return melhor;
}

/** CSV (ou TSV) → matriz de células. Remove o BOM que o Excel escreve. */
export function lerCsv(texto: string): Linha[] {
  const limpo = String(texto ?? '').replace(/^\uFEFF/, '');
  const linhas = limpo.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!linhas.length) return [];

  const separador = detectarSeparador(linhas[0]);
  return linhas.map((l) => separarLinhaCsv(l, separador));
}

/** Excel (`.xlsx`) → matriz de células, da primeira planilha do arquivo. */
export async function lerXlsx(conteudo: Buffer): Promise<Linha[]> {
  const pasta = new Workbook();
  // O tipo do exceljs pede o ArrayBuffer do DOM; o Buffer do Node serve em
  // tempo de execução e é o que a própria documentação usa.
  await pasta.xlsx.load(conteudo as unknown as ArrayBuffer);

  const planilha = pasta.worksheets[0];
  if (!planilha) return [];

  const linhas: Linha[] = [];
  planilha.eachRow((linha) => {
    const celulas: string[] = [];
    // `eachCell` sem `includeEmpty` pula buracos e desalinha as colunas — o
    // telefone da coluna C acabaria lido como se fosse da B.
    linha.eachCell({ includeEmpty: true }, (celula) => {
      const v = celula.value;
      if (v === null || v === undefined) celulas.push('');
      else if (typeof v === 'object' && 'text' in v) celulas.push(String(v.text ?? ''));
      else if (typeof v === 'object' && 'result' in v) celulas.push(String(v.result ?? ''));
      else celulas.push(String(v));
    });
    linhas.push(celulas.map((c) => c.trim()));
  });

  return linhas;
}

/**
 * Texto colado: números separados por vírgula, ponto e vírgula ou quebra de
 * linha. Aceita `nome, telefone` por linha, que é como as pessoas colam.
 */
export function lerTexto(texto: string): Linha[] {
  return String(texto ?? '')
    .split(/[\n;]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.split(',').map((c) => c.trim()));
}

export interface ColunasDetectadas {
  /** Índice da coluna de telefone; -1 quando não há cabeçalho reconhecível. */
  telefone: number;
  /** Índice da coluna de nome, ou -1. */
  nome: number;
  /** `true` quando a primeira linha é cabeçalho e não deve virar contato. */
  temCabecalho: boolean;
}

/**
 * Descobre quais colunas são nome e telefone.
 *
 * Quando não há cabeçalho reconhecível, cai para heurística: a coluna com mais
 * dígitos é o telefone. É o caso de quem cola uma lista sem título nenhum — e
 * recusar esse arquivo seria recusar o formato mais comum de todos.
 */
export function detectarColunas(linhas: Linha[]): ColunasDetectadas {
  if (!linhas.length) return { telefone: -1, nome: -1, temCabecalho: false };

  const cabecalho = linhas[0].map(chave);
  const iTel = cabecalho.findIndex((c) => COLUNAS_TELEFONE.some((alvo) => c.includes(alvo)));
  const iNome = cabecalho.findIndex((c) => COLUNAS_NOME.some((alvo) => c === alvo || c.includes(alvo)));

  if (iTel >= 0) return { telefone: iTel, nome: iNome, temCabecalho: true };

  // Sem cabeçalho: a coluna que mais parece telefone é a que tem mais dígitos.
  const largura = Math.max(...linhas.map((l) => l.length));
  let melhor = 0;
  let melhorPontos = -1;

  for (let col = 0; col < largura; col++) {
    let pontos = 0;
    for (const linha of linhas.slice(0, 50)) {
      const celula = linha[col] ?? '';
      const digitos = celula.replace(/\D/g, '').length;
      if (digitos >= 8 && digitos <= 15) pontos++;
    }
    if (pontos > melhorPontos) {
      melhorPontos = pontos;
      melhor = col;
    }
  }

  // Nome: a primeira coluna que não seja a do telefone, quando existir.
  const colNome = largura > 1 ? (melhor === 0 ? 1 : 0) : -1;
  return { telefone: melhor, nome: colNome, temCabecalho: false };
}
