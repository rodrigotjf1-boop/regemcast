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

/** Um cartão do carrossel. */
export interface CartaoDoModelo {
  /** Referência da imagem. Obrigatória: cartão sem imagem a Meta não aceita. */
  imagem?: string | null;
  corpo: string;
  botoes?: BotaoDoModelo[];
}

/** O que o cliente escreveu, antes de virar componentes da Meta. */
export interface ModeloParaValidar {
  /**
   * `simples` ou `carrossel`.
   *
   * Não é uma variação: o carrossel é outra forma. A Meta o monta como um BODY
   * seguido de um CAROUSEL com 2 a 10 cartões, e ele **não tem** cabeçalho,
   * rodapé nem oferta por tempo limitado.
   */
  tipo?: 'simples' | 'carrossel';
  cartoes?: CartaoDoModelo[];
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
  campo: 'nome' | 'categoria' | 'cabecalho' | 'corpo' | 'rodape' | 'botoes' | 'lto' | 'cartoes';
  mensagem: string;
}

// Limites do carrossel, documentados pela Meta.
export const MIN_CARTOES = 2;
export const MAX_CARTOES = 10;
export const LIMITE_CARTAO_CORPO = 160;
export const MIN_BOTOES_CARTAO = 1;
export const MAX_BOTOES_CARTAO = 2;

// Limites documentados pela Meta.
export const LIMITE_NOME = 512;
export const LIMITE_CORPO = 1024;
export const LIMITE_CABECALHO = 60;
export const LIMITE_RODAPE = 60;
export const LIMITE_BOTOES = 10;

/**
 * O botão de saída que TODO modelo de marketing leva, por nossa conta.
 *
 * Marketing sem saída fácil é o caminho mais curto para o bloqueio: quem não
 * acha como sair marca a empresa como spam, e o bloqueio derruba a qualidade do
 * número — que é da empresa, não nossa, e demora semanas para voltar. A própria
 * Meta recomenda uma resposta rápida de saída em todo modelo de marketing.
 *
 * É resposta rápida (QUICK_REPLY) porque o toque volta para nós como mensagem:
 * é assim que a pessoa entra na lista de bloqueio sozinha, sem ninguém do outro
 * lado precisar fazer nada.
 */
export const BOTAO_SAIDA: BotaoDoModelo = { tipo: 'QUICK_REPLY', texto: 'Parar promoções' };

/** Quantos botões o cliente pode criar num modelo de marketing: o 10º é o nosso. */
export const LIMITE_BOTOES_MARKETING = LIMITE_BOTOES - 1;

/** É o nosso botão de saída? Compara sem caixa e sem espaço sobrando. */
export function ehBotaoDeSaida(b: BotaoDoModelo): boolean {
  return b.tipo === 'QUICK_REPLY' && (b.texto ?? '').trim().toLowerCase() === BOTAO_SAIDA.texto.toLowerCase();
}

/**
 * Os botões como vão para a Meta: os do cliente e, por último, o de saída.
 *
 * A ordem não é gosto. A Meta exige que as respostas rápidas fiquem AGRUPADAS,
 * separadas dos outros tipos — misturar devolve "invalid combination" e o
 * modelo nem entra em análise. Então os botões de link, telefone e copiar código
 * vêm primeiro, depois as respostas rápidas do cliente, e a saída fecha a lista.
 *
 * Só para marketing simples: no carrossel os botões moram nos cartões (máximo
 * dois por cartão, iguais em todos), e não há onde acrescentar o nosso.
 */
export function botoesComSaida(m: {
  categoria?: ModeloParaValidar['categoria'];
  tipo?: ModeloParaValidar['tipo'];
  botoes?: BotaoDoModelo[];
}): BotaoDoModelo[] {
  const botoes = (m.botoes ?? []).filter((b) => !ehBotaoDeSaida(b));
  if (m.categoria !== 'MARKETING' || (m.tipo ?? 'simples') !== 'simples') return m.botoes ?? [];

  return [
    ...botoes.filter((b) => b.tipo !== 'QUICK_REPLY'),
    ...botoes.filter((b) => b.tipo === 'QUICK_REPLY'),
    BOTAO_SAIDA,
  ];
}
export const LIMITE_BOTAO_TEXTO = 25;
/** Telefone do botão: até 20 caracteres (documentação de componentes da Meta). */
export const LIMITE_BOTAO_TELEFONE = 20;
export const LIMITE_LTO_TEXTO = 16;

