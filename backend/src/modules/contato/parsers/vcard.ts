/**
 * Leitor de vCard (`.vcf`) — o arquivo que Android e iPhone exportam.
 *
 * Portado do Regem, onde já sobreviveu a bases reais. O que parece detalhe aqui
 * é a diferença entre importar mil contatos e importar mil linhas de mojibake:
 *
 * - **Folding** (RFC 2426): no vCard 3.0/4.0 uma linha longa continua na
 *   seguinte começando por espaço ou TAB.
 * - **Soft line break do QUOTED-PRINTABLE** (vCard 2.1): a linha do VALOR
 *   termina em `=` e continua na próxima **sem** espaço — regra diferente da de
 *   cima, e quem trata só uma das duas corta nomes ao meio.
 * - **CHARSET**: exports antigos vêm em ISO-8859-1, onde `é` é um byte só
 *   (`=E9`). Decodificar tudo como UTF-8 transforma acento em lixo.
 * - **`item1.TEL`**: o iPhone prefixa as propriedades; sem tirar o prefixo,
 *   nenhum telefone é encontrado.
 *
 * Uma diferença deliberada em relação ao Regem: lá o parser escolhe o telefone
 * que passa pela normalização **local** (que remove o 55). Aqui a escolha é
 * feita por quem chama, com a normalização do Regemcast — que mantém o país.
 */

/** Um contato cru, como saiu do arquivo. A normalização acontece depois. */
export interface ContatoBruto {
  nome: string;
  telefoneRaw: string;
}

/**
 * Decodifica QUOTED-PRINTABLE (`=C3=A9` → bytes) respeitando o CHARSET.
 *
 * `latin1` do Node cobre ISO-8859-1; Windows-1252 é aproximado — difere só na
 * faixa 0x80–0x9F, raríssima em nomes, e ainda assim melhor do que decodificar
 * como UTF-8.
 */
export function decodificarQuotedPrintable(texto: string, charset?: string): string {
  const semSoft = texto.replace(/=\r?\n/g, '');
  const bytes: number[] = [];

  for (let i = 0; i < semSoft.length; i++) {
    if (semSoft[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(semSoft.substr(i + 1, 2))) {
      bytes.push(parseInt(semSoft.substr(i + 1, 2), 16));
      i += 2;
    } else {
      bytes.push(semSoft.charCodeAt(i) & 0xff);
    }
  }

  const cs = String(charset ?? '').toUpperCase();
  const ehLatin = /8859-1|LATIN1|WINDOWS-125[02]|CP125[02]/.test(cs);
  try {
    return Buffer.from(bytes).toString(ehLatin ? 'latin1' : 'utf8');
  } catch {
    return semSoft;
  }
}

/** Reconhece um `.vcf` antes de tentar lê-lo. */
export function pareceVcard(texto: string): boolean {
  return /BEGIN:VCARD/i.test(String(texto ?? ''));
}

/**
 * Extrai nome e telefones de cada contato do arquivo.
 *
 * Devolve TODOS os telefones do contato, em ordem de preferência (celular
 * primeiro), porque só quem normaliza sabe qual deles é válido — e descartar
 * essa escolha aqui perderia o contato cujo primeiro celular é um ramal.
 */
export function lerVcard(texto: string): { nome: string; telefones: string[] }[] {
  // Unfolding do RFC: linha que começa com espaço/TAB é continuação da anterior.
  const unfolded = String(texto ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '');

  const cartoes = unfolded.split(/BEGIN:VCARD/i).slice(1);
  const saida: { nome: string; telefones: string[] }[] = [];

  for (const cartao of cartoes) {
    const corpo = cartao.split(/END:VCARD/i)[0] ?? '';
    const linhas = corpo.split('\n');

    let fn = '';
    let nEstruturado = '';
    const tels: { valor: string; celular: boolean }[] = [];

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];
      const corte = linha.indexOf(':');
      if (corte < 0) continue;

      const esquerda = linha.slice(0, corte);
      let valor = linha.slice(corte + 1);

      const partes = esquerda.split(';');
      // `item1.TEL` → `TEL`. O iPhone prefixa; sem isto, nada é encontrado.
      const prop = (partes[0].split('.').pop() ?? '').toUpperCase();
      const params = partes.slice(1).map((p) => p.toUpperCase());
      const ehQp = params.some((p) => p.includes('QUOTED-PRINTABLE'));

      if (ehQp) {
        // Soft line break do 2.1: o valor termina em `=` e continua na linha
        // física seguinte, que não tem ':' e seria descartada pelo laço.
        while (/=\s*$/.test(valor) && i + 1 < linhas.length) {
          valor = valor.replace(/=\s*$/, '') + linhas[++i];
        }
        const charset = (params.find((p) => p.startsWith('CHARSET=')) ?? '').slice(8);
        valor = decodificarQuotedPrintable(valor, charset);
      }

      if (prop === 'FN') fn = valor.trim();
      else if (prop === 'N' && !nEstruturado) nEstruturado = valor;
      else if (prop === 'TEL') {
        tels.push({
          valor,
          celular: params.some((p) => p.includes('CELL') || p.includes('MOBILE')),
        });
      }
    }

    let nome = fn;
    if (!nome && nEstruturado) {
      const [sobrenome, prenome] = nEstruturado.split(';');
      nome = [prenome, sobrenome].filter(Boolean).join(' ').trim();
    }

    // Celulares primeiro: numa base de disparo, fixo quase nunca tem WhatsApp.
    const ordenados = [
      ...tels.filter((t) => t.celular).map((t) => t.valor),
      ...tels.filter((t) => !t.celular).map((t) => t.valor),
    ].filter((v) => v.trim().length > 0);

    saida.push({ nome: (nome ?? '').trim().slice(0, 120), telefones: ordenados });
  }

  return saida;
}
