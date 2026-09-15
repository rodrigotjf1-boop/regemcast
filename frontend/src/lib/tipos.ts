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

/** `POST /whatsapp/conectar` */
export interface ResultadoConexao {
  wabaId: string;
  phoneNumberId: string;
  telefone: string | null;
  nome: string | null;
  registrado: boolean;
  /** O número segue também no app do celular. */
  coexistencia: boolean;
  /** O que ainda falta o cliente fazer, já em pt-BR. */
  pendencias: string[];
}
