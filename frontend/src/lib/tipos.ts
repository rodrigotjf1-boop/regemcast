/**
 * Formatos que a API devolve. Espelho tipado do backend — sem `any`.
 *
 * REGRA: só entra aqui campo que o servidor realmente manda. Campo inventado
 * não quebra o build, mas nunca chega preenchido — e o texto da interface que
 * depende dele simplesmente não aparece, sem erro nenhum para investigar.
 * Cada bloco abaixo diz de qual rota e de qual tipo do backend ele é espelho.
 */

export type Papel = 'dono' | 'operador';
export type StatusUsuario = 'ativo' | 'suspenso';
export type StatusConta = 'aprovada' | 'ativa' | 'suspensa' | 'cancelada';
export type StatusAssinatura = 'cortesia' | 'ativa' | 'inadimplente' | 'cancelada';

/** `UsuarioSessao` do backend (GET /auth/eu, POST /auth/login). */
export interface UsuarioSessao {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
}

/** `ContaSessao` do backend: o recorte da conta que vem junto da sessão. */
export interface ContaSessao {
  id: string;
  nome: string;
  timezone: string;
  status: StatusConta;
}

/** `RespostaEu` do backend. Conta e usuário vêm sempre — nunca nulos. */
export interface Sessao {
  usuario: UsuarioSessao;
  conta: ContaSessao;
}

/**
 * `RespostaSessao`: o que login e aceite de convite devolvem.
 *
 * Não existe `token` aqui porque o servidor não manda um: a sessão viaja só no
 * cookie httpOnly que a própria API grava, e o JavaScript da página nunca vê a
 * credencial.
 */
export interface SessaoCriada extends Sessao {
  /** Quando esta sessão expira, em ISO 8601. */
  expiraEm: string;
}

/** `ContaDados` do backend (GET /conta e resposta do PATCH /conta). */
export interface Conta {
  id: string;
  nome: string;
  cnpj: string | null;
  timezone: string;
  status: StatusConta;
}

/** `PlanoResumo`: catálogo da distribuição, só a parte que o cliente vê. */
export interface Plano {
  codigo: string;
  nome: string;
  disparosMes: number;
}

/** `AssinaturaResumo`: é aqui que mora o ciclo, não no uso. */
export interface Assinatura {
  status: StatusAssinatura;
  cicloInicio: string;
  cicloFim: string;
  gratisAte: string | null;
}

/** `UsoResumo`: consumo do ciclo corrente. Sem plano definido, não há teto. */
export interface UsoCiclo {
  disparos: number;
  teto: number | null;
  restantes: number | null;
}

/** `ContaResumo` (GET /conta). Painel e tela de conta compartilham. */
export interface ResumoConta {
  conta: Conta;
  plano: Plano | null;
  assinatura: Assinatura | null;
  uso: UsoCiclo;
  /** Algum número guarda conversas (coexistência com "sim"): mostra o menu Conversas. */
  conversasHabilitadas: boolean;
}

// ------------------------------------------------------------------ conversas

/** `GET /conversas` — uma conversa na lista. */
export interface ConversaResumo {
  id: string;
  telefone: string;
  /** Nome do contato na base; sem ele, o do perfil no WhatsApp. */
  nome: string | null;
  contatoId: string | null;
  /** Pediu para sair das promoções — ainda pode receber resposta. */
  optOut: boolean;
  naoLidas: number;
  ultimaMensagem: string | null;
  ultimaMensagemEm: string | null;
  /** Até quando dá para responder com texto livre. `null` = janela fechada. */
  janelaAteEm: string | null;
  /** O número da empresa desta conversa. */
  numero: string | null;
}

/** `GET /conversas/:id/mensagens` — uma mensagem. */
export interface MensagemDaConversa {
  id: string;
  direcao: 'entrada' | 'saida';
  /** cliente | celular | painel | historico | campanha */
  origem: string;
  tipo: string;
  texto: string | null;
  temMidia: boolean;
  midiaMime: string | null;
  midiaNome: string | null;
  /** Só saída: enviando | enviada | entregue | lida | falhou */
  status: string | null;
  erroCodigo: number | null;
  erroTitulo: string | null;
  /** Quem respondeu pelo painel. */
  enviadaPor: string | null;
  criadaEm: string;
}

/** `UsuarioResumo` (GET /conta/usuarios). */
export interface UsuarioDaConta {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  status: StatusUsuario;
  ultimoLoginEm: string | null;
  criadoEm: string;
}

