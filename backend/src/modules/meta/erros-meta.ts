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
 * Aqui o código decide três coisas diferentes, e é importante não confundi-las:
 *
 *   1. O QUE O USUÁRIO LÊ — o que houve (`explicacao`) e o que fazer (`acao`),
 *      em pt-BR, com quem resolve (`quem`) e onde (`tela`, ou o link que a
 *      própria Meta mandou). Nunca "Erro ao enviar (400)", nunca a frase dela
 *      em inglês no meio da tela.
 *   2. SE RETENTA (`classe`) — decisão de máquina, não de texto. Retentar um
 *      erro permanente queima destinatário e cobra de novo; não retentar um
 *      erro transitório perde entrega por um soluço de rede.
 *   3. QUEM O ERRO ATINGE (`alcance`) — só esta pessoa, o modelo ou a conta
 *      inteira. Erro da conta (pagamento, restrição, credencial) ou do modelo
 *      teria a mesma resposta na próxima mensagem: a campanha PARA na primeira,
 *      com a fila guardada, em vez de marcar um destinatário por vez.
 *
 * Códigos e classificação conforme a lista oficial de error codes da Cloud API
 * (conferida em 01/10/2026). Código fora da lista ganha texto honesto: diz que
 * não conhecemos, guarda o que a Meta respondeu e não inventa diagnóstico.
 */

/** O que o motor de disparo deve fazer diante do erro. */
export type ClasseErroMeta =
  /** Soluço do outro lado. Retentar com recuo exponencial. */
  | 'transitorio'
  /** Teto atingido. Retentar, mas só depois de bastante tempo. */
  | 'limite'
  /** O problema é o destinatário. Não retentar nunca; marcar o contato. */
  | 'destinatario'
  /** Configuração errada (template, número, parâmetro, pagamento). Não retentar: repetir dá o mesmo erro. */
  | 'config'
  /** A credencial caiu. Não retentar com ela; renovar primeiro. */
  | 'credencial'
  /** Política violada ou conta restrita. Não retentar; exige ação humana, e rápido. */
  | 'politica';

/** Quem o erro atinge — decide se a campanha segue, espera ou para. */
export type AlcanceErroMeta =
  /** Só esta pessoa: a próxima mensagem pode sair. */
  | 'destinatario'
  /** O modelo: a próxima mensagem teria a mesma resposta. */
  | 'modelo'
  /** A conta ou o número: nenhuma mensagem sai até alguém resolver. */
  | 'conta'
  /** Passageiro: tentar de novo, mais tarde, resolve. */
  | 'passageiro';

/** Quem resolve: o cliente, o Regemcast, ou ninguém (passa sozinho, ou não tem o que fazer). */
export type QuemResolve = 'voce' | 'nos' | 'ninguem';

/** A tela do Regemcast onde se resolve, quando existe uma. */
export type TelaDoErro = 'whatsapp' | 'modelos' | 'contatos' | 'bloqueios';

/** Por que uma campanha pausa por erro da Meta. */
export type PausaPorErro = 'modelo' | 'conta_meta' | 'conexao';

export interface LinkDoErro {
  rotulo: string;
  url: string;
}

export interface ErroMetaTraduzido {
  /** Código numérico como a Meta devolve. */
  codigo: number;
  classe: ClasseErroMeta;
  alcance: AlcanceErroMeta;
  quem: QuemResolve;
  /** Frase curta para a coluna de status. */
  titulo: string;
  /** O que aconteceu, em pt-BR, para quem opera — não para quem programa. */
  explicacao: string;
  /** O que fazer agora. Só promete o que o sistema faz. */
  acao: string;
  /** A tela do Regemcast onde se resolve. */
  tela?: TelaDoErro;
  /** O endereço que a própria Meta mandou para resolver (pagamento, termos). */
  link?: LinkDoErro;
  /**
   * A frase da Meta, crua, quando veio. Nunca é a explicação: a tela a mostra
   * recolhida, para quem quiser ler ou mandar ao suporte (num erro de
   * parâmetro, é ela que diz qual campo).
   */
  daMeta?: string;
  /**
   * Espera mínima antes de tentar de novo, quando a classe permite retentar.
   * `131049` pede 24h pela própria documentação da Meta.
   */
  esperaSegundos?: number;
}

type Entrada = Omit<ErroMetaTraduzido, 'codigo' | 'link' | 'daMeta'>;

const SOZINHO = 'Não precisa fazer nada: tentamos de novo sozinhos.';
const RECONECTAR = 'Reconecte o WhatsApp em WhatsApp, no menu, e retome a campanha.';
const SUPORTE = 'Fale com o suporte informando o código do erro: é conosco.';

