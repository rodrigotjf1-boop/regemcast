/**
 * As regras da Meta para modelo de mensagem, num lugar só.
 *
 * Este arquivo existe para que a recusa aconteça AQUI, com uma frase em
 * português dizendo o que corrigir, e não lá, com um `error_user_msg` genérico
 * depois de o cliente ter escrito o modelo inteiro e esperado horas.
 *
 * Cada regra abaixo custou alguma coisa a alguém. As que vieram do Regem estão
 * marcadas: são as que já derrubaram modelo em produção.
 *
 * Não há validação equivalente no frontend de propósito. Duas implementações da
 * mesma regra divergem — foi exatamente assim que um telefone sem o `55` passou
 * na tela e foi recusado pela Meta. A tela mostra as regras como texto de apoio
 * e pergunta a ESTE arquivo quando precisa de uma resposta.
 */

/** O que o cliente escreveu, antes de virar componentes da Meta. */
export interface ModeloParaValidar {
  nome: string;
  idioma: string;
  categoria: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  cabecalhoFormato?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | null;
  cabecalhoTexto?: string | null;
  cabecalhoExemplo?: string | null;
  cabecalhoMidia?: string | null;
  corpo: string;
  corpoExemplos?: string[];
  rodape?: string | null;
  botoes?: BotaoDoModelo[];
  ltoAtivo?: boolean;
  ltoTexto?: string | null;
}

export interface BotaoDoModelo {
  tipo: 'URL' | 'PHONE_NUMBER' | 'QUICK_REPLY' | 'COPY_CODE';
  texto: string;
  /** Link, para `URL`. */
  url?: string;
  /** Telefone, para `PHONE_NUMBER`. */
  telefone?: string;
}

/** Um problema encontrado, já escrito para o cliente ler. */
export interface ProblemaNoModelo {
  /** Qual parte do formulário destacar. */
  campo: 'nome' | 'categoria' | 'cabecalho' | 'corpo' | 'rodape' | 'botoes' | 'lto';
  mensagem: string;
}

// Limites documentados pela Meta.
export const LIMITE_NOME = 512;
export const LIMITE_CORPO = 1024;
export const LIMITE_CABECALHO = 60;
export const LIMITE_RODAPE = 60;
export const LIMITE_BOTOES = 10;
export const LIMITE_BOTAO_TEXTO = 25;
export const LIMITE_LTO_TEXTO = 16;