/**
 * `PreviaConvite` (GET /auth/convite/:token).
 *
 * Não existe `expiraEm` na resposta: o convite ou está valendo — e a prévia
 * responde — ou já venceu, e a rota devolve 404 com o motivo em pt-BR.
 */
export interface ConvitePendente {
  email: string;
  nome: string;
  empresa: string | null;
}

// --------------------------------------------------------------- WhatsApp

/** `GET /whatsapp/config` — o que o Embedded Signup precisa. Nada aqui é segredo. */
export interface ConfigSignup {
  appId: string;
  configId: string;
  graphVersao: string;
  /**
   * O que o dono declara ao trazer a agenda do WhatsApp Business. Vem do
   * servidor para a tela mostrar exatamente o texto que a auditoria grava.
   */
  declaracaoIntegracao: string;
}

export type QualidadeNumero = 'verde' | 'amarela' | 'vermelha' | 'desconhecida';
export type StatusNumero = 'pendente' | 'registrado' | 'suspenso' | 'removido';

/**
 * Estado da cópia dos dados do app do celular (coexistência).
 *
 * `nao_se_aplica` é o caso do número dedicado — não há app de onde copiar.
 */
export type SincronizacaoNumero =
  | 'nao_se_aplica'
  | 'pendente'
  | 'sincronizando'
  | 'concluida'
  | 'expirada'
  | 'falhou';

export interface NumeroWhatsapp {
  phoneNumberId: string;
  telefone: string | null;
  nome: string | null;
  qualidade: QualidadeNumero;
  /** Teto de usuários únicos por 24h. `null` = ilimitado. Ausente = a Meta não disse. */
  tierLimite: number | null;
  tierNome: string | null;
  status: StatusNumero;
  /** O número também segue no app WhatsApp Business do celular. */
  coexistencia: boolean;
  sincronizacao: SincronizacaoNumero;
  sincronizacaoEm: string | null;
  onboardadoEm: string | null;
  /**
   * Horas que faltam para o prazo de 24h da Meta. `null` = não há prazo
   * correndo. O servidor calcula para a tela não precisar conhecer a regra.
   */
  horasParaSincronizar: number | null;
  /** Teto de mensagens por segundo: 20 na coexistência, 80 no número dedicado. */
  vazaoMaxima: number;
  /**
   * Coexistência: trazer os contatos e as conversas do WhatsApp Business?
   * `null` = o dono ainda não respondeu (o que chega fica esperando).
   */
  integrarConversas: boolean | null;
  integrarDecididoEm: string | null;
}

export interface ContaWhatsapp {
  wabaId: string;
  nome: string | null;
  moeda: string | null;
  statusRevisao: string | null;
  conectadaEm: string | null;
  webhookAssinadoEm: string | null;
  /** Quando a autorização do cliente vence. Nulo = a Meta não informou prazo. */
  tokenExpiraEm: string | null;
}

/** `GET /whatsapp/situacao` */
export type SituacaoWhatsapp =
  | { conectado: false }
  | { conectado: true; conta: ContaWhatsapp; numeros: NumeroWhatsapp[] };

/**
 * `GET /campanhas` e `GET /campanhas/:id`
 *
 * `porStatus` é contado no banco a cada leitura, não guardado. Contador
 * denormalizado precisa ser mantido no envio E no webhook, e o dia em que um
 * dos dois falha o número na tela mente sem ninguém perceber.
 */
export interface ResumoCampanha {
  id: string;
  nome: string;
  modeloNome: string;
  modeloIdioma: string;
  status: string;
  /** Por que pausou: conexão com a Meta caiu, ou acabaram os disparos do plano. */
  pausaMotivo: 'conexao' | 'teto_plano' | 'inadimplencia' | 'manual' | null;
  criadoEm: string;
  iniciadaEm: string | null;
  concluidaEm: string | null;
  porStatus: Record<string, number>;
  total: number;
  /** Lista de contatos de onde saiu o público; nulo quando os números foram digitados. */
  listaNome: string | null;
  /** O que a tela de edição usa para reabrir a campanha como ela está. */
  modeloId: string | null;
  listaId: string | null;
  janelaDias: number[];
  /** 'HH:MM:SS' no fuso da conta. */
  janelaInicio: string | null;
  janelaFim: string | null;
  pausaSegundos: number;
  maxPorDia: number | null;
  maxPorSemana: number | null;
  maxPorMes: number | null;
}

/** O que dá para mudar numa campanha já montada. A tela manda só o que mexeu. */
export type EditarCampanha = Partial<
  Omit<NovaCampanha, 'janelaInicio' | 'janelaFim' | 'maxPorDia' | 'maxPorSemana' | 'maxPorMes'>