/** Permissão retirada ou nunca dada (3, 10, 131005, 200 a 299): o mesmo caso, com códigos diferentes. */
const SEM_PERMISSAO: Entrada = {
  classe: 'credencial',
  alcance: 'conta',
  quem: 'voce',
  tela: 'whatsapp',
  titulo: 'Permissão retirada na Meta',
  explicacao:
    'A Meta diz que o Regemcast não tem permissão para enviar por esta conta: a permissão foi retirada, ou não chegou a ser dada na conexão.',
  acao: 'Reconecte o WhatsApp em WhatsApp, no menu, aceitando as permissões pedidas. Se repetir, fale com o suporte.',
};

/** Formatação de uma parte do modelo recusada na criação. */
const formatoDoModelo = (parte: string, titulo: string): Entrada => ({
  classe: 'config',
  alcance: 'modelo',
  quem: 'voce',
  tela: 'modelos',
  titulo,
  explicacao: `A Meta não aceitou a formatação ${parte} do modelo.`,
  acao: `Revise ${parte.replace(/^d/, '')}: variável mal escrita, formatação ou caractere que a Meta não aceita. Depois, envie para aprovação de novo.`,
});

const CATALOGO: Record<number, Entrada> = {
  // ---------------------------------------------------------------- passageiros
  1: {
    classe: 'transitorio',
    alcance: 'passageiro',
    quem: 'ninguem',
    titulo: 'Erro interno da Meta',
    explicacao: 'A Meta não conseguiu atender ao pedido. Costuma ser instabilidade do lado dela.',
    acao: SOZINHO,
    esperaSegundos: 120,
  },
  2: {
    classe: 'transitorio',
    alcance: 'passageiro',
    quem: 'ninguem',
    titulo: 'Meta fora do ar ou sobrecarregada',
    explicacao: 'A Meta estava fora do ar ou sobrecarregada no momento do envio.',
    acao: SOZINHO,
    esperaSegundos: 300,
  },
  131000: {
    classe: 'transitorio',
    alcance: 'passageiro',
    quem: 'ninguem',
    titulo: 'A Meta não conseguiu enviar',
    explicacao: 'A Meta teve um erro interno ao enviar esta mensagem e não disse o motivo.',
    acao: SOZINHO,
    esperaSegundos: 120,
  },
  131016: {
    classe: 'transitorio',
    alcance: 'passageiro',
    quem: 'ninguem',
    titulo: 'Serviço da Meta indisponível',
    explicacao: 'A Meta estava temporariamente fora do ar.',
    acao: 'Não precisa fazer nada: tentamos de novo sozinhos em alguns minutos.',
    esperaSegundos: 300,
  },
  131057: {
    classe: 'transitorio',
    alcance: 'passageiro',
    quem: 'ninguem',
    titulo: 'Conta em manutenção na Meta',
    explicacao:
      'A Meta colocou a conta do WhatsApp em manutenção por alguns minutos — costuma ser uma melhoria de capacidade.',
    acao: SOZINHO,
    esperaSegundos: 600,
  },
  133004: {
    classe: 'transitorio',
    alcance: 'passageiro',
    quem: 'ninguem',
    titulo: 'Servidor da Meta ocupado',
    explicacao: 'O servidor da Meta não respondeu a tempo.',
    acao: SOZINHO,
    esperaSegundos: 120,
  },
  130429: {
    classe: 'limite',
    alcance: 'passageiro',
    quem: 'ninguem',
    titulo: 'Ritmo acima do permitido',
    explicacao: 'Mandamos mensagens mais rápido do que a Meta aceita.',
    acao: 'Não precisa fazer nada: a campanha desacelera sozinha e continua.',
    esperaSegundos: 60,
  },
  80007: {
    classe: 'limite',
    alcance: 'passageiro',
    quem: 'ninguem',
    titulo: 'Limite de chamadas à Meta',
    explicacao: 'A conta atingiu o teto de chamadas que a Meta permite por hora.',
    acao: 'Não precisa fazer nada: a campanha retoma sozinha assim que a janela virar.',
    esperaSegundos: 900,
  },
  4: {
    classe: 'limite',
    alcance: 'passageiro',
    quem: 'nos',
    titulo: 'Limite de chamadas do Regemcast',
    explicacao: 'O Regemcast atingiu o teto de chamadas à Meta nesta hora.',
    acao: 'Não precisa fazer nada: é conosco, e a campanha retoma sozinha assim que a janela virar.',
    esperaSegundos: 900,
  },
  131056: {
    classe: 'limite',
    alcance: 'passageiro',
    quem: 'ninguem',
    titulo: 'Muitas mensagens para a mesma pessoa',
    explicacao: 'A Meta segurou porque este número recebeu várias mensagens da sua empresa em pouco tempo.',
    acao: 'Não precisa fazer nada: tentamos de novo mais tarde.',
    esperaSegundos: 600,
  },

  // ---------------------------------------------------------------- limite por usuário
  131049: {
    classe: 'limite',
    alcance: 'destinatario',
    quem: 'ninguem',
    titulo: 'Meta segurou esta mensagem',
    explicacao:
      'A Meta não entregou porque esta pessoa já recebeu muita mensagem de marketing nos últimos dias — de qualquer empresa, não só da sua. Não é erro seu nem do número: é a regra que a Meta chama de "engajamento saudável".',
    acao: 'Não reenvie antes de 24 horas: insistir piora a situação. Ela pode receber numa próxima campanha.',
    // A própria documentação manda esperar 24h. Este código costuma chegar
    // DEPOIS, pelo aviso de entrega; aí não reenviamos sozinhos — a Meta pune
    // quem insiste com quem atingiu o limite.
    esperaSegundos: 86_400,
  },

  // ---------------------------------------------------------------- destinatário
  131026: {
    classe: 'destinatario',
    alcance: 'destinatario',
    quem: 'voce',
    tela: 'contatos',
    titulo: 'Número não recebe no WhatsApp',
    explicacao:
      'Este número não tem WhatsApp, não aceitou os termos do aplicativo ou usa uma versão muito antiga.',
    acao: 'Confira o número com o contato. Reenviar para o mesmo número não adianta.',
  },
  131050: {
    classe: 'destinatario',
    alcance: 'destinatario',
    quem: 'ninguem',
    tela: 'bloqueios',
    titulo: 'Parou o marketing pelo WhatsApp',
    explicacao:
      'A pessoa escolheu, no próprio WhatsApp, não receber mais mensagens de marketing da sua empresa.',
    acao: 'Não precisa fazer nada, e reenviar não adianta: ela sai dos envios sozinha e aparece em Contatos, na aba Bloqueios. Se voltar a aceitar pelo WhatsApp, volta sozinha também.',
  },
  131021: {
    classe: 'destinatario',
    alcance: 'destinatario',
    quem: 'voce',
    titulo: 'Remetente e destinatário são o mesmo número',
    explicacao: 'Não dá para enviar do número conectado para ele mesmo.',
    acao: 'Tire este número da lista. Para testar, use outro número.',
  },
  130403: {
    classe: 'destinatario',
    alcance: 'destinatario',
    quem: 'voce',
    titulo: 'Número bloqueado pela sua empresa',
    explicacao: 'A Meta não entregou porque este número está bloqueado no WhatsApp da sua empresa.',
    acao: 'Desbloqueie o número no WhatsApp da empresa, se quiser voltar a falar com ele. Reenviar sem desbloquear não adianta.',
  },
  130472: {
    classe: 'destinatario',
    alcance: 'destinatario',
    quem: 'ninguem',
    titulo: 'Número em teste da Meta',
    explicacao:
      'A Meta não entregou esta mensagem de marketing porque este número faz parte de um experimento dela, que segura parte dos envios.',
    acao: 'Não precisa fazer nada, e reenviar não adianta: não é erro seu nem do número.',
  },
  130497: {
    classe: 'politica',
    alcance: 'destinatario',
    quem: 'voce',
    tela: 'contatos',
    titulo: 'País não permitido para a sua conta',
    explicacao:
      'A Meta não deixa a sua conta enviar para pessoas deste país — a regra depende do ramo do negócio.',
    acao: 'Tire da lista os números deste país.',
  },
  131009: {
    classe: 'config',
    alcance: 'destinatario',
    quem: 'voce',
    tela: 'contatos',
    titulo: 'Dado inválido na mensagem',
    explicacao:
      'A Meta não aceitou um dos valores desta mensagem. O mais comum é o número de telefone fora do formato.',
    acao: 'Confira o número deste contato: país, DDD e número, só dígitos.',
  },
  100: {
    classe: 'config',
    alcance: 'destinatario',
    quem: 'voce',
    titulo: 'A Meta não aceitou os dados da mensagem',
    explicacao: 'Um campo desta mensagem chegou vazio ou fora do formato que a Meta espera.',
    acao: 'Confira se o contato tem o dado que o modelo usa (o nome, por exemplo). Se acontecer com todos, fale com o suporte.',
  },
  131008: {
    classe: 'config',
    alcance: 'destinatario',
    quem: 'voce',
    titulo: 'Falta um campo obrigatório',
    explicacao: 'A Meta recusou a mensagem por falta de um dado obrigatório.',
    acao: 'Confira o modelo e as variáveis desta pessoa. Se estiver tudo preenchido, fale com o suporte.',
  },
  135000: {
    classe: 'config',
    alcance: 'destinatario',
    quem: 'nos',
    titulo: 'Erro nos dados do pedido',
    explicacao: 'A Meta recusou a mensagem por um erro nos dados, sem dizer qual.',
    acao: SUPORTE,
  },
  131051: {
    classe: 'config',
    alcance: 'destinatario',
    quem: 'nos',
    titulo: 'Tipo de mensagem não aceito',
    explicacao: 'A Meta não aceita este tipo de mensagem.',
    acao: SUPORTE,
  },
  131052: {
    classe: 'destinatario',
    alcance: 'destinatario',
    quem: 'voce',
    titulo: 'Não deu para baixar a mídia recebida',
    explicacao: 'A Meta não conseguiu entregar a foto, o áudio ou o arquivo que a pessoa enviou.',
    acao: 'Peça para a pessoa enviar de novo.',
  },
  131047: {
    classe: 'config',
    alcance: 'destinatario',
    quem: 'voce',
    titulo: 'Janela de 24 horas fechada',
    explicacao:
      'Faz mais de 24 horas desde a última mensagem desta pessoa, e fora desse prazo só um modelo aprovado pode iniciar a conversa.',
    acao: 'Envie um modelo aprovado no lugar do texto livre.',
  },

  // ---------------------------------------------------------------- modelo
  132000: {
    classe: 'config',
    alcance: 'modelo',
    quem: 'voce',
    tela: 'modelos',
    titulo: 'Modelo e variáveis não batem',
    explicacao: 'O modelo espera uma quantidade de variáveis diferente da que foi enviada.',
    acao: 'Abra o modelo e confira quantas variáveis ele tem — e se alguma aparece repetida no texto. Depois, retome a campanha.',
  },
  132001: {
    classe: 'config',
    alcance: 'modelo',
    quem: 'voce',
    tela: 'modelos',
    titulo: 'Modelo não existe ou não está aprovado',
    explicacao: 'A Meta não encontrou este modelo no idioma pedido, ou ele ainda não foi aprovado.',
    acao: 'Confira a situação do modelo em Modelos. Com ele aprovado, retome a campanha.',
  },
  132005: {
    classe: 'config',
    alcance: 'modelo',
    quem: 'voce',
    tela: 'modelos',
    titulo: 'Texto do modelo longo demais',
    explicacao: 'Com as variáveis preenchidas, o texto passou do limite de caracteres da Meta.',
    acao: 'Encurte o texto do modelo ou o valor das variáveis.',
  },
  132012: {
    classe: 'config',
    alcance: 'modelo',
    quem: 'voce',
    tela: 'modelos',
    titulo: 'Formato de variável inválido',
    explicacao:
      'Um valor enviado não está no formato que o modelo espera: o tipo de mídia do cabeçalho, ou uma variável vazia ou com quebra de linha.',
    acao: 'Confira o cabeçalho e as variáveis do modelo. Se o modelo está certo, fale com o suporte.',
  },
  132007: {
    classe: 'politica',
    alcance: 'modelo',
    quem: 'voce',
    tela: 'modelos',
    titulo: 'Conteúdo recusado por política',
    explicacao: 'A Meta considerou que o conteúdo do modelo viola as regras da plataforma.',
    acao: 'Revise o texto do modelo e envie para aprovação de novo.',
  },
  132015: {
    classe: 'politica',
    alcance: 'modelo',
    quem: 'voce',
    tela: 'modelos',
    titulo: 'Modelo pausado por baixa qualidade',
    explicacao: 'Muita gente bloqueou ou denunciou as mensagens deste modelo, e a Meta o pausou.',
    acao: 'Espere a Meta liberar o modelo, ou edite o conteúdo para melhorar a qualidade antes de usar de novo.',
  },
  132016: {
    classe: 'politica',
    alcance: 'modelo',
    quem: 'voce',
    tela: 'modelos',
    titulo: 'Modelo desativado em definitivo',
    explicacao: 'Este modelo foi pausado vezes demais, e a Meta o desativou.',
    acao: 'Crie outro modelo, com conteúdo diferente.',
  },
  132068: {
    classe: 'config',
    alcance: 'modelo',
    quem: 'nos',
    titulo: 'Fluxo do modelo bloqueado',
    explicacao: 'O fluxo ligado a este modelo está bloqueado na Meta.',
    acao: SUPORTE,
  },
  132069: {
    classe: 'config',
    alcance: 'modelo',
    quem: 'nos',
    titulo: 'Fluxo do modelo limitado',
    explicacao: 'O fluxo ligado a este modelo está limitado pela Meta a poucas mensagens por hora.',
    acao: SUPORTE,
  },
  131053: {
    classe: 'config',
    alcance: 'modelo',
    quem: 'voce',
    tela: 'modelos',
    titulo: 'Mídia recusada',
    explicacao: 'A Meta não conseguiu usar a imagem, o vídeo ou o documento desta mensagem.',
    acao: 'Confira o formato e o tamanho do arquivo do modelo e envie o arquivo de novo.',
  },

  // ---------------------------------------------------------------- modelo: criação e edição
  2388019: {
    classe: 'config',
    alcance: 'modelo',
    quem: 'voce',
    tela: 'modelos',
    titulo: 'Limite de modelos atingido',
    explicacao: 'A conta chegou ao máximo de modelos que a Meta permite (250).',
    acao: 'Exclua modelos que não usa mais e envie de novo.',
  },
  2388039: {
    classe: 'config',
    alcance: 'modelo',
    quem: 'ninguem',
    tela: 'modelos',
    titulo: 'O modelo não pode mudar agora',
    explicacao: 'O modelo está em análise, e a Meta não aceita alteração até decidir.',
    acao: 'Espere a aprovação ou a recusa para editar.',
  },
  2388040: {
    classe: 'config',
    alcance: 'modelo',
    quem: 'voce',
    tela: 'modelos',
    titulo: 'Texto acima do limite',
    explicacao: 'Um campo do modelo passou do limite de caracteres da Meta.',
    acao: 'Encurte o campo e envie para aprovação de novo.',
  },
  2388047: formatoDoModelo('do cabeçalho', 'Cabeçalho fora do formato'),
  2388072: formatoDoModelo('da mensagem', 'Mensagem fora do formato'),
  2388073: formatoDoModelo('do rodapé', 'Rodapé fora do formato'),
  2388293: {
    classe: 'config',
    alcance: 'modelo',
    quem: 'voce',
    tela: 'modelos',
    titulo: 'Variáveis demais para pouco texto',
    explicacao: 'O modelo tem variáveis demais em relação ao tamanho do texto.',
    acao: 'Aumente o texto fixo ou tire variáveis.',
  },
  2388299: {
    classe: 'config',
    alcance: 'modelo',
    quem: 'voce',
    tela: 'modelos',
    titulo: 'Variável no começo ou no fim',
    explicacao: 'A Meta não aceita variável como primeira ou última coisa da mensagem.',
    acao: 'Ponha texto antes e depois da variável.',
  },

  // ---------------------------------------------------------------- conta: pagamento e situação na Meta
  131042: {
    classe: 'config',
    alcance: 'conta',
    quem: 'voce',
    titulo: 'Falta acertar o pagamento na Meta',
    explicacao:
      'A Meta não entregou porque o pagamento da conta do WhatsApp Business não está em ordem: falta cadastrar a forma de pagamento (com a moeda e o fuso horário), o cartão foi recusado ou a conta de pagamento está suspensa.',
    acao: 'Acerte o pagamento da conta do WhatsApp na Meta. Nenhuma mensagem sai até lá; depois, retome a campanha ou monte outra para quem não recebeu.',
  },
  134011: {
    classe: 'config',
    alcance: 'conta',
    quem: 'voce',
    titulo: 'Termos de pagamento do WhatsApp pendentes',
    explicacao: 'A Meta pede que a conta aceite os termos do WhatsApp Payments antes de enviar esta mensagem.',
    acao: 'Aceite os termos na Meta e envie de novo.',
  },
  131031: {
    classe: 'politica',
    alcance: 'conta',
    quem: 'voce',
    titulo: 'Conta restrita pela Meta',
    explicacao:
      'A conta do WhatsApp está restrita ou desativada pela Meta, por violação de política ou por um dado que ela não conseguiu conferir.',
    acao: 'Veja o motivo e o que a Meta pede no Gerenciador do WhatsApp. Nenhuma mensagem sai até lá.',
  },
  368: {
    classe: 'politica',
    alcance: 'conta',
    quem: 'voce',
    titulo: 'Conta bloqueada por violação de política',
    explicacao: 'A Meta bloqueou temporariamente esta conta por violação das regras da plataforma.',
    acao: 'Veja o motivo e o prazo no Gerenciador do WhatsApp, na Meta.',
  },
  131048: {
    classe: 'politica',
    alcance: 'conta',
    quem: 'voce',
    tela: 'whatsapp',
    titulo: 'Envio travado por qualidade do número',
    explicacao:
      'A Meta limitou os envios deste número porque muita gente bloqueou ou denunciou as mensagens.',
    acao: 'Veja a qualidade do número em WhatsApp, no menu, e reduza o volume antes de retomar.',
  },
  131064: {
    classe: 'politica',
    alcance: 'conta',
    quem: 'voce',
    tela: 'modelos',
    titulo: 'Limite reduzido por modelos na categoria errada',
    explicacao:
      'A conta atingiu o limite de envio que a Meta aplicou por modelos enviados na categoria errada.',
    acao: 'Espere o prazo da restrição acabar e revise a categoria dos modelos.',
  },
  131063: {
    classe: 'config',
    alcance: 'conta',
    quem: 'nos',
    titulo: 'Marketing desligado nesta conta',
    explicacao:
      'O modelo é de marketing, e os modelos de marketing estão desligados para esta conta do WhatsApp na Meta.',
    acao: 'Fale com o suporte: é uma configuração da conta na Meta, e ajudamos a religar.',
  },
  131037: {
    classe: 'config',
    alcance: 'conta',
    quem: 'voce',
    titulo: 'Nome de exibição não aprovado',
    explicacao: 'O nome de exibição do número ainda não foi aprovado pela Meta.',
    acao: 'Ajuste o nome de exibição do número no Gerenciador do WhatsApp, na Meta, e espere a aprovação.',
  },
  33: {
    classe: 'config',
    alcance: 'conta',
    quem: 'voce',
    tela: 'whatsapp',
    titulo: 'Número apagado na Meta',
    explicacao: 'O número conectado não existe mais na conta do WhatsApp na Meta.',
    acao: 'Conecte o número de novo em WhatsApp, no menu.',
  },

  // ---------------------------------------------------------------- conta: registro do número
  131045: {
    classe: 'config',
    alcance: 'conta',
    quem: 'voce',
    tela: 'whatsapp',
    titulo: 'Número com registro incompleto',
    explicacao: 'O número não está registrado corretamente na Cloud API.',
    acao: 'Reconecte o número em WhatsApp, no menu. Se repetir, fale com o suporte.',
  },
  133010: {
    classe: 'config',
    alcance: 'conta',
    quem: 'voce',
    tela: 'whatsapp',
    titulo: 'Número ainda não registrado',
    explicacao: 'O número foi conectado, mas ainda não está registrado na Cloud API.',
    acao: 'Conclua a conexão do número em WhatsApp, no menu. Se repetir, fale com o suporte.',
  },
  133000: {
    classe: 'config',
    alcance: 'conta',
    quem: 'nos',
    titulo: 'A remoção anterior do número falhou',
    explicacao: 'A Meta não concluiu a remoção anterior deste número, e por isso não aceita o registro.',
    acao: SUPORTE,
  },
  133005: {
    classe: 'config',
    alcance: 'conta',
    quem: 'voce',
    tela: 'whatsapp',
    titulo: 'PIN de verificação incorreto',
    explicacao: 'O PIN da verificação em duas etapas do número não confere.',
    acao: 'Informe o PIN certo. Se não lembrar, desligue a verificação em duas etapas do número e defina um PIN novo.',
  },
  133006: {
    classe: 'config',
    alcance: 'conta',
    quem: 'voce',
    tela: 'whatsapp',
    titulo: 'Número precisa ser verificado',
    explicacao: 'A Meta exige verificar este número antes de registrá-lo.',
    acao: 'Conclua a verificação do número e conecte de novo.',
  },
  133008: {
    classe: 'limite',
    alcance: 'passageiro',
    quem: 'voce',
    tela: 'whatsapp',
    titulo: 'Muitas tentativas de PIN',
    explicacao: 'Houve tentativas demais de PIN para este número em pouco tempo.',
    acao: 'Espere alguns minutos antes de tentar outra vez.',
    esperaSegundos: 600,
  },
  133009: {
    classe: 'limite',
    alcance: 'passageiro',
    quem: 'voce',
    tela: 'whatsapp',
    titulo: 'PIN digitado rápido demais',
    explicacao: 'O PIN foi enviado de novo rápido demais.',
    acao: 'Espere um minuto e tente outra vez.',
    esperaSegundos: 60,
  },
  133015: {
    classe: 'limite',
    alcance: 'passageiro',
    quem: 'ninguem',
    tela: 'whatsapp',
    titulo: 'Número apagado há pouco',
    explicacao: 'Este número foi apagado há pouco, e a Meta ainda não terminou a remoção.',
    acao: 'Espere 5 minutos e conecte de novo.',
    esperaSegundos: 300,
  },
  133016: {
    classe: 'limite',
    alcance: 'passageiro',
    quem: 'ninguem',
    tela: 'whatsapp',
    titulo: 'Muitas tentativas de registro',
    explicacao: 'Houve tentativas demais de registrar este número em pouco tempo, e a Meta o bloqueou por um período.',
    acao: 'Espere a Meta liberar antes de tentar outra vez.',
    esperaSegundos: 3_600,
  },
  2388012: {
    classe: 'config',
    alcance: 'conta',
    quem: 'voce',
    tela: 'whatsapp',
    titulo: 'Número já está na conta',
    explicacao: 'Este número já existe na lista de números da conta do WhatsApp.',
    acao: 'Use o número que já está na conta, ou outro número.',
  },
  2593107: {
    classe: 'config',
    alcance: 'conta',
    quem: 'voce',
    tela: 'whatsapp',
    titulo: 'A cópia do aplicativo já foi pedida',
    explicacao: 'A Meta só deixa pedir a cópia dos contatos e das conversas do aplicativo uma vez por número.',
    acao: 'Para copiar de novo é preciso desconectar o número e conectar outra vez.',
  },
  2593108: {
    classe: 'config',
    alcance: 'conta',
    quem: 'voce',
    tela: 'whatsapp',
    titulo: 'O prazo da cópia do aplicativo acabou',
    explicacao:
      'A cópia dos contatos e das conversas só pode ser pedida nas primeiras 24 horas depois de conectar o número.',
    acao: 'Para copiar é preciso desconectar o número e conectar outra vez.',
  },

  // ---------------------------------------------------------------- credencial
  190: {
    classe: 'credencial',
    alcance: 'conta',
    quem: 'voce',
    tela: 'whatsapp',
    titulo: 'Conexão com o WhatsApp expirou',
    explicacao: 'A autorização desta conta venceu ou foi revogada na Meta.',
    acao: RECONECTAR,
  },
  0: {
    classe: 'credencial',
    alcance: 'conta',
    quem: 'voce',
    tela: 'whatsapp',
    titulo: 'A Meta não reconheceu a autorização',
    explicacao: 'A Meta não reconheceu a autorização desta conta: ela venceu ou foi invalidada.',
    acao: RECONECTAR,
  },
  3: SEM_PERMISSAO,
  10: SEM_PERMISSAO,
  131005: SEM_PERMISSAO,
};