/**
 * Chaves fora do padrão da Meta: tudo que tem `{` ou `}` e não é `{{n}}` —
 * `{nome}`, `{{nome}}`, `{{1}`. A Meta recusa o modelo inteiro por isso
 * ("variable parameters … have mismatched curly braces"), horas depois, com o
 * código INVALID_FORMAT; aqui a pessoa vê na hora, com o que trocar.
 */
export function chavesForaDoPadrao(texto: string): string[] {
  const semVariaveis = texto.replace(/\{\{\s*\d+\s*\}\}/g, ' ');
  const achados = semVariaveis.match(/\{+[^{}\n]{0,40}\}*|[^{}\s]{0,20}\}+/g) ?? [];
  return [...new Set(achados.map((a) => a.trim()).filter(Boolean))];
}

/**
 * Pedido de dado sensível: a política do WhatsApp Business proíbe pedir
 * "identificadores sensíveis" — senha, dados de cartão, documento de
 * identidade (CPF, RG). Motivo de recusa listado pela Meta na revisão de
 * modelos (conferido em 25/09/2026).
 */
const DADO_SENSIVEL =
  /(?<![\p{L}\p{N}])(senhas?|cvv|c[óo]digo de seguran[çc]a|n[úu]mero do cart[ãa]o|dados do cart[ãa]o|cpf|rg)(?![\p{L}\p{N}])/iu;

/** Tom de ameaça ao cliente (ação judicial, negativação): outro motivo de recusa da lista da Meta. */
const AMEACA =
  /(?<![\p{L}\p{N}])(processo judicial|a[çc][ãa]o judicial|cobran[çc]a judicial|negativa[çc][ãa]o|negativar|protestar|protesto|serasa|spc|nome sujo)(?![\p{L}\p{N}])/iu;

/** O conteúdo que a Meta recusa pela política, em qualquer parte de texto do modelo. */
function problemasDeConteudo(texto: string): string[] {
  const achados: string[] = [];
  const sensivel = texto.match(DADO_SENSIVEL);
  if (sensivel) {
    achados.push(
      `"${sensivel[0]}": a Meta recusa modelo que pede dado sensível (senha, dados de cartão, CPF, RG) — é a política do WhatsApp Business. Tire esse pedido do texto; se precisar do dado, peça numa conversa.`,
    );
  }
  const ameaca = texto.match(AMEACA);
  if (ameaca) {
    achados.push(
      `"${ameaca[0]}": a Meta recusa modelo com tom de ameaça ao cliente (ação judicial, negativação, protesto). Reescreva sem isso.`,
    );
  }
  return achados;
}

/**
 * Palavras FORA das variáveis. A Meta recusa modelo com "variável demais para o
 * tamanho da mensagem" sem publicar o número; a regra que os provedores
 * documentam é de pelo menos 2N + 1 palavras fixas para N variáveis.
 */
export function palavrasFixas(texto: string): number {
  return texto
    .replace(/\{\{\s*\d+\s*\}\}/g, ' ')
    .split(/\s+/)
    .filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}

/** A frase para cada chave fora do padrão, dizendo o que pôr no lugar. */
function problemasDeChaves(texto: string): string[] {
  return chavesForaDoPadrao(texto).map((trecho) =>
    /^\{\{?\s*(primeiro[\s_]?nome|nome|name|cliente)\s*\}?\}$/i.test(trecho)
      ? `"${trecho}" não é variável do WhatsApp: troque por {{1}}. Na hora de montar a campanha você escolhe que {{1}} é o nome do contato.`
      : `"${trecho}" está fora do padrão: a Meta só aceita variável como {{1}}, {{2}}… (número entre chaves duplas). Troque, ou tire as chaves.`,
  );
}