> & {
  /** `null` tira o horário/limite; ausente deixa como está. */
  janelaInicio?: string | null;
  janelaFim?: string | null;
  maxPorDia?: number | null;
  maxPorSemana?: number | null;
  maxPorMes?: number | null;
};

/** O que `DELETE /campanhas/:id` fez de fato. */
export interface ResultadoExclusaoCampanha {
  resultado: 'apagada' | 'cancelada' | 'arquivada';
}

/**
 * `GET /campanhas/:id/destinatarios`
 *
 * `enviada` e `entregue` são estados diferentes: o primeiro diz que a Meta
 * aceitou, o segundo que chegou ao aparelho. Confundir os dois é o defeito que
 * faz uma campanha marcar 100% de sucesso com 100% de falha.
 */
export interface DestinatarioCampanha {
  id: string;
  telefone: string;
  status: string;
  erroTitulo: string | null;
  erroDetalhe: string | null;
  enviadaEm: string | null;
  entregueEm: string | null;
  lidaEm: string | null;
  falhouEm: string | null;
}

/** Corpo de `POST /campanhas`. */
/** De onde sai o valor de uma variável numa campanha por lista. */
export interface VariavelDeLista {
  origem: 'fixo' | 'nome' | 'primeiro_nome';
  /** O texto (fixo) ou o que usar quando o contato não tem nome. */
  valor: string;
}

export interface NovaCampanha {
  nome: string;
  modeloNome: string;
  modeloIdioma: string;
  modeloId?: string;
  modeloCategoria?: string;
  /** Números digitados (até 500). Use OU isto OU `listaId`. */
  destinatarios?: Array<{ telefone: string; variaveis?: string[] }>;
  /** Lista de contatos que recebe a campanha. */
  listaId?: string;
  /** Variáveis, em ordem, quando o público é uma lista. */
  variaveisLista?: VariavelDeLista[];
  /** 0 = domingo … 6 = sábado. Vazio = qualquer dia. */
  janelaDias?: number[];
  /** HH:MM, no fuso da conta. */
  janelaInicio?: string;
  janelaFim?: string;
  /** Segundos entre uma mensagem e a próxima. */
  pausaSegundos?: number;
  maxPorDia?: number;
  maxPorSemana?: number;
  maxPorMes?: number;
}

/**
 * `GET /whatsapp/modelos`
 *
 * `categoria` e `status` chegam em português, mas como **texto livre**: se a
 * Meta inventar um valor novo, ele aparece cru em vez de sumir. Por isso não
 * são união de literais aqui — seria uma garantia falsa.
 */
export interface ModeloDeMensagem {
  id: string;
  nome: string;
  idioma: string;
  categoria: string;
  status: string;
  /** Por que a Meta recusou. `null` quando não recusou. */
  motivo: string | null;
  cabecalho: string | null;
  corpo: string;
  rodape: string | null;
  /** Quantas variáveis o corpo espera — o maior `{{n}}`, não as ocorrências. */
  variaveis: number;
  botoes: string[];
}

/** `POST /whatsapp/conectar` */
export interface ResultadoConexao {
  wabaId: string;
  phoneNumberId: string;
  telefone: string | null;
  nome: string | null;
  registrado: boolean;
  /** O número segue também no app do celular. */
  coexistencia: boolean;
  /** A resposta gravada sobre contatos e conversas. `null` = sem resposta ou número dedicado. */
  integrarConversas: boolean | null;
  /** O que ainda falta o cliente fazer, já em pt-BR. */
  pendencias: string[];
}

// ------------------------------------------------------------------ contatos

/** Um contato da base, como a tela lista. */
export interface Contato {
  id: string;
  nome: string | null;
  telefone: string;
  /** `true` quando a pessoa pediu para sair. Ela não recebe mais nada. */
  optOut: boolean;
  consentimentoOrigem: string | null;
  consentimentoEm: string | null;
  criadoEm: string;
  /** Do sistema da loja (planilha ou Cardápio Web), quando veio. */
  email?: string | null;
  dataNascimento?: string | null;
  pedidos?: number | null;
  totalGastoCentavos?: number | null;
  ultimoPedidoEm?: string | null;
  segmento?: Segmento;
  /** Quando e como a pessoa saiu (quando saiu). */
  optOutEm?: string | null;
  optOutOrigem?: string | null;
}

