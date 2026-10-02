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
  /** Descanso entre campanhas de marketing, em dias; 0 = desligado. Ausente numa API anterior. */
  descansoMarketingDias?: number;
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
  /**
   * A conta está ligada ao Regem: não paga e não tem teto do plano enquanto a
   * integração estiver ativa. Ausente só numa API mais antiga que a tela.
   */
  gratisPeloRegem?: boolean;
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
  /**
   * A página de pagamento desta conta na Meta (cartão, moeda, fuso). A Meta
   * cobra as mensagens direto da conta do WhatsApp do cliente. Nulo enquanto o
   * servidor não souber montar o endereço.
   */
  pagamentoUrl?: string | null;
}

/** O sinal de três estados da saúde — mais "ainda não conferimos com a Meta". */
export type SinalDeEnvio = 'pode_enviar' | 'com_restricao' | 'bloqueado' | 'desconhecido';

/** Um item da saúde da conta: a conta, a empresa, o aplicativo, cada número, o pagamento e a conexão. */
export interface ItemDaSaude {
  /** `conta`, `empresa`, `aplicativo`, `numero:<id>`, `pagamento` ou `conexao`. */
  chave: string;
  rotulo: string;
  sinal: SinalDeEnvio;
  /** O estado, numa linha. */
  resumo: string;
  /** O que impede ou limita, cada um com o que fazer. Vazio quando está tudo certo. */
  problemas: ErroQueGuia[];
}

/**
 * `GET /whatsapp/saude` — "posso enviar agora e, se não, o que eu resolvo?".
 * O servidor monta a partir do `health_status` da Meta; a tela só mostra.
 */