/** O rótulo do botão que abre o endereço mandado pela Meta. */
const ROTULO_DO_LINK: Record<number, string> = {
  131042: 'Abrir o pagamento na Meta',
  134011: 'Aceitar os termos na Meta',
};

/**
 * A ação de um erro passageiro que virou falha definitiva: tentamos, a Meta
 * recusou de novo, e a mensagem NÃO vai ser reenviada. "Tentamos de novo
 * sozinhos" seria promessa falsa nesta linha.
 */
export const ACAO_SEM_NOVA_TENTATIVA =
  'Esta mensagem não foi reenviada. Para alcançar esta pessoa, monte outra campanha mais tarde.';

/** Só endereço da própria Meta vira botão: o texto dela é dado de terceiro. */
const HOSTS_DA_META = /^(?:[a-z0-9-]+\.)*(?:facebook\.com|whatsapp\.com|meta\.com)$/i;

/** O endereço que a Meta mandou na frase do erro, quando é dela mesmo. */
export function linkNaMensagemDaMeta(mensagem: string | null | undefined): string | null {
  for (const achado of (mensagem ?? '').match(/https:\/\/[^\s"'<>]+/g) ?? []) {
    const limpo = achado.replace(/[.,;:!?)\]]+$/, '');
    try {
      const url = new URL(limpo);
      if (url.protocol === 'https:' && HOSTS_DA_META.test(url.hostname)) return url.toString();
    } catch {
      // Não é endereço: segue para o próximo.
    }
  }
  return null;
}

