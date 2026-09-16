/**
 * Um lugar só para os caminhos da API.
 *
 * Toda tela chama daqui — nenhuma monta URL na mão. Se o backend renomear uma
 * rota, o conserto é uma linha neste arquivo, e não uma caçada por string
 * solta em sete componentes.
 *
 * Cada função abaixo cita o método e o caminho do controller que ela chama, e o
 * corpo é exatamente o DTO daquela rota. Isso não é preciosismo: o
 * `ValidationPipe` global do backend roda com `forbidNonWhitelisted`, então um
 * campo a mais no corpo não é ignorado — é 400 na cara do usuário.
 */
import { api } from './api';
import type {
  ConfigSignup,
  ConvitePendente,
  ModeloDeMensagem,
  Conta,
  ResumoConta,
  Sessao,
  SessaoCriada,
  StatusUsuario,
  ResultadoConexao,
  SituacaoWhatsapp,
  UsuarioDaConta,
} from './tipos';

/** Nas rotas de autenticação o 401 é resposta de negócio, não sessão vencida. */
const SEM_REDIRECT = { redirecionarNo401: false } as const;

/** Corpo de `POST /auth/login` (LoginDto). */
export interface DadosLogin {
  email: string;
  senha: string;
}

/** Corpo de `POST /lista-espera` (CriarListaEsperaDto). */
export interface DadosListaEspera {
  nome: string;
  email: string;
  empresa?: string;
  telefone?: string;
  origem?: string;
}

/**
 * Corpo de `POST /auth/convite/aceitar` (AceitarConviteDto).
 *
 * O token vai no CORPO, não no caminho — e o nome da empresa é `nomeEmpresa`.
 */
export interface DadosAceiteConvite {
  token: string;
  nome: string;
  senha: string;
  nomeEmpresa: string;
}

/**
 * Corpo de `POST /conta/usuarios` (CriarUsuarioDto).
 *
 * Sem `papel`: a rota cria sempre um operador, e o DTO não declara o campo —
 * mandá-lo é 400 por causa do `forbidNonWhitelisted`.
 */
export interface DadosNovoUsuario {
  nome: string;
  email: string;
  senha: string;
}

export const auth = {
  /** `GET /auth/eu` — quem está logado. 401 aqui significa "ninguém". */
  eu: (sinal?: AbortSignal) => api.get<Sessao>('/auth/eu', { ...SEM_REDIRECT, sinal }),

  /** `POST /auth/login` — grava o cookie de sessão do lado da API. */
  entrar: (dados: DadosLogin) => api.post<SessaoCriada>('/auth/login', dados, SEM_REDIRECT),

  /** `POST /auth/sair` — limpa o cookie e registra a saída na trilha. */
  sair: () => api.post<{ mensagem: string }>('/auth/sair', {}, SEM_REDIRECT),

  /** `GET /auth/convite/:token` — dados para preencher a tela de cadastro. */
  lerConvite: (token: string, sinal?: AbortSignal) =>
    api.get<ConvitePendente>(`/auth/convite/${encodeURIComponent(token)}`, {
      ...SEM_REDIRECT,
      sinal,
    }),

  /** `POST /auth/convite/aceitar` — cria a conta e já devolve a sessão. */
  aceitarConvite: (dados: DadosAceiteConvite) =>
    api.post<SessaoCriada>('/auth/convite/aceitar', dados, SEM_REDIRECT),
};

export const listaEspera = {
  /** `POST /lista-espera` — anônimo e idempotente por e-mail. */
  entrarNaFila: (dados: DadosListaEspera) =>
    api.post<{ mensagem: string }>('/lista-espera', dados, SEM_REDIRECT),
};

export const conta = {
  /** `GET /conta` — conta, plano, assinatura e consumo do ciclo. */
  resumo: (sinal?: AbortSignal) => api.get<ResumoConta>('/conta', { sinal }),

  /** `PATCH /conta` — devolve só a conta atualizada, não o resumo inteiro. */
  atualizar: (dados: { nome?: string; cnpj?: string; timezone?: string }) =>
    api.patch<Conta>('/conta', dados),

  /** `GET /conta/usuarios` — quem tem acesso à conta. */
  usuarios: (sinal?: AbortSignal) => api.get<UsuarioDaConta[]>('/conta/usuarios', { sinal }),

  /** `POST /conta/usuarios` — cria um operador. */
  criarUsuario: (dados: DadosNovoUsuario) => api.post<UsuarioDaConta>('/conta/usuarios', dados),

  /** `PATCH /conta/usuarios/:id` — suspende ou reativa um acesso. */
  mudarStatus: (id: string, status: StatusUsuario) =>
    api.patch<UsuarioDaConta>(`/conta/usuarios/${encodeURIComponent(id)}`, { status }),
};

// --------------------------------------------------------------- WhatsApp

/** Corpo de `POST /whatsapp/conectar` (ConcluirSignupDto). */
export interface DadosConexao {
  code: string;
  wabaId: string;
  /**
   * Opcional porque no fluxo de coexistência a Meta nem sempre devolve o
   * `phone_number_id` no `sessionInfo`. Quando faltar, o servidor descobre o
   * número consultando a WABA — o cliente não digita nada.
   */
  phoneNumberId?: string;
  /** O cliente escolheu manter o WhatsApp Business no celular. */
  coexistencia?: boolean;
}

/** Corpo de `POST /whatsapp/registrar-numero` (RegistrarNumeroDto). */
export interface DadosRegistroNumero {
  phoneNumberId: string;
  /** Só quando o número tem verificação em duas etapas. */
  pin?: string;
}

export const whatsapp = {
  /** `GET /whatsapp/config` */
  config: () => api.get<ConfigSignup>('/whatsapp/config'),

  /** `GET /whatsapp/situacao` */
  situacao: () => api.get<SituacaoWhatsapp>('/whatsapp/situacao'),

  /** `GET /whatsapp/modelos` */
  modelos: () => api.get<ModeloDeMensagem[]>('/whatsapp/modelos'),

  /** `POST /whatsapp/conectar` */
  conectar: (dados: DadosConexao) => api.post<ResultadoConexao>('/whatsapp/conectar', dados),

  /** `POST /whatsapp/registrar-numero` */
  registrarNumero: (dados: DadosRegistroNumero) =>
    api.post<{ registrado: boolean; mensagem: string }>('/whatsapp/registrar-numero', dados),
};
