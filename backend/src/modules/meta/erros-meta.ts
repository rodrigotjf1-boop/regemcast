/**
 * Catálogo de erros da Cloud API, traduzido e classificado.
 *
 * Existe por uma cicatriz concreta: no Regem o código numérico da Meta nunca é
 * lido. O caminho de envio pega `res.text()`, corta em 200 caracteres e joga
 * dentro de uma exceção — o lojista vê um pedaço de JSON cortado no meio de uma
 * chave, e quem vai depurar não sabe se foi número inválido, template reprovado
 * ou limite atingido. Diagnosticar custa horas que o código numérico resolveria
 * em segundos.
 *
 * Aqui o código decide duas coisas diferentes, e é importante não confundi-las:
 *
 *   1. O QUE O USUÁRIO LÊ — uma frase em pt-BR que diz o que houve e o que
 *      fazer. Nunca "Erro ao enviar (400)".
 *   2. SE RETENTA — e isso é decisão de máquina, não de texto. Retentar um erro
 *      permanente queima destinatário e cobra de novo; não retentar um erro
 *      transitório perde entrega por um soluço de rede.
 *
 * Classificação conforme a documentação oficial de error codes da Cloud API.
 */

/** O que o motor de disparo deve fazer diante do erro. */
export type ClasseErroMeta =
  /** Soluço do outro lado. Retentar com recuo exponencial. */
  | 'transitorio'
  /** Teto atingido. Retentar, mas só depois de bastante tempo. */
  | 'limite'
  /** O problema é o destinatário. Não retentar nunca; marcar o contato. */
  | 'destinatario'
  /** Configuração errada (template, número, parâmetro). Não retentar: repetir dá o mesmo erro. */
  | 'config'
  /** A credencial caiu. Não retentar com ela; renovar primeiro. */
  | 'credencial'
  /** Política violada ou conta restrita. Não retentar; exige ação humana, e rápido. */
  | 'politica';

export interface ErroMetaTraduzido {
  /** Código numérico como a Meta devolve. */
  codigo: number;
  classe: ClasseErroMeta;
  /** Frase curta para a coluna de status. */
  titulo: string;
  /** O que aconteceu e o que fazer, em pt-BR, para quem opera — não para quem programa. */
  explicacao: string;
  /**
   * Espera mínima antes de tentar de novo, quando a classe permite retentar.
   * `131049` pede 24h pela própria documentação da Meta.
   */
  esperaSegundos?: number;
}

