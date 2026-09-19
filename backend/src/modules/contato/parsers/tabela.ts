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
/**
 * Teto do .xlsx DESCOMPACTADO. O arquivo chega com até 5 MB, mas .xlsx é um
 * zip: uma "bomba" de 5 MB abre em vários GB e derruba a API inteira na
 * leitura. Uma planilha real de 50 mil contatos fica bem abaixo disto.
 */
export const TETO_XLSX_ABERTO = 60 * 1024 * 1024;

/** Mais partes que isto num .xlsx de contatos não é planilha, é ataque. */
const MAX_PARTES_XLSX = 2_000;

/**
 * Soma o tamanho descompactado declarado no diretório central do zip, SEM
 * descompactar nada. Falha fechado: zip que não dá para ler, zip64 (tamanhos
 * acima de 4 GB) ou soma acima do teto são recusados antes do exceljs abrir.
 *
 * O tamanho declarado pode mentir, mas mentir para MENOS não ajuda o ataque:
 * o descompactador do exceljs para no tamanho declarado de cada parte.
 */
export function conferirZipDaPlanilha(conteudo: Buffer): void {
  const recusa = () =>
    new Error('Planilha recusada: o arquivo não parece um Excel válido ou é grande demais depois de aberto.');

  // Fim do diretório central: assinatura 0x06054b50, nos últimos 22 + 65535 bytes.
  const inicioBusca = Math.max(0, conteudo.length - 22 - 0xffff);
  let fim = -1;
  for (let i = conteudo.length - 22; i >= inicioBusca; i--) {
    if (conteudo.readUInt32LE(i) === 0x06054b50) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw recusa();

  const partes = conteudo.readUInt16LE(fim + 10);
  const tamanhoDiretorio = conteudo.readUInt32LE(fim + 12);
  let pos = conteudo.readUInt32LE(fim + 16);
  if (partes === 0xffff || pos === 0xffffffff || partes > MAX_PARTES_XLSX) throw recusa();
  if (pos + tamanhoDiretorio > conteudo.length) throw recusa();

  let total = 0;
  for (let n = 0; n < partes; n++) {
    if (pos + 46 > conteudo.length || conteudo.readUInt32LE(pos) !== 0x02014b50) throw recusa();
    const aberto = conteudo.readUInt32LE(pos + 24);
    if (aberto === 0xffffffff) throw recusa();
    total += aberto;
    if (total > TETO_XLSX_ABERTO) throw recusa();
    pos += 46 + conteudo.readUInt16LE(pos + 28) + conteudo.readUInt16LE(pos + 30) + conteudo.readUInt16LE(pos + 32);
  }
}

export async function lerXlsx(conteudo: Buffer): Promise<Linha[]> {
  conferirZipDaPlanilha(conteudo);
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
  const ehTituloTelefone = (c: string) => COLUNAS_TELEFONE.some((alvo) => c.includes(alvo));
  const ehTituloNome = (c: string) => COLUNAS_NOME.some((alvo) => c === alvo || c.includes(alvo));
  // A primeira linha é título quando algum campo é um título conhecido e
  // nenhum deles é um telefone — "Cliente | Contato | Data de nascimento", o
  // relatório da Anota Aí, não tem a palavra "telefone" e ainda assim é título.
  const temCabecalho =
    cabecalho.some((c) => ehTituloTelefone(c) || ehTituloNome(c)) &&
    !linhas[0].some((c) => pareceTelefone(c));
  const dados = temCabecalho ? linhas.slice(1) : linhas;

  let iTel = temCabecalho ? cabecalho.findIndex(ehTituloTelefone) : -1;
  if (iTel < 0) iTel = colunaComMaisTelefones(dados);

  // "Contato" pode ser o nome (agenda) ou o telefone (Anota Aí): a coluna do
  // telefone nunca é a do nome.
  let iNome = temCabecalho ? cabecalho.findIndex((c, i) => i !== iTel && ehTituloNome(c)) : -1;
  if (iNome < 0) {
    const largura = Math.max(...linhas.map((l) => l.length));
    iNome = largura > 1 ? (iTel === 0 ? 1 : 0) : -1;
  }
  return { telefone: iTel, nome: iNome, temCabecalho };
}

/** Parece telefone: 8 a 15 dígitos e não é data (08/12/1990 tem 8 dígitos). */
function pareceTelefone(celula: string): boolean {
  const texto = (celula ?? '').trim();
  if (/^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/.test(texto)) return false;
  const digitos = texto.replace(/\D/g, '').length;
  return digitos >= 8 && digitos <= 15;
}

/** A coluna com mais células que parecem telefone, nas primeiras 50 linhas. */
function colunaComMaisTelefones(linhas: Linha[]): number {
  const largura = Math.max(0, ...linhas.map((l) => l.length));
  let melhor = 0;
  let melhorPontos = -1;
  for (let col = 0; col < largura; col++) {
    const pontos = linhas.slice(0, 50).filter((l) => pareceTelefone(l[col] ?? '')).length;
    if (pontos > melhorPontos) {
      melhorPontos = pontos;
      melhor = col;
    }
  }
  return melhor;
}