export interface SaudeDaConta {
  sinal: SinalDeEnvio;
  titulo: string;
  resumo: string;
  /** Quando a Meta foi consultada. Nulo = nunca. */
  lidaEm: string | null;
  itens: ItemDaSaude[];
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
  /**
   * Por que pausou: a conexão com a Meta caiu, acabaram os disparos do plano,
   * falta pagamento do plano, o dono pausou, a Meta recusou o modelo (`modelo`)
   * ou recusou por um problema da conta do WhatsApp na Meta (`conta_meta`:
   * pagamento, restrição, registro do número).
   */
  pausaMotivo: 'conexao' | 'teto_plano' | 'inadimplencia' | 'manual' | 'modelo' | 'conta_meta' | null;
  /** O erro da Meta que pausou a campanha, quando a pausa nasceu de um. */
  pausaErro?: ErroQueGuia | null;
  /** Por que as mensagens falharam, do motivo mais comum para o menos. Só em `GET /campanhas/:id`. */
  falhasPorMotivo?: Array<{ total: number; erro: ErroQueGuia }>;
  /** Quanto a campanha custa na Meta. Só em `GET /campanhas/:id`. */
  custo?: CustoNaMeta | null;
  /** De onde sai a variável do título do modelo; nulo quando o modelo não tem. */
  variavelCabecalho?: { origem: VariavelDeLista['origem']; valor: string } | null;
  criadoEm: string;
  iniciadaEm: string | null;
  concluidaEm: string | null;
  porStatus: Record<string, number>;
  total: number;
  /** Lista de contatos de onde saiu o público; nulo quando os números foram digitados. */
  listaNome: string | null;
  /** A categoria do modelo, traduzida (marketing, utilidade, autenticação). */
  modeloCategoria?: string | null;
  /** De onde saiu o público e o nome dele no cartão ("Toda a base", "Pedem à noite"…). */
  publicoOrigem?: OrigemDaCampanha | null;
  publicoRotulo?: string | null;
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
  /**
   * Campanha ativa que está esperando, e até quando. Não é pausa: ela continua
   * sozinha. `limite_meta` — a conta já alcançou as pessoas que a Meta permite
   * em 24 h; `ritmo` — a Meta pediu para desacelerar.
   */
  espera: { motivo: 'limite_meta' | 'ritmo'; ate: string | null; limite: number | null } | null;
  /** Quantas pessoas responderam à mensagem. Ausente numa API anterior. */
  respondidas?: number;
  /** O descanso desta campanha, em dias; nulo = sem descanso. */
  descansoDias?: number | null;
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
 * Um erro da Meta do jeito que a tela mostra: o que houve, o que fazer, quem
 * resolve e por onde. O servidor monta a partir do código — a tela não traduz.
 */
export interface ErroQueGuia {
  /** O código da Meta; nulo quando a falha é nossa (rede, valor que faltou). */
  codigo: number | null;
  titulo: string;
  explicacao: string;
  acao: string | null;
  quem: 'voce' | 'nos' | 'ninguem' | null;
  /** A tela do Regemcast onde se resolve. */
  tela: 'whatsapp' | 'modelos' | 'contatos' | 'bloqueios' | null;
  /** O endereço que a própria Meta mandou para resolver (pagamento, termos). */
  link: { rotulo: string; url: string } | null;
  /** A frase da Meta, crua. */
  daMeta: string | null;
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
  /** A falha, com o que fazer. Nulo em quem não falhou. */
  erro?: ErroQueGuia | null;
  enviadaEm: string | null;
  entregueEm: string | null;
  lidaEm: string | null;
  falhouEm: string | null;
}

/** Corpo de `POST /campanhas`. */
/** De onde sai o valor de uma variável numa campanha por lista. */
export interface VariavelDeLista {
  /**
   * `cashback_saldo` e `cashback_validade` vêm do Cardápio Web: a campanha que
   * usa uma delas só vai para quem tem cashback válido.
   */
  origem: 'fixo' | 'nome' | 'primeiro_nome' | 'cashback_saldo' | 'cashback_validade';
  /** O texto (fixo) ou o que usar quando o contato não tem o dado (nome, data de vencimento). */
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
  /** Um público da base (toda a base, importação, perfil, público pronto), em vez de lista. Use UM dos três. */
  daBase?: PublicoDaCampanha;
  /** Variáveis, em ordem, quando o público sai da base (lista ou público da base). */
  variaveisLista?: VariavelDeLista[];
  /** A variável do título, quando o modelo tem uma. */
  variavelCabecalho?: VariavelDeLista;
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
  /** Só o dono: enviar mesmo para quem está em descanso. */
  ignorarDescanso?: boolean;
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
  /**
   * O que o modelo pede no envio além das variáveis do texto. A mídia, o cupom
   * e a validade da oferta saem do próprio modelo; a variável do título é
   * preenchida na campanha.
   */
  exige?: {
    cabecalho: 'image' | 'video' | 'document' | 'texto' | null;
    oferta: boolean;
    cupomNoBotao: number | null;
    cartoes: unknown[];
    /** O que o disparo ainda não sabe mandar; vazio = sabe tudo. */
    semSuporte: string[];
  };
  /**
   * A qualidade que a Meta atribui ao modelo pelo que os destinatários fazem com
   * ele. `desconhecida` = modelo novo, ou a Meta não informou.
   */
  qualidade?: 'verde' | 'amarela' | 'vermelha' | 'desconhecida';
  /** A categoria para a qual a Meta vai mudar o modelo (aviso de 24 horas). */
  categoriaPrevista?: string | null;
  /** A categoria de antes, quando a Meta já mudou o modelo. */
  categoriaAnterior?: string | null;
  /** O que pede atenção neste modelo, em frases prontas do servidor. */
  alertas?: Array<{ tom: 'atencao' | 'erro'; texto: string }>;
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

/** `POST /whatsapp/reconectar` — a autorização de uma conta já conectada, refeita. */
export interface ResultadoReconexao {
  wabaId: string;
  nome: string | null;
  /** Quando a autorização nova vence. Nulo = a Meta não informou prazo. */
  expiraEm: string | null;
  /** O que ficou pendente, já em pt-BR. */
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
  /** A Meta recusou o número (131026) em duas campanhas: fora dos envios até "tentar de novo". */
  semWhatsappEm?: string | null;
  /** Das compras sincronizadas: o bairro mais frequente e o jeito de comprar. */
  bairro?: string | null;
  tipoPreferido?: 'entrega' | 'retirada' | 'salao' | null;
  /** Das compras: o período do dia em que mais pede (no fuso da conta) e o produto que mais comprou. */
  periodoPreferido?: Periodo | null;
  produtoFavorito?: string | null;
  segmento?: Segmento;
  /** Quando e como a pessoa saiu (quando saiu). */
  optOutEm?: string | null;
  optOutOrigem?: string | null;
  /** O cashback do Cardápio Web: saldo, o dia em que vence (`AAAA-MM-DD`) e se ainda vale hoje. */
  cashbackCentavos?: number | null;
  cashbackVenceEm?: string | null;
  cashbackValido?: boolean;
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
  segmentos: {
    id: Segmento;
    nome: string;
    regra: string;
    total: number;
    /** O "M" do RFM: quanto o perfil gastou e o ticket médio. `null` sem valor gasto (ou numa API anterior). */
    gastoCentavos?: number | null;
    ticketMedioCentavos?: number | null;
  }[];
}

/** Públicos prontos a partir das compras (`GET /contatos/publicos`). */
export type Publico =
  | 'vip'
  | 'ticket_alto'
  | 'ticket_medio'
  | 'ticket_baixo'
  | 'um_pedido'
  | 'marco_10'
  | 'entrega'
  | 'retirada'
  | 'salao'
  | 'periodo_cafe'
  | 'periodo_almoco'
  | 'periodo_tarde'
  | 'periodo_noite'
  | 'periodo_madrugada'
  | 'leram_30d'
  | 'responderam_30d'
  | 'nao_leram_3'
  | 'nunca_receberam'
  | 'conversaram_7d'
  | 'cashback'
  | 'cashback_vence_7d'
  | 'bairro'
  | 'aniversario'
  | 'produto';

/** De onde sai o público da campanha (`POST /campanhas/previa` e a montagem). */
export type OrigemDoPublico = 'lista' | 'importacao' | 'base' | 'perfil' | 'regiao' | 'publico';
export type OrigemDaCampanha = OrigemDoPublico | 'numeros';

/** O público escolhido em "Quem recebe": uma lista, ou um público da base. */
export interface PublicoDaCampanha {
  origem: OrigemDoPublico;
  /** A lista ou a importação. */
  origemId?: string;
  segmento?: Segmento;
  uf?: string;
  publico?: Publico;
  publicoValor?: string;
}

/**
 * O custo de uma campanha na Meta, com as frases e os valores prontos do
 * servidor: a estimativa antes de disparar ("até R$ 96,51"), o gasto e o que
 * ainda pode sair depois. Sem linhas e sem avisos, não há o que mostrar.
 */
export interface CustoNaMeta {
  /** A moeda em que a Meta cobra a conta (ISO 4217). Nulo = a Meta ainda não informou. */
  moeda: string | null;
  /** O que a Meta já cobrou, em centavos. Nulo = não dá para calcular. */
  gastoCentavos: number | null;
  /** O teto do que ainda pode ser cobrado, em centavos. Nulo = não dá para calcular. */
  aSairCentavos: number | null;
  linhas: Array<{ rotulo: string; valor: string; detalhe: string | null }>;
  /** O que falta para a conta ficar completa (tarifa, moeda, aviso de cobrança). */
  avisos: string[];
  nota: string | null;
}

/** `POST /campanhas/previa` — quantos podem receber, quantos estão em descanso e em que período pedem. */
export interface PreviaDoPublico {
  total: number;
  descanso: { dias: number; emDescanso: number };
  horario: SugestaoDeHorario;
  /** Com variável de cashback, `total` é só quem tem cashback válido — de quantos do público. */
  cashback?: { doPublico: number } | null;
  /** O custo estimado na Meta, quando o pedido leva a categoria do modelo escolhido. */
  custo?: CustoNaMeta | null;
}

/** `GET /contatos/importacoes` — uma importação e quantos dela ainda podem receber. */
export interface ImportacaoDaBase {
  id: string;
  nome: string;
  formato: string;
  criadoEm: string;
  total: number;
}

/** O período do dia em que o contato mais compra, no fuso da conta. */
export type Periodo = 'cafe' | 'almoco' | 'tarde' | 'noite' | 'madrugada';

/** Um produto da base (`GET /contatos/publicos/produtos`): quantos que podem receber já compraram. */
export interface ProdutoDaBase {
  nome: string;
  total: number;
}

/** `GET /campanhas/horario?listaId=` — em que período a lista pede e a janela sugerida. */
export interface SugestaoDeHorario {
  total: number;
  comHabito: number;
  /** Com menos gente com compra que isso, não há sugestão. */
  minimo: number;
  periodos: { periodo: Periodo; total: number }[];
  sugestao: { periodo: Periodo; percentual: number; inicio: string; fim: string } | null;
}

/** Um público escolhido: `valor` é o bairro, o mês (1 a 12) ou o produto, quando o público pede. */
export interface AlvoDePublico {
  publico: Publico;
  valor?: string | null;
  /** O que a tela mostra: "VIP", "Bairro Tijuca", "Aniversariantes de outubro"… */
  nome: string;
  total: number;
}

export interface ResumoPublicos {
  limites: {
    vipCentavos: number | null;
    ticketBaixoAteCentavos: number | null;
    ticketAltoAcimaCentavos: number | null;
    ativoDias: number;
  };
  comValor: number;
  comCompras: number;
  comNascimento: number;
  publicos: {
    id: Exclude<Publico, 'bairro' | 'aniversario' | 'produto'>;
    nome: string;
    regra: string;
    total: number;
    gastoCentavos: number;
  }[];
  bairros: { bairro: string; total: number }[];
  /** Com as conversas ligadas, "Conversaram na última semana" faz sentido. */
  conversasLigadas?: boolean;
  /** O mês de hoje no fuso da conta (1 a 12). */
  mesAtual: number;
  aniversarios: { mes: number; total: number }[];
}

/** `GET /contatos` */
export interface PaginaDeContatos {
  total: number;
  pagina: number;
  porPagina: number;
  /** A conta tem saldo de cashback lido do Cardápio Web: a coluna aparece. */
  cashbackLido?: boolean;
  itens: Contato[];
}

/** Um público. É o que a campanha vai escolher. */
export interface ListaDeContatos {
  id: string;
  nome: string;
  descricao: string | null;
  total: number;
  criadoEm: string;
  /** Quando a lista é um bloco: a divisão, a posição e quantos blocos a divisão tem. */
  divisaoId: string | null;
  bloco: number | null;
  divisaoNome: string | null;
  blocos: number | null;
  /** Última vez que uma campanha usou esta lista. */
  usadaEm: string | null;
}

/** `GET /contatos/divisoes/opcoes` — os tamanhos liberados pelo limite da Meta. */
export interface OpcoesDeBloco {
  limite: number | null;
  limiteConhecido: boolean;
  maximo: number;
  tamanhos: { valor: number; disponivel: boolean }[];
  sugerido: number;
}

export type OrigemDaDivisao = 'lista' | 'importacao' | 'base' | 'perfil' | 'regiao' | 'publico';
export type OrdemDosBlocos = 'importacao' | 'sorteio' | 'recentes' | 'regiao' | 'valor';

/** `POST /contatos/divisoes` */
export interface PedidoDeDivisao {
  origem: OrigemDaDivisao;
  origemId?: string;
  segmento?: Segmento;
  uf?: string;
  publico?: Publico;
  /** O bairro ou o mês, quando o público pede. */
  publicoValor?: string;
  tamanho: number;
  ordem: OrdemDosBlocos;
  soNuncaReceberam?: boolean;
  nome?: string;
}

/** O que aconteceu com um bloco numa campanha — o que deixa aquecer uma lista fria. */
export interface UsoDoBloco {
  campanhaId: string;
  campanhaNome: string;
  status: string;
  em: string;
  total: number;
  enviadas: number;
  entregues: number;
  lidas: number;
  falhas: number;
  /** Do bloco, quem pediu para sair depois que a campanha começou. */
  sairam: number;
}

export interface BlocoDaDivisao {
  id: string;
  bloco: number;
  nome: string;
  /** Quem ainda pode receber. */
  total: number;
  usos: UsoDoBloco[];
}

/** `GET /contatos/divisoes` */
export interface DivisaoDeBlocos {
  id: string;
  nome: string;
  origem: OrigemDaDivisao;
  origemRotulo: string | null;
  tamanho: number;
  ordem: OrdemDosBlocos;
  soNuncaReceberam: boolean;
  totalContatos: number;
  totalBlocos: number;
  criadaEm: string;
  blocos: BlocoDaDivisao[];
}

/** `GET /contatos/regioes` — contatos por estado e DDD, só quem pode receber. */
export interface RegioesDaBase {
  regioes: { uf: string; estado: string; total: number; ddds: { ddd: string; cidade: string; total: number }[] }[];
  semRegiao: number;
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
  /** Por quantas horas a oferta vale depois de enviada (1 a 720). Ausente = 3. */
  ltoHoras?: number;
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
  /** Validade da oferta em horas depois do envio; nulo = 3 (o padrão). */
  ltoHoras?: number | null;
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
  /** Ligada ao Regem: não paga e não tem teto do plano. Ausente só numa API mais antiga que a tela. */
  gratisPeloRegem?: boolean;
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
  /**
   * As compras (pedidos) da loja: a carga do histórico e a consulta dos novos.
   * Ausente só numa API mais antiga que a tela (a janela de um deploy).
   */
  pedidos?: {
    status: StatusPedidosCardapioWeb;
    /** Carga do histórico: quanto do período já foi (0 a 100). */
    progresso: number;
    cargaDe: string | null;
    cargaAte: string | null;
    lidos: number;
    ignorados: number;
    ultimaConsulta: string | null;
    /** Com a busca em andamento, é um soluço que se resolve sozinho; parada, é o motivo. */
    erro: string | null;
    /** O que já está guardado. */
    compras: number;
    clientes: number;
    primeira: string | null;
    ultima: string | null;
  };
  /**
   * O cashback dos clientes e a leitura diária (4h, no fuso da conta).
   * Ausente só numa API mais antiga que a tela (a janela de um deploy).
   */
  saldos?: {
    comCashback: number;
    /** Vence de hoje até daqui a 7 dias. */
    vencendo: number;
    /** Soma do cashback que vale hoje. */
    totalCentavos: number;
    lendo: boolean;
    ultimaLeitura: string | null;
    proximaLeitura: string | null;
    erro: string | null;
  };
}

export type StatusPedidosCardapioWeb = 'parado' | 'carga' | 'em_dia' | 'falhou';
export type PedidosCardapioWeb = NonNullable<SituacaoCardapioWeb['pedidos']>;

/** A leitura dos clientes ou das vendas do Regem: parada, completa (carga), em dia ou parada por falha. */
export type StatusRegem = 'parado' | 'carga' | 'em_dia' | 'falhou';

/**
 * A conta ligada à empresa no Regem (`GET /integracoes/regem`). Quem liga é a
 * equipe do Regemcast, pelo console: a loja não copia nada.
 */
export interface SituacaoRegem {
  ligado: boolean;
  empresaNome: string | null;
  lojas: { id: string; nome: string }[];
  ligadaEm: string | null;
  /** O Regem já entrega os clientes e as vendas da 99 para esta conta. */
  escopo99: boolean;
  /** O dono autorizou usar os clientes da 99, sob a responsabilidade da empresa. */
  incluir99: boolean;
  autorizacao99Em: string | null;
  /** O texto que o dono aceita para autorizar a 99 — o mesmo que fica gravado. */
  textoAutorizacao99: string;
  consentimentoEm: string | null;
  listaId: string | null;
  /** A loja também liga o Cardápio Web direto: as vendas dele que vêm pelo Regem ficam de fora. */
  cardapioWebDireto: boolean;
  /** Desligou a integração, a gratuidade acaba: sem plano pago, os disparos param depois destes dias. */
  carenciaDias?: number;
  clientes: {
    status: StatusRegem;
    lidos: number;
    novos: number;
    bloqueados: number;
    ignorados: number;
    invalidos: number;
    removidos: number;
    ultimaConsulta: string | null;
    erro: string | null;
  };
  pedidos: {
    status: StatusRegem;
    lidos: number;
    gravados: number;
    ignorados: number;
    ultimaConsulta: string | null;
    erro: string | null;
    /** O que já está guardado. */
    compras: number;
    clientes: number;
    primeira: string | null;
    ultima: string | null;
  };
}