const CATALOGO: Record<number, Omit<ErroMetaTraduzido, 'codigo'>> = {
  // ---------------------------------------------------------------- transitórios
  131016: {
    classe: 'transitorio',
    titulo: 'Serviço da Meta indisponível',
    explicacao:
      'A Meta está temporariamente fora do ar. Vamos tentar de novo sozinhos em alguns minutos — você não precisa fazer nada.',
    esperaSegundos: 300,
  },
  133004: {
    classe: 'transitorio',
    titulo: 'Servidor da Meta ocupado',
    explicacao:
      'O servidor da Meta não respondeu a tempo. Vamos tentar de novo automaticamente.',
    esperaSegundos: 120,
  },
  130429: {
    classe: 'limite',
    titulo: 'Ritmo acima do permitido',
    explicacao:
      'Mandamos mensagens rápido demais para a Meta aceitar. A campanha desacelera sozinha e continua — nenhuma mensagem se perde.',
    esperaSegundos: 60,
  },
  80007: {
    classe: 'limite',
    titulo: 'Limite de chamadas à Meta',
    explicacao:
      'Atingimos o teto de chamadas que a Meta permite por hora. A campanha retoma sozinha assim que a janela virar.',
    esperaSegundos: 900,
  },

  // ---------------------------------------------------------------- limite por usuário
  131049: {
    classe: 'limite',
    titulo: 'Meta segurou esta mensagem',
    explicacao:
      'A Meta não entregou porque esta pessoa já recebeu muita mensagem de marketing hoje. Não é erro seu nem do número: é a regra que a Meta chama de "engajamento saudável". Reenviar antes de 24 horas piora a situação — ela pode receber numa próxima campanha.',
    // A própria documentação manda esperar 24h. Este código costuma chegar
    // DEPOIS, pelo aviso de entrega; aí não reenviamos sozinhos — a Meta pune
    // quem insiste com quem atingiu o limite.
    esperaSegundos: 86_400,
  },

  // ---------------------------------------------------------------- destinatário
  131026: {
    classe: 'destinatario',
    titulo: 'Número não recebe no WhatsApp',
    explicacao:
      'Este número não tem WhatsApp, não aceitou os termos do aplicativo ou está numa versão antiga. Não adianta reenviar — confira o número com o contato.',
  },
  131021: {
    classe: 'destinatario',
    titulo: 'Remetente e destinatário são o mesmo número',
    explicacao: 'Não dá para enviar do número conectado para ele mesmo.',
  },
  131047: {
    classe: 'config',
    titulo: 'Janela de 24 horas fechada',
    explicacao:
      'Faz mais de 24 horas desde a última mensagem desta pessoa, então só um modelo aprovado pode iniciar a conversa. Use uma campanha com modelo.',
  },

  // ---------------------------------------------------------------- configuração
  132000: {
    classe: 'config',
    titulo: 'Modelo e variáveis não batem',
    explicacao:
      'O modelo espera uma quantidade de variáveis diferente da que foi enviada. Abra o modelo e confira quantos campos ele tem — e se algum {{1}} aparece repetido no texto.',
  },
  132001: {
    classe: 'config',
    titulo: 'Modelo não existe ou não está aprovado',
    explicacao:
      'A Meta não encontrou este modelo no idioma pedido, ou ele ainda não foi aprovado. Confira o status do modelo antes de disparar.',
  },
  132005: {
    classe: 'config',
    titulo: 'Texto do modelo longo demais',
    explicacao:
      'O conteúdo traduzido do modelo passou do limite de caracteres da Meta. Encurte o texto e submeta de novo.',
  },
  132012: {
    classe: 'config',
    titulo: 'Formato de variável inválido',
    explicacao:
      'Uma das variáveis não está no formato que o modelo espera. Confira se não há quebra de linha, emoji ou espaço duplo no valor enviado.',
  },
  131008: {
    classe: 'config',
    titulo: 'Falta um campo obrigatório',
    explicacao: 'A Meta recusou a chamada por falta de um parâmetro obrigatório.',
  },
  131053: {
    classe: 'config',
    titulo: 'Mídia recusada',
    explicacao:
      'A Meta não conseguiu carregar a imagem, vídeo ou documento do modelo. Confira o formato e o tamanho do arquivo.',
  },
  133010: {
    classe: 'config',
    titulo: 'Número ainda não registrado',
    explicacao:
      'O número foi conectado mas ainda não foi registrado na Cloud API. Isso é conosco — vamos concluir o registro e a campanha segue.',
  },
  133005: {
    classe: 'config',
    titulo: 'PIN de verificação incorreto',
    explicacao:
      'O PIN de duas etapas do número não confere. Se você definiu um PIN no WhatsApp Manager, informe-o para concluirmos o registro.',
  },
  133006: {
    classe: 'config',
    titulo: 'Número precisa ser verificado',
    explicacao:
      'A Meta exige verificar este número antes de registrá-lo. Conclua a verificação no WhatsApp Manager.',
  },
  133008: {
    classe: 'limite',
    titulo: 'Tentativas de registro demais',
    explicacao:
      'Houve muitas tentativas de registrar este número em pouco tempo. Espere alguns minutos antes de tentar outra vez.',
    esperaSegundos: 600,
  },

  // ---------------------------------------------------------------- credencial
  190: {
    classe: 'credencial',
    titulo: 'Conexão com o WhatsApp expirou',
    explicacao:
      'A autorização deste número venceu ou foi revogada. Reconecte a conta na tela de configuração para voltar a enviar.',
  },

  // ---------------------------------------------------------------- política
  132007: {
    classe: 'politica',
    titulo: 'Conteúdo recusado por política',
    explicacao:
      'A Meta considerou que o conteúdo do modelo viola as regras da plataforma. Revise o texto antes de submeter de novo.',
  },
  132015: {
    classe: 'politica',
    titulo: 'Modelo pausado por baixa qualidade',
    explicacao:
      'Muita gente marcou este modelo como indesejado, e a Meta o pausou. Edite o conteúdo para melhorar a qualidade antes de usar de novo.',
  },
  132016: {
    classe: 'politica',
    titulo: 'Modelo desativado em definitivo',
    explicacao:
      'Este modelo foi pausado vezes demais e a Meta o desativou. Será preciso criar outro, com conteúdo diferente.',
  },
  131048: {
    classe: 'politica',
    titulo: 'Envio travado por qualidade do número',
    explicacao:
      'A Meta restringiu os envios deste número porque muita gente bloqueou ou denunciou as mensagens. Confira a qualidade do número e reduza o volume antes de continuar.',
  },
  131031: {
    classe: 'politica',
    titulo: 'Conta restrita pela Meta',
    explicacao:
      'A conta de WhatsApp está restrita por violação de política ou por dados não verificados. É preciso resolver isso no WhatsApp Manager — nenhum envio sai até lá.',
  },
  368: {
    classe: 'politica',
    titulo: 'Conta bloqueada por violação de política',
    explicacao:
      'A Meta bloqueou temporariamente esta conta por violação das regras da plataforma. Consulte o WhatsApp Manager para ver o motivo e o prazo.',
  },
};