/** A frase da Meta, limpa para guardar e mostrar: uma linha, sem espaço sobrando, com teto. */
export function limparMensagemDaMeta(mensagem: string | null | undefined): string {
  return (mensagem ?? '').replace(/\s+/g, ' ').trim().slice(0, 1_000);
}

/** Código fora da lista: pelo intervalo dá para saber a quem ele atinge. */
function alcanceDoDesconhecido(codigo: number): AlcanceErroMeta {
  if (codigo >= 132000 && codigo <= 132999) return 'modelo';
  if (codigo >= 133000 && codigo <= 133999) return 'conta';
  return 'destinatario';
}

/** Quando o código é desconhecido: erro honesto, sem inventar diagnóstico. */
function desconhecido(codigo: number | null): Entrada {
  return {
    // Sem catálogo não dá para afirmar se retentar resolve. Tratar como
    // transitório arriscaria queimar destinatário em laço; tratar como
    // permanente perde entrega recuperável. `config` é o meio-termo honesto:
    // não retenta sozinho e aparece para alguém olhar.
    classe: 'config',
    alcance: codigo === null ? 'destinatario' : alcanceDoDesconhecido(codigo),
    quem: 'nos',
    titulo: codigo === null ? 'A Meta recusou a mensagem' : `A Meta recusou a mensagem (código ${codigo})`,
    explicacao:
      codigo === null
        ? 'A Meta recusou esta mensagem sem informar um código de erro.'
        : 'A Meta recusou esta mensagem com um código que o Regemcast ainda não conhece.',
    acao:
      codigo === null
        ? 'Se repetir, fale com o suporte.'
        : `Se repetir, fale com o suporte informando o código ${codigo}.`,
  };
}