/** Perfis da base, calculados da última compra e dos pedidos. */
export type Segmento =
  | 'campeoes'
  | 'novos'
  | 'promissores'
  | 'fieis'
  | 'atencao'
  | 'nao_posso_perder'
  | 'em_risco'
  | 'perdidos'
  | 'sem_historico';

export interface ParametrosSegmentacao {
  recenteDias: number;
  ativoDias: number;
  riscoDias: number;
  fielPedidos: number;
}

/** `GET /contatos/segmentos` */
export interface ResumoSegmentos {
  parametros: ParametrosSegmentacao;
  segmentos: { id: Segmento; nome: string; regra: string; total: number }[];
}

/** `GET /contatos` */
export interface PaginaDeContatos {
  total: number;
  pagina: number;
  porPagina: number;
  itens: Contato[];
}

/** Um público. É o que a campanha vai escolher. */
export interface ListaDeContatos {
  id: string;
  nome: string;
  descricao: string | null;
  total: number;
  criadoEm: string;
}

/** Uma linha da prévia: já normalizada, ainda não gravada. */
export interface ContatoDaPrevia {
  nome: string;
  telefone: string;
  /** `false` quando este número já está na base. */
  novo: boolean;
  /** `true` quando faltava o código do país e nós acrescentamos. */
  assumiuPais: boolean;
  /** O que a planilha trouxe além de nome e telefone, quando trouxe. */
  email?: string;
  dataNascimento?: string;
  pedidos?: number;
  totalGastoCentavos?: number;
  ultimoPedidoEm?: string;
}

/** `POST /contatos/importacao/arquivo` e `/texto` — nada foi gravado ainda. */
export interface PreviaDaImportacao {
  totalLidos: number;
  validos: number;
  invalidos: number;
  novos: number;
  jaExistem: number;
  /** Quantos tiveram o código do país acrescentado por nós. */
  assumiramPais: number;
  /** Teto do arquivo. */
  limite: number;
  /** Quantos cabem por envio: a tela grava em blocos deste tamanho. */
  porEnvio?: number;
  truncado: boolean;
  /** Colunas extras encontradas: "e-mail", "aniversário", "pedidos", "total gasto", "última compra". */
  extras?: string[];
  contatos: ContatoDaPrevia[];
  formato: 'vcard' | 'csv' | 'xlsx' | 'texto';
  arquivoNome?: string;
}

/** `POST /contatos/importacao` */
export interface ConfirmacaoDaImportacao {
  formato: 'vcard' | 'csv' | 'xlsx' | 'texto';
  arquivoNome?: string;
  listaId?: string;
  /** A empresa declara que estes contatos autorizaram. Sem isso, nada entra. */
  consentimento: boolean;
  evidencia?: string;
  /** Bloco seguinte de um arquivo grande: soma neste registro em vez de criar outro. */
  importacaoId?: string;
  contatos: {
    telefone: string;
    nome?: string;
    email?: string;
    dataNascimento?: string;
    pedidos?: number;
    totalGastoCentavos?: number;
    ultimoPedidoEm?: string;
  }[];
}

// ------------------------------------------------------------------ modelos

export type TipoModelo = 'simples' | 'carrossel';
export type CategoriaModelo = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
export type FormatoCabecalho = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
export type TipoBotao = 'URL' | 'PHONE_NUMBER' | 'QUICK_REPLY' | 'COPY_CODE';

export interface BotaoDoModelo {
  tipo: TipoBotao;
  texto: string;
  url?: string;
  telefone?: string;
}

/** Um cartão do carrossel. */
export interface CartaoDoModelo {
  imagem?: string;
  corpo: string;
  botoes?: BotaoDoModelo[];
}

/** O modelo como o cliente escreve — o corpo de `POST /modelos`. */
export interface DadosModelo {
  /** `simples` ou `carrossel`. Carrossel não tem cabeçalho, rodapé nem oferta. */
  tipo?: TipoModelo;
  cartoes?: CartaoDoModelo[];
  nome: string;
  idioma?: string;
  categoria?: CategoriaModelo;
  cabecalhoFormato?: FormatoCabecalho;
  cabecalhoTexto?: string;
  cabecalhoExemplo?: string;
  cabecalhoMidia?: string;
  corpo: string;
  corpoExemplos?: string[];
  rodape?: string;
  botoes?: BotaoDoModelo[];
  ltoAtivo?: boolean;
  ltoTexto?: string;
}

/** Um problema encontrado pelas regras da Meta, já em português. */
export interface ProblemaNoModelo {
  campo: 'nome' | 'categoria' | 'cabecalho' | 'corpo' | 'rodape' | 'botoes' | 'lto' | 'cartoes';
  mensagem: string;
}