/** Encontra as variáveis `{{n}}` na ordem em que aparecem. */
export function variaveisDe(texto: string): number[] {
  const achadas: number[] = [];
  const padrao = /\{\{\s*(\d+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = padrao.exec(texto)) !== null) achadas.push(Number(m[1]));
  return achadas;
}

/**
 * Quantas variáveis DISTINTAS o texto usa.
 *
 * Distintas, e não ocorrências: `{{1}}` repetido duas vezes ainda é uma
 * variável, e mandar dois exemplos para ela é o erro 132000 da Meta
 * ("number of parameters does not match").
 */
export function quantasVariaveis(texto: string): number {
  return new Set(variaveisDe(texto)).size;
}

/**
 * Confere o modelo contra as regras da Meta.
 *
 * Devolve TODOS os problemas de uma vez, e não só o primeiro: corrigir um erro
 * por vez, com uma ida ao servidor entre cada, é o que faz a pessoa desistir.
 */
export function conferirModelo(m: ModeloParaValidar): ProblemaNoModelo[] {
  const problemas: ProblemaNoModelo[] = [];
  const p = (campo: ProblemaNoModelo['campo'], mensagem: string) =>
    problemas.push({ campo, mensagem });

  // ------------------------------------------------------------------- nome
  const nome = (m.nome ?? '').trim();
  if (!nome) {
    p('nome', 'Dê um nome técnico ao modelo, por exemplo promo_frete_gratis.');
  } else if (!/^[a-z0-9_]+$/.test(nome)) {
    p(
      'nome',
      'O nome técnico aceita só letras minúsculas, números e underline (_). Sem espaços, acentos ou maiúsculas.',
    );
  } else if (nome.length > LIMITE_NOME) {
    p('nome', `O nome técnico precisa ter até ${LIMITE_NOME} caracteres.`);
  }

  // ------------------------------------------------------------------ corpo
  const corpo = (m.corpo ?? '').trim();
  if (!corpo) {
    p('corpo', 'Escreva a mensagem.');
  } else if (corpo.length > LIMITE_CORPO) {
    p('corpo', `A mensagem precisa ter até ${LIMITE_CORPO} caracteres — está com ${corpo.length}.`);
  }

  if (corpo) problemas.push(...conferirVariaveis(corpo, m.corpoExemplos ?? []));

  // -------------------------------------------------------- oferta por tempo
  const ehLto = !!m.ltoAtivo;
  if (ehLto) {
    // Regra da Meta, e das que o Regem descobriu recusando modelo em produção.
    if (m.categoria !== 'MARKETING') {
      p('lto', 'A oferta por tempo limitado só existe em modelo de MARKETING.');
    }
    if ((m.rodape ?? '').trim()) {
      p('rodape', 'Modelo com oferta por tempo limitado não aceita rodapé. Remova o rodapé ou desligue a oferta.');
    }
    if (m.cabecalhoFormato === 'TEXT') {
      p(
        'cabecalho',
        'Modelo com oferta por tempo limitado não aceita cabeçalho de texto. Use imagem, vídeo, ou nenhum cabeçalho.',
      );
    }
    if ((m.ltoTexto ?? '').length > LIMITE_LTO_TEXTO) {
      p('lto', `O texto da oferta precisa ter até ${LIMITE_LTO_TEXTO} caracteres.`);
    }
  }

  // -------------------------------------------------------------- cabeçalho
  if (m.cabecalhoFormato === 'TEXT') {
    const cab = (m.cabecalhoTexto ?? '').trim();
    if (!cab) {
      p('cabecalho', 'Escreva o cabeçalho ou troque o tipo para "sem cabeçalho".');
    } else {
      if (cab.length > LIMITE_CABECALHO) {
        p('cabecalho', `O cabeçalho precisa ter até ${LIMITE_CABECALHO} caracteres.`);
      }
      if (/[\r\n]/.test(cab)) {
        p('cabecalho', 'O cabeçalho não aceita quebra de linha.');
      }
      if (/[*_~`]/.test(cab)) {
        p('cabecalho', 'O cabeçalho não aceita formatação (* _ ~ `). Use texto simples.');
      }

      const vars = variaveisDe(cab);
      if (vars.length > 1) {
        p('cabecalho', 'O cabeçalho aceita no máximo uma variável.');
      } else if (vars.length === 1) {
        if (vars[0] !== 1) {
          p('cabecalho', 'A variável do cabeçalho precisa ser {{1}}.');
        }
        if (!(m.cabecalhoExemplo ?? '').trim()) {
          // A Meta EXIGE o exemplo quando há variável. Sem ele a recusa é certa.
          p('cabecalho', 'O cabeçalho tem uma variável, então precisa de um exemplo do valor dela.');
        }
      }
    }
  } else if (m.cabecalhoFormato) {
    // Aqui o formato só pode ser IMAGE, VIDEO ou DOCUMENT — o ramo de TEXT foi
    // tratado acima. Todos exigem o arquivo antes de virar `header_handle`.
    if (!(m.cabecalhoMidia ?? '').trim()) {
      p('cabecalho', 'Escolha o arquivo do cabeçalho ou troque o tipo para "sem cabeçalho".');
    }
  }

  // ----------------------------------------------------------------- rodapé
  const rodape = (m.rodape ?? '').trim();
  if (rodape) {
    if (rodape.length > LIMITE_RODAPE) {
      p('rodape', `O rodapé precisa ter até ${LIMITE_RODAPE} caracteres.`);
    }
    if (variaveisDe(rodape).length) {
      p('rodape', 'O rodapé não aceita variáveis.');
    }
  }

  // ----------------------------------------------------------------- botões
  problemas.push(...conferirBotoes(m.botoes ?? []));

  return problemas;
}

/**
 * As regras de variável do corpo.
 *
 * A Meta recusa modelo em que a variável abre ou fecha o texto, e modelo com
 * duas variáveis coladas. O motivo declarado é evitar mensagem que chega como
 * um campo solto, sem frase em volta — e é uma das recusas mais frequentes,
 * porque a regra não aparece em lugar nenhum do formulário dela.
 */
function conferirVariaveis(corpo: string, exemplos: string[]): ProblemaNoModelo[] {
  const problemas: ProblemaNoModelo[] = [];
  const p = (mensagem: string) => problemas.push({ campo: 'corpo' as const, mensagem });

  const ocorrencias = variaveisDe(corpo);
  if (!ocorrencias.length) return problemas;

  const distintas = [...new Set(ocorrencias)].sort((a, b) => a - b);

  // Numeração sequencial a partir de 1, sem pular.
  const esperado = distintas.map((_, i) => i + 1);
  if (distintas.join(',') !== esperado.join(',')) {
    p(
      `As variáveis precisam ser numeradas em sequência a partir de {{1}}, sem pular. Você usou ${distintas
        .map((n) => `{{${n}}}`)
        .join(', ')}.`,
    );
  }

  const texto = corpo.trim();
  if (/^\{\{\s*\d+\s*\}\}/.test(texto)) {
    p('A mensagem não pode começar com uma variável. Escreva algo antes, por exemplo "Olá {{1}}".');
  }
  if (/\{\{\s*\d+\s*\}\}$/.test(texto)) {
    p('A mensagem não pode terminar com uma variável. Escreva algo depois dela.');
  }
  if (/\}\}\s*\{\{/.test(texto)) {
    p('Duas variáveis não podem ficar coladas. Escreva algo entre elas.');
  }

  // Um exemplo por variável distinta. Contar ocorrências em vez de distintas é
  // o erro 132000 da Meta — foi o que a auditoria do Regem encontrou.
  const informados = exemplos.filter((e) => (e ?? '').trim().length > 0).length;
  if (informados < distintas.length) {
    p(
      `Preencha um exemplo para cada variável: são ${distintas.length}, e você informou ${informados}. A Meta recusa o modelo sem eles.`,
    );
  }

  return problemas;
}

/** Os tetos de botão da Meta, por tipo. */
function conferirBotoes(botoes: BotaoDoModelo[]): ProblemaNoModelo[] {
  const problemas: ProblemaNoModelo[] = [];
  const p = (mensagem: string) => problemas.push({ campo: 'botoes' as const, mensagem });

  if (!botoes.length) return problemas;

  if (botoes.length > LIMITE_BOTOES) {
    p(`Um modelo aceita até ${LIMITE_BOTOES} botões.`);
  }

  const quantos = (tipo: BotaoDoModelo['tipo']) => botoes.filter((b) => b.tipo === tipo).length;

  if (quantos('URL') > 2) p('Um modelo aceita no máximo 2 botões de link.');
  if (quantos('PHONE_NUMBER') > 1) p('Um modelo aceita no máximo 1 botão de telefone.');
  if (quantos('COPY_CODE') > 1) p('Um modelo aceita no máximo 1 botão de copiar código.');
  if (quantos('QUICK_REPLY') > 10) p('Um modelo aceita até 10 respostas rápidas.');

  botoes.forEach((b, i) => {
    const onde = `Botão ${i + 1}`;
    const texto = (b.texto ?? '').trim();

    if (!texto) p(`${onde}: escreva o texto do botão.`);
    else if (texto.length > LIMITE_BOTAO_TEXTO) {
      p(`${onde}: o texto precisa ter até ${LIMITE_BOTAO_TEXTO} caracteres.`);
    }

    if (b.tipo === 'URL') {
      const url = (b.url ?? '').trim();
      if (!url) p(`${onde}: informe o link.`);
      else if (!/^https?:\/\//i.test(url)) p(`${onde}: o link precisa começar com http:// ou https://.`);
    }

    if (b.tipo === 'PHONE_NUMBER' && !(b.telefone ?? '').trim()) {
      p(`${onde}: informe o telefone.`);
    }
  });

  return problemas;
}