/** Encontra as variáveis `{{n}}` na ordem em que aparecem. */
export function variaveisDe(texto: string): number[] {
  const achadas: number[] = [];
  const padrao = /\{\{\s*(\d+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = padrao.exec(texto)) !== null) achadas.push(Number(m[1]));
  return achadas;
}

/**
 * Os exemplos que vão para a Meta: um por variável distinta do texto, na ordem.
 *
 * A tela guarda os exemplos por posição. Quem preenche dois e depois apaga o
 * `{{2}}` do texto fica com um sobrando — e exemplo a mais é recusa da Meta
 * (132000, "number of parameters does not match").
 */
export function exemplosDoCorpo(corpo: string | null | undefined, exemplos: string[] | null | undefined): string[] {
  return (exemplos ?? [])
    .slice(0, quantasVariaveis(corpo ?? ''))
    .filter((e) => (e ?? '').trim().length > 0);
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
  for (const mensagem of problemasDeChaves(corpo)) p('corpo', mensagem);
  for (const mensagem of problemasDeConteudo(corpo)) p('corpo', mensagem);

  // -------------------------------------------------------------- carrossel
  //
  // O carrossel exclui três coisas de uma vez. Conferir isso ANTES das regras
  // de cabeçalho e rodapé evita cobrar do cliente um campo que a forma dele
  // nem tem.
  if (m.tipo === 'carrossel') {
    problemas.push(...conferirCarrossel(m));
    return problemas;
  }

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
    for (const mensagem of problemasDeChaves(cab)) p('cabecalho', mensagem);
    for (const mensagem of problemasDeConteudo(cab)) p('cabecalho', mensagem);
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
  for (const mensagem of problemasDeChaves(rodape)) p('rodape', mensagem);
  for (const mensagem of problemasDeConteudo(rodape)) p('rodape', mensagem);
  if (rodape) {
    if (rodape.length > LIMITE_RODAPE) {
      p('rodape', `O rodapé precisa ter até ${LIMITE_RODAPE} caracteres.`);
    }
    if (variaveisDe(rodape).length) {
      p('rodape', 'O rodapé não aceita variáveis.');
    }
  }

  // ----------------------------------------------------------------- botões
  //
  // No marketing simples, o botão de saída entra por nossa conta: o cliente
  // valida com ele junto, senão passaria dos 10 só na hora de enviar à Meta.
  problemas.push(...conferirBotoes(botoesComSaida(m)));

  if (m.categoria === 'MARKETING' && (m.tipo ?? 'simples') === 'simples') {
    const doCliente = (m.botoes ?? []).filter((b) => !ehBotaoDeSaida(b));
    if (doCliente.length > LIMITE_BOTOES_MARKETING) {
      problemas.push({
        campo: 'botoes',
        mensagem:
          `Em marketing você monta até ${LIMITE_BOTOES_MARKETING} botões: o último é sempre "${BOTAO_SAIDA.texto}", ` +
          'que acrescentamos para a pessoa poder sair sem bloquear o seu número.',
      });
    }
  }

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

  // Variável demais para o tamanho do texto: a Meta recusa (motivo da lista
  // dela). Cada ocorrência conta — é o que ela vê no texto.
  const fixas = palavrasFixas(texto);
  const minimo = 2 * ocorrencias.length + 1;
  if (fixas < minimo) {
    p(
      `Texto curto para ${ocorrencias.length} ${ocorrencias.length === 1 ? 'variável' : 'variáveis'}: a Meta recusa modelo com variável demais para o tamanho da mensagem. Escreva pelo menos ${minimo} palavras fora das variáveis (hoje são ${fixas}).`,
    );
  }

  // Um exemplo por variável distinta. Contar ocorrências em vez de distintas é
  // o erro 132000 da Meta — foi o que a auditoria do Regem encontrou. Conta
  // só as primeiras posições: o exemplo de uma variável que saiu do texto não
  // vale por outra (e nem vai para a Meta — `exemplosDoCorpo`).
  const informados = exemplos
    .slice(0, distintas.length)
    .filter((e) => (e ?? '').trim().length > 0).length;
  if (informados < distintas.length) {
    p(
      `Preencha um exemplo para cada variável: são ${distintas.length}, e você informou ${informados}. A Meta recusa o modelo sem eles.`,
    );
  }

  return problemas;
}

/**
 * As regras do carrossel.
 *
 * A que mais derruba modelo é a última: **todos os cartões precisam ter a mesma
 * estrutura de botões**. A Meta monta um carrossel como um componente único, e
 * um cartão com dois botões ao lado de outro com um só é recusado inteiro — sem
 * dizer qual cartão está diferente.
 */
function conferirCarrossel(m: ModeloParaValidar): ProblemaNoModelo[] {
  const problemas: ProblemaNoModelo[] = [];
  const p = (campo: ProblemaNoModelo['campo'], mensagem: string) =>
    problemas.push({ campo, mensagem });

  // O carrossel não tem estas partes. Avisar é melhor do que ignorar em
  // silêncio: o cliente escreveu o rodapé e precisa saber que ele não vai.
  if ((m.rodape ?? '').trim()) {
    p('rodape', 'Carrossel não tem rodapé. Remova o rodapé ou volte para o modelo simples.');
  }
  if (m.cabecalhoFormato) {
    p('cabecalho', 'Carrossel não tem cabeçalho — a imagem fica em cada cartão.');
  }
  if (m.ltoAtivo) {
    p('lto', 'Oferta por tempo limitado não funciona com carrossel. Escolha um dos dois.');
  }

  const cartoes = m.cartoes ?? [];

  if (cartoes.length < MIN_CARTOES) {
    p('cartoes', `Um carrossel precisa de pelo menos ${MIN_CARTOES} cartões.`);
    return problemas;
  }
  if (cartoes.length > MAX_CARTOES) {
    p('cartoes', `Um carrossel aceita até ${MAX_CARTOES} cartões.`);
  }

  cartoes.forEach((c, i) => {
    const onde = `Cartão ${i + 1}`;

    if (!(c.imagem ?? '').trim()) p('cartoes', `${onde}: escolha a imagem.`);

    const corpo = (c.corpo ?? '').trim();
    if (!corpo) p('cartoes', `${onde}: escreva o texto.`);
    else if (corpo.length > LIMITE_CARTAO_CORPO) {
      p('cartoes', `${onde}: o texto precisa ter até ${LIMITE_CARTAO_CORPO} caracteres.`);
    }

    const botoes = c.botoes ?? [];
    if (botoes.length < MIN_BOTOES_CARTAO) {
      p('cartoes', `${onde}: cada cartão precisa de pelo menos um botão.`);
    } else if (botoes.length > MAX_BOTOES_CARTAO) {
      p('cartoes', `${onde}: cada cartão aceita no máximo ${MAX_BOTOES_CARTAO} botões.`);
    }

    conferirBotoes(botoes).forEach((prob) => p('cartoes', `${onde}: ${prob.mensagem}`));
  });

  // A regra que a Meta não explica na recusa: mesma estrutura em todos.
  const assinatura = (c: CartaoDoModelo) =>
    (c.botoes ?? []).map((b) => b.tipo).join('|');
  const primeira = assinatura(cartoes[0]);
  const diferente = cartoes.findIndex((c) => assinatura(c) !== primeira);
  if (diferente > 0) {
    p(
      'cartoes',
      `Todos os cartões precisam ter os mesmos botões, na mesma ordem. O cartão ${diferente + 1} está diferente do primeiro.`,
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
    if (b.tipo !== 'COPY_CODE' && /[{}]/.test(texto)) {
      p(`${onde}: o texto do botão não aceita variável nem chaves { }.`);
    }

    if (b.tipo === 'URL') {
      const url = (b.url ?? '').trim();
      if (!url) p(`${onde}: informe o link.`);
      else if (!/^https?:\/\//i.test(url)) p(`${onde}: o link precisa começar com http:// ou https://.`);
      else if (/[{}]/.test(url)) {
        // Link com variável exige exemplo na Meta, e o envio daqui manda link fixo.
        p(`${onde}: use o link completo, sem variável ou chaves { } — link com variável ainda não é aceito aqui.`);
      }
    }

    if (b.tipo === 'PHONE_NUMBER') {
      const telefone = (b.telefone ?? '').trim();
      if (!telefone) p(`${onde}: informe o telefone.`);
      else if (telefone.length > LIMITE_BOTAO_TELEFONE) {
        p(`${onde}: o telefone precisa ter até ${LIMITE_BOTAO_TELEFONE} caracteres.`);
      }
    }
  });

  return problemas;
}