/** `GET /modelos` — o que está gravado aqui, incluindo rascunho. */
export interface ModeloSalvo {
  id: string;
  /** Id na Meta. Preenchido = editar e excluir chegam até ela. */
  metaTemplateId?: string | null;
  /** Quando a Meta aceitou a última edição (ela aceita 1 por dia em aprovado). */
  editadoMetaEm?: string | null;
  tipo: TipoModelo;
  nome: string;
  idioma: string;
  categoria: string;
  /** A categoria que a Meta devolveu, quando reclassificou. */
  categoriaMeta: string | null;
  status: string;
  /** Por que a Meta recusou. Ela diz uma vez só. */
  motivo: string | null;
  corpo: string;
  cabecalhoFormato: FormatoCabecalho | null;
  cabecalhoTexto: string | null;
  cabecalhoExemplo: string | null;
  cabecalhoMidia: string | null;
  corpoExemplos: string[];
  rodape: string | null;
  botoes: BotaoDoModelo[];
  cartoes: CartaoDoModelo[];
  ltoAtivo: boolean;
  ltoTexto: string | null;
  variaveis: number;
  criadoEm: string;
}

// --------------------------------------------------------------- segurança

/** Login de quem tem verificação em duas etapas: ainda sem sessão. */
export interface EtapaCodigoLogin {
  etapa: 'codigo';
  metodo: 'email' | 'app';
  emailMascarado: string;
}

/** `POST /auth/convite/cnpj` — o que a Receita disse sobre o CNPJ. */
export interface CnpjDoConvite {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  /** Como a Receita escreve: ATIVA, BAIXADA, SUSPENSA, INAPTA, NULA. */
  situacao: string;
  ativa: boolean;
  /** Já existe conta com este CNPJ. */
  jaCadastrado: boolean;
}

export type DoisFatores = 'nenhum' | 'email' | 'app';

/** `GET /auth/seguranca` */
export interface SituacaoSeguranca {
  doisFatores: DoisFatores;
  emailVerificado: boolean;
  /** O servidor tem a chave do app autenticador configurada. */
  appDisponivel: boolean;
}

// ----------------------------------------------------------------- cobrança

export interface PlanoOferta {
  id: string;
  codigo: string;
  nome: string;
  disparosMes: number;
  precoCentavos: number;
}

export interface CobrancaDoCliente {
  id: string;
  valorCentavos: number;
  /** pendente | aprovada | recusada | cancelada | estornada */
  status: string;
  meio: string | null;
  vencimento: string | null;
  pagoEm: string | null;
  motivo: string | null;
  plano: string | null;
  criadoEm: string;
}

/** `GET /plano` */
export interface SituacaoCobranca {
  /** cortesia | ativa | inadimplente | cancelada */
  status: string;
  gratisAte: string | null;
  cicloInicio: string;
  cicloFim: string;
  inadimplenteDesde: string | null;
  disparosParamEm: string | null;
  bloqueado: boolean;
  carenciaDias: number;
  planoAtual: PlanoOferta | null;
  planoProximoCiclo: PlanoOferta | null;
  mpStatus: string | null;
  checkoutPendente: { url: string; plano: PlanoOferta | null } | null;
  cobrancaDisponivel: boolean;
  /** Renovação cancelada com o mês pago: contratar de novo só a partir desta data. */
  recontratarEm: string | null;
  uso: { disparos: number; teto: number | null };
  planos: PlanoOferta[];
  cobrancas: CobrancaDoCliente[];
}

export type ResultadoContratacao =
  | { modo: 'checkout'; checkoutUrl: string }
  | { modo: 'trocado'; plano: string }
  | { modo: 'agendado'; plano: string; vigenteEm: string }
  | { modo: 'mantido'; plano: string };

// ------------------------------------------------------------ Cardápio Web

/** `GET /integracoes/cardapioweb` — nunca traz a credencial. */
export interface SituacaoCardapioWeb {
  conectado: boolean;
  modo: 'chave' | 'oauth' | null;
  lojaNome: string | null;
  sincronizacao: {
    status: 'parada' | 'rodando' | 'concluida' | 'falhou';
    pagina: number;
    totalPaginas: number | null;
    lidos: number;
    novos: number;
    bloqueados: number;
    invalidos: number;
    iniciadaEm: string | null;
    concluidaEm: string | null;
    erro: string | null;
    listaId: string | null;
  };
}