/**
 * Traduz o código numérico. A frase da Meta (`mensagemDaMeta`) nunca vira a
 * explicação — ela vem em inglês e escrita para quem programa. Fica guardada à
 * parte (`daMeta`), e o endereço que ela trouxer para resolver vira o botão do
 * erro.
 */
export function traduzirErroMeta(
  codigo: number | null | undefined,
  mensagemDaMeta?: string | null,
): ErroMetaTraduzido {
  const numero = codigo == null || !Number.isFinite(codigo) ? null : codigo;
  const conhecido =
    numero === null ? undefined : (CATALOGO[numero] ?? (numero >= 200 && numero <= 299 ? SEM_PERMISSAO : undefined));

  const daMeta = limparMensagemDaMeta(mensagemDaMeta);
  const url = linkNaMensagemDaMeta(daMeta);

  return {
    codigo: numero ?? 0,
    ...(conhecido ?? desconhecido(numero)),
    ...(url ? { link: { rotulo: (numero !== null && ROTULO_DO_LINK[numero]) || 'Abrir na Meta', url } } : {}),
    ...(daMeta ? { daMeta } : {}),
  };
}

/**
 * Erro que não veio da Meta com código — a rede caiu, a resposta veio sem o
 * identificador. O texto é nosso, com as mesmas duas partes: o que houve e o
 * que fazer.
 */