/** Quando o código é desconhecido: erro honesto, sem inventar diagnóstico. */
function desconhecido(codigo: number, mensagemDaMeta?: string): ErroMetaTraduzido {
  return {
    codigo,
    // Sem catálogo não dá para afirmar se retentar resolve. Tratar como
    // transitório arriscaria queimar destinatário em laço; tratar como
    // permanente perde entrega recuperável. `config` é o meio-termo honesto:
    // não retenta sozinho e aparece para alguém olhar.
    classe: 'config',
    titulo: `Erro ${codigo} da Meta`,
    explicacao:
      (mensagemDaMeta?.trim()
        ? `A Meta respondeu: "${mensagemDaMeta.trim()}". `
        : '') + 'Este código ainda não está mapeado — registre para investigarmos.',
  };
}

/**
 * Traduz o código numérico. `mensagemDaMeta` só é usada quando o código é
 * desconhecido — quando conhecemos o código, nossa frase é melhor que a dela,
 * que vem em inglês e escrita para quem programa.
 */
export function traduzirErroMeta(
  codigo: number | null | undefined,
  mensagemDaMeta?: string,
): ErroMetaTraduzido {
  if (codigo == null || !Number.isFinite(codigo)) {
    return desconhecido(0, mensagemDaMeta);
  }
  const achado = CATALOGO[codigo];
  if (!achado) return desconhecido(codigo, mensagemDaMeta);
  return { codigo, ...achado };
}

/** Deve entrar de novo na fila? */
export function deveRetentar(erro: ErroMetaTraduzido): boolean {
  return erro.classe === 'transitorio' || erro.classe === 'limite';
}

/**
 * Extrai o código numérico do corpo de erro da Graph API.
 *
 * A Meta aninha o código em lugares diferentes conforme o caminho: no envio vem
 * em `error.code`, e o detalhe específico da mensagem em
 * `error.error_data.details`. O webhook de status usa `errors[0].code`. Ler só
 * um dos formatos é o que faz metade dos erros chegarem sem código.
 */
export function codigoDoErro(corpo: unknown): number | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const o = corpo as Record<string, unknown>;

  const erro = (o.error ?? o) as Record<string, unknown> | undefined;
  if (erro && typeof erro === 'object') {
    const c = erro.code;
    if (typeof c === 'number') return c;
    if (typeof c === 'string' && /^\d+$/.test(c)) return Number(c);
  }

  // Webhook de status: { errors: [ { code, title, error_data: { details } } ] }
  const erros = o.errors;
  if (Array.isArray(erros) && erros.length) {
    const primeiro = erros[0] as Record<string, unknown>;
    const c = primeiro?.code;
    if (typeof c === 'number') return c;
    if (typeof c === 'string' && /^\d+$/.test(c)) return Number(c);
  }

  return null;
}

/** Mensagem crua da Meta, para o log e para código não mapeado. */
export function mensagemDoErroMeta(corpo: unknown): string {
  if (!corpo || typeof corpo !== 'object') return '';
  const o = corpo as Record<string, unknown>;
  const erro = (o.error ?? {}) as Record<string, unknown>;
  const dados = (erro.error_data ?? {}) as Record<string, unknown>;

  const partes = [
    typeof erro.error_user_msg === 'string' ? erro.error_user_msg : '',
    typeof dados.details === 'string' ? dados.details : '',
    typeof erro.message === 'string' ? erro.message : '',
  ].filter(Boolean);

  if (partes.length) return partes[0]!;

  const erros = o.errors;
  if (Array.isArray(erros) && erros.length) {
    const p = erros[0] as Record<string, unknown>;
    const d = (p?.error_data ?? {}) as Record<string, unknown>;
    return (
      (typeof d.details === 'string' && d.details) ||
      (typeof p?.title === 'string' && p.title) ||
      (typeof p?.message === 'string' && p.message) ||
      ''
    );
  }
  return '';
}