export function erroSemCodigo(dados: {
  classe: ClasseErroMeta;
  titulo: string;
  explicacao: string;
  acao: string;
  quem?: QuemResolve;
  esperaSegundos?: number;
}): ErroMetaTraduzido {
  return {
    codigo: 0,
    alcance: dados.classe === 'transitorio' || dados.classe === 'limite' ? 'passageiro' : 'destinatario',
    quem: 'ninguem',
    ...dados,
  };
}

/**
 * O título de uma falha para quem só tem o código e o título cru da Meta (a
 * bolha da conversa). Código conhecido: o nosso, em português. Desconhecido: o
 * dela, que ainda diz mais do que "código N".
 */
export function tituloDoErroMeta(codigo: number | null | undefined, tituloDaMeta: string | null | undefined): string | null {
  if (codigo != null && Number.isFinite(codigo) && (CATALOGO[codigo] || (codigo >= 200 && codigo <= 299))) {
    return traduzirErroMeta(codigo).titulo;
  }
  return tituloDaMeta?.trim() || null;
}

/** Deve entrar de novo na fila? */
export function deveRetentar(erro: ErroMetaTraduzido): boolean {
  return erro.classe === 'transitorio' || erro.classe === 'limite';
}

/**
 * A campanha pausa por este erro? Erro do modelo ou da conta teria a mesma
 * resposta na mensagem seguinte. Credencial caída é a pausa "conexão" de
 * sempre; o resto da conta (pagamento, restrição, registro) é `conta_meta`.
 */
export function pausaPorErro(erro: ErroMetaTraduzido): PausaPorErro | null {
  if (erro.alcance === 'modelo') return 'modelo';
  if (erro.alcance === 'conta') return erro.classe === 'credencial' ? 'conexao' : 'conta_meta';
  return null;
}

/** O erro como a tela mostra: o que houve, o que fazer, quem resolve e onde. */
export interface ErroParaTela {
  codigo: number | null;
  titulo: string;
  explicacao: string;
  acao: string | null;
  quem: QuemResolve | null;
  tela: TelaDoErro | null;
  link: LinkDoErro | null;
  /** O que a Meta respondeu, cru — para quem quiser ler, ou mandar ao suporte. */
  daMeta: string | null;
}

/**
 * Monta o erro para a tela.
 *
 * `definitivo`: a mensagem falhou de vez (linha "falhou" de um destinatário).
 * Aí um erro passageiro não pode dizer "tentamos de novo sozinhos" — a ação
 * vira a de quem ficou de fora. `explicacao` troca a do catálogo pela frase
 * gravada no momento da falha, quando ela diz mais (as tentativas que fizemos).
 */
export function erroParaTela(
  erro: ErroMetaTraduzido,
  opcoes: { definitivo?: boolean; explicacao?: string | null; semCodigo?: boolean } = {},
): ErroParaTela {
  const passageiroQueDesistiu = opcoes.definitivo && erro.alcance === 'passageiro';
  return {
    codigo: opcoes.semCodigo ? null : erro.codigo,
    titulo: erro.titulo,
    explicacao: opcoes.explicacao?.trim() || erro.explicacao,
    acao: passageiroQueDesistiu ? ACAO_SEM_NOVA_TENTATIVA : erro.acao,
    quem: passageiroQueDesistiu ? 'ninguem' : erro.quem,
    tela: erro.tela ?? null,
    link: erro.link ?? null,
    daMeta: erro.daMeta ?? null,
  };
}

/** O que houve e o que fazer, numa frase só — para aviso, erro de formulário e app antigo. */
export function frasesDoErro(erro: Pick<ErroParaTela, 'explicacao' | 'acao'>): string {
  return [erro.explicacao, erro.acao].filter(Boolean).join(' ');
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

/** Mensagem crua da Meta, para o log, para o botão do erro e para código não mapeado. */
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
