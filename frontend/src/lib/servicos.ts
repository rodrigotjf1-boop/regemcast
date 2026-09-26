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
import { api, enderecoDaApi } from './api';
import type { SituacaoCardapioWeb, Segmento, ResumoSegmentos, ParametrosSegmentacao,
  AlvoDePublico,
  ProdutoDaBase,
  Publico,
  ResumoPublicos,
  SugestaoDeHorario,
  ResultadoContratacao,
  SituacaoCobranca,
  CnpjDoConvite,
  EtapaCodigoLogin,
  SituacaoSeguranca,
  ConfigSignup,
  ConfirmacaoDaImportacao,
  ConvitePendente,
  ListaDeContatos,
  DivisaoDeBlocos,
  OpcoesDeBloco,
  PedidoDeDivisao,
  RegioesDaBase,
  PaginaDeContatos,
  PreviaDaImportacao,
  DestinatarioCampanha,
  EditarCampanha,
  ResultadoExclusaoCampanha,
  DadosModelo,
  ModeloDeMensagem,
  ModeloSalvo,
  ProblemaNoModelo,
  NovaCampanha,
  ResumoCampanha,
  Conta,
  ConversaResumo,
  MensagemDaConversa,
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
  /** Conferido na Receita: precisa estar ATIVO. */
  cnpj: string;
  /** Código enviado ao e-mail do convite. */
  codigo: string;
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

  /**
   * `POST /auth/login` — grava o cookie de sessão do lado da API.
   *
   * Com verificação em duas etapas ligada, NÃO há sessão ainda: volta
   * `{ etapa: 'codigo' }` e o próximo passo é `confirmarCodigo`.
   */
  entrar: (dados: DadosLogin) =>
    api.post<SessaoCriada | EtapaCodigoLogin>('/auth/login', dados, SEM_REDIRECT),

  /** `POST /auth/login/codigo` — segunda etapa: confere o código e abre a sessão. */
  confirmarCodigo: (codigo: string) =>
    api.post<SessaoCriada>('/auth/login/codigo', { codigo }, SEM_REDIRECT),

  /** `POST /auth/login/reenviar` — novo código por e-mail. */
  reenviarCodigo: () =>
    api.post<{ emailMascarado: string }>('/auth/login/reenviar', {}, SEM_REDIRECT),

  /** `POST /auth/convite/cnpj` — consulta o CNPJ na Receita durante o convite. */
  consultarCnpjConvite: (token: string, cnpj: string) =>
    api.post<CnpjDoConvite>('/auth/convite/cnpj', { token, cnpj }, SEM_REDIRECT),

  /** `POST /auth/convite/codigo` — manda o código para o e-mail do convite. */
  enviarCodigoConvite: (token: string) =>
    api.post<{ emailMascarado: string; minutos: number }>('/auth/convite/codigo', { token }, SEM_REDIRECT),

  /** `POST /auth/senha/esqueci` — resposta sempre igual, exista o e-mail ou não. */
  esqueciSenha: (email: string) =>
    api.post<{ mensagem: string }>('/auth/senha/esqueci', { email }, SEM_REDIRECT),

  /** `POST /auth/senha/redefinir` — cria a senha nova com o código do e-mail. */
  redefinirSenha: (dados: { email: string; codigo: string; senhaNova: string }) =>
    api.post<{ mensagem: string }>('/auth/senha/redefinir', dados, SEM_REDIRECT),

  /** `POST /auth/senha` — troca a própria senha; encerra todas as sessões. */
  trocarSenha: (senhaAtual: string, senhaNova: string) =>
    api.post<{ mensagem: string }>('/auth/senha', { senhaAtual, senhaNova }, SEM_REDIRECT),

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

/** Plano e pagamento da conta (Mercado Pago). */
export const planoConta = {
  situacao: () => api.get<SituacaoCobranca>('/plano'),
  contratar: (planoId: string, emailPagador?: string) =>
    api.post<ResultadoContratacao>('/plano/contratar', emailPagador ? { planoId, emailPagador } : { planoId }),
  cancelar: () => api.post<{ vigenteAte: string | null }>('/plano/cancelar', {}),
};

/** Verificação em duas etapas de quem está logado. */
export const seguranca = {
  situacao: () => api.get<SituacaoSeguranca>('/auth/seguranca'),
  enviarCodigoEmail: () =>
    api.post<{ emailMascarado: string; minutos: number }>('/auth/seguranca/email/codigo', {}),
  ativarEmail: (codigo: string) => api.post<SituacaoSeguranca>('/auth/seguranca/email/ativar', { codigo }),
  iniciarApp: () => api.post<{ endereco: string; segredo: string }>('/auth/seguranca/app/iniciar', {}),
  ativarApp: (codigo: string, senha: string) =>
    api.post<SituacaoSeguranca>('/auth/seguranca/app/ativar', { codigo, senha }),
  desativar: (senha: string) => api.post<SituacaoSeguranca>('/auth/seguranca/desativar', { senha }),
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
  atualizar: (dados: { nome?: string; cnpj?: string; timezone?: string; descansoMarketingDias?: number }) =>
    api.patch<Conta>('/conta', dados),

  /** `GET /conta/usuarios` — quem tem acesso à conta. */
  usuarios: (sinal?: AbortSignal) => api.get<UsuarioDaConta[]>('/conta/usuarios', { sinal }),

  /** `POST /conta/usuarios` — cria um operador. */
  criarUsuario: (dados: DadosNovoUsuario) => api.post<UsuarioDaConta>('/conta/usuarios', dados),

  /** `PATCH /conta/usuarios/:id` — suspende ou reativa um acesso. */
  mudarStatus: (id: string, status: StatusUsuario) =>
    api.patch<UsuarioDaConta>(`/conta/usuarios/${encodeURIComponent(id)}`, { status }),

  /** `DELETE /conta/usuarios/:id` — remove um operador (o dono não pode ser removido). */
  removerUsuario: (id: string) =>
    api.delete<{ mensagem: string }>(`/conta/usuarios/${encodeURIComponent(id)}`),
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
  /** Coexistência: trazer os contatos e as conversas. Ausente = sem resposta. */
  integrar?: boolean;
}

/** Corpo de `POST /whatsapp/registrar-numero` (RegistrarNumeroDto). */
export interface DadosRegistroNumero {
  phoneNumberId: string;
  /** Só quando o número tem verificação em duas etapas. */
  pin?: string;
}

export const campanhas = {
  /** `GET /campanhas` */
  listar: () => api.get<ResumoCampanha[]>('/campanhas'),

  /** `GET /campanhas/descanso?listaId=` — quantos da lista estão em descanso hoje e ficam de fora. */
  previaDoDescanso: (listaId: string) =>
    api.get<{ dias: number; emDescanso: number }>(`/campanhas/descanso?listaId=${encodeURIComponent(listaId)}`),

  /** `GET /campanhas/horario?listaId=` — em que período do dia a lista pede e a janela de envio sugerida. */
  sugestaoDeHorario: (listaId: string) =>
    api.get<SugestaoDeHorario>(`/campanhas/horario?listaId=${encodeURIComponent(listaId)}`),

  /** `GET /campanhas/:id` */
  detalhe: (id: string) => api.get<ResumoCampanha>(`/campanhas/${id}`),

  /** `GET /campanhas/:id/destinatarios` */
  destinatarios: (id: string) =>
    api.get<DestinatarioCampanha[]>(`/campanhas/${id}/destinatarios`),

  /** `POST /campanhas` — monta a campanha, sem enviar nada. */
  criar: (dados: NovaCampanha) => api.post<{ id: string }>('/campanhas', dados),

  /** `PATCH /campanhas/:id` — muda o que a situação da campanha permite. */
  editar: (id: string, dados: EditarCampanha) => api.patch<ResumoCampanha>(`/campanhas/${id}`, dados),

  /** `POST /campanhas/:id/pausar` — pausa por decisão do cliente; só volta no Retomar. */
  pausar: (id: string) => api.post<ResumoCampanha>(`/campanhas/${id}/pausar`, {}),

  /** `DELETE /campanhas/:id` — apaga o rascunho, cancela a que não terminou, arquiva a encerrada. */
  excluir: (id: string) => api.delete<ResultadoExclusaoCampanha>(`/campanhas/${id}`),

  /** `POST /campanhas/:id/disparar` — só funciona uma vez. */
  disparar: (id: string) => api.post<ResumoCampanha>(`/campanhas/${id}/disparar`, {}),

  /** `POST /campanhas/:id/retomar` — volta a enviar uma campanha pausada. */
  retomar: (id: string) => api.post<ResumoCampanha>(`/campanhas/${id}/retomar`, {}),
};

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

  /** `POST /whatsapp/integrar` — só o dono: trazer, ou não, contatos e conversas. */
  integrar: (phoneNumberId: string, integrar: boolean) =>
    api.post<{ phoneNumberId: string; integrarConversas: boolean }>('/whatsapp/integrar', {
      phoneNumberId,
      integrar,
    }),
};

/** Conexão com a loja do Cardápio Web: a base de clientes e as compras. */
export const cardapioWeb = {
  /** `GET /integracoes/cardapioweb` */
  situacao: () => api.get<SituacaoCardapioWeb>('/integracoes/cardapioweb'),

  /** `POST /integracoes/cardapioweb/chave` — confere a chave na loja e guarda cifrada. */
  conectarChave: (chave: string) => api.post<{ lojaNome: string }>('/integracoes/cardapioweb/chave', { chave }),

  /** `POST /integracoes/cardapioweb/importar` — começa a importação em segundo plano. */
  importar: (consentimento: boolean, evidencia?: string) =>
    api.post<SituacaoCardapioWeb>('/integracoes/cardapioweb/importar', { consentimento, evidencia }),

  /**
   * `POST /integracoes/cardapioweb/pedidos` — só o dono: começa a busca do
   * histórico de pedidos ou, com a loja em dia, consulta os novos agora.
   */
  buscarPedidos: () => api.post<SituacaoCardapioWeb>('/integracoes/cardapioweb/pedidos'),

  /** `DELETE /integracoes/cardapioweb` — apaga a credencial; os contatos e as compras ficam. */
  desconectar: () => api.delete<void>('/integracoes/cardapioweb'),
};

export const contatos = {
  /** `GET /contatos` */
  listar: (
    pagina = 1,
    porPagina = 50,
    segmento?: Segmento | null,
    uf?: string | null,
    publico?: Pick<AlvoDePublico, 'publico' | 'valor'> | null,
  ) =>
    api.get<PaginaDeContatos>(
      `/contatos?pagina=${pagina}&porPagina=${porPagina}${segmento ? `&segmento=${segmento}` : ''}${uf ? `&uf=${encodeURIComponent(uf)}` : ''}${
        publico ? `&publico=${publico.publico}${publico.valor ? `&valor=${encodeURIComponent(publico.valor)}` : ''}` : ''
      }`,
    ),

  /** `GET /contatos/publicos` — VIP, ticket, marcos, jeito de comprar, período do dia, bairros e aniversariantes. */
  publicos: () => api.get<ResumoPublicos>('/contatos/publicos'),

  /** `GET /contatos/publicos/produtos` — os produtos que mais gente comprou, ou os que casam com a busca. */
  produtos: (busca?: string) =>
    api.get<{ produtos: ProdutoDaBase[] }>(
      `/contatos/publicos/produtos${busca ? `?busca=${encodeURIComponent(busca)}` : ''}`,
    ),

  /** `POST /contatos/publicos/lista` — foto do público numa lista. */
  criarListaDoPublico: (publico: Publico, valor?: string | null, nome?: string) =>
    api.post<{ id: string; nome: string; total: number }>('/contatos/publicos/lista', {
      publico,
      valor: valor ?? undefined,
      nome,
    }),

  /** `GET /contatos/regioes` — contatos por estado e DDD. */
  regioes: () => api.get<RegioesDaBase>('/contatos/regioes'),

  /** `GET /contatos/divisoes/opcoes` — tamanhos de bloco liberados pelo limite da Meta. */
  opcoesDeBloco: () => api.get<OpcoesDeBloco>('/contatos/divisoes/opcoes'),

  /** `GET /contatos/divisoes` — as divisões em blocos, com o resultado de cada bloco. */
  divisoes: () => api.get<DivisaoDeBlocos[]>('/contatos/divisoes'),

  /** `POST /contatos/divisoes` — cada bloco vira uma lista. */
  dividir: (pedido: PedidoDeDivisao) => api.post<DivisaoDeBlocos>('/contatos/divisoes', pedido),

  /** `DELETE /contatos/divisoes/:id` — só o dono, e só divisão que nenhuma campanha usou. */
  apagarDivisao: (id: string) => api.delete<void>(`/contatos/divisoes/${encodeURIComponent(id)}`),

  /** `GET /contatos?situacao=bloqueados` — quem pediu para sair. */
  bloqueados: (pagina = 1, porPagina = 50) =>
    api.get<PaginaDeContatos>(`/contatos?pagina=${pagina}&porPagina=${porPagina}&situacao=bloqueados`),

  /** `GET /contatos?situacao=sem_whatsapp` — a Meta recusou o número em duas campanhas. */
  semWhatsapp: (pagina = 1, porPagina = 50) =>
    api.get<PaginaDeContatos>(`/contatos?pagina=${pagina}&porPagina=${porPagina}&situacao=sem_whatsapp`),

  /** `POST /contatos/:id/tentar-whatsapp` — volta para os envios; só falhas daqui em diante contam. */
  tentarWhatsappDeNovo: (id: string) => api.post<{ ok: true }>(`/contatos/${id}/tentar-whatsapp`),

  /** `POST /contatos/:id/reativar` — volta à base, a pedido da pessoa. */
  reativar: (id: string, justificativa: string) =>
    api.post<{ ok: true }>(`/contatos/${id}/reativar`, { justificativa }),

  /** `POST /contatos/:id/anonimizar` — apaga os dados e mantém o bloqueio. */
  anonimizar: (id: string) => api.post<{ ok: true }>(`/contatos/${id}/anonimizar`),

  /** `DELETE /contatos/:id/permanente` — apaga tudo, inclusive o número. */
  apagar: (id: string) => api.delete<{ ok: true }>(`/contatos/${id}/permanente`),

  /** `GET /contatos/segmentos` — quantos em cada perfil, com a regra. */
  segmentos: () => api.get<ResumoSegmentos>('/contatos/segmentos'),

  /** `PUT /contatos/segmentos/parametros` — só o dono. */
  salvarParametros: (p: ParametrosSegmentacao) => api.put<ResumoSegmentos>('/contatos/segmentos/parametros', p),

  /** `POST /contatos/segmentos/:segmento/lista` — foto do perfil numa lista. */
  criarListaDoPerfil: (segmento: Segmento, nome?: string) =>
    api.post<{ id: string; nome: string; total: number }>(`/contatos/segmentos/${segmento}/lista`, { nome }),

  /**
   * `POST /contatos/importacao/arquivo` — prévia a partir de um arquivo.
   * **Nada é gravado.** O formato sai da extensão, no servidor.
   */
  previaDeArquivo: (arquivo: File) =>
    api.enviarArquivo<PreviaDaImportacao>('/contatos/importacao/arquivo', 'arquivo', arquivo),

  /** `POST /contatos/importacao/texto` — prévia de números colados. */
  previaDeTexto: (texto: string) =>
    api.post<PreviaDaImportacao>('/contatos/importacao/texto', { texto }),

  /** `POST /contatos/importacao` — aqui sim os contatos são gravados. */
  importar: (dados: ConfirmacaoDaImportacao) =>
    api.post<{ importacaoId: string; gravados: number; jaExistiam: number }>(
      '/contatos/importacao',
      dados,
    ),

  /** `GET /contatos/listas` */
  listas: () => api.get<ListaDeContatos[]>('/contatos/listas'),

  /** `GET /contatos/listas/:id/publico` — quantos da lista podem receber (sem quem pediu para sair). */
  publicoDaLista: (id: string) => api.get<{ total: number }>(`/contatos/listas/${encodeURIComponent(id)}/publico`),

  /** `POST /contatos/listas` */
  criarLista: (nome: string, descricao?: string) =>
    api.post<{ id: string }>('/contatos/listas', { nome, descricao }),

  /** `POST /contatos/:id/listas` — põe o contato numa lista (a partir da conversa). */
  adicionarNaLista: (contatoId: string, listaId: string) =>
    api.post<{ ok: true; jaEstava: boolean; lista: string }>(
      `/contatos/${encodeURIComponent(contatoId)}/listas`,
      { listaId },
    ),

  /** `DELETE /contatos/:id` — marca como descadastrado; não apaga. */
  descadastrar: (id: string) => api.delete<{ ok: boolean }>(`/contatos/${id}`),
};

export const modelos = {
  /** `GET /modelos` — inclui rascunho, que a Meta não tem. */
  listar: () => api.get<ModeloSalvo[]>('/modelos'),

  /**
   * `POST /modelos/conferir` — passa nas regras da Meta?
   *
   * A conferência mora no servidor de propósito. Validar de novo aqui criaria
   * duas implementações da mesma regra, e elas divergem: foi assim que um
   * telefone sem o código do país passou na tela e foi recusado pela Meta.
   */
  conferir: (dados: DadosModelo, id?: string) =>
    api.post<{ problemas: ProblemaNoModelo[] }>(
      `/modelos/conferir${id ? `?id=${encodeURIComponent(id)}` : ''}`,
      dados,
    ),

  /** `POST /modelos` — grava o rascunho. Nada vai para a Meta ainda. */
  criar: (dados: DadosModelo) => api.post<{ id: string }>('/modelos', dados),

  /** `PUT /modelos/:id` */
  atualizar: (id: string, dados: DadosModelo) =>
    api.put<{ id: string }>(`/modelos/${id}`, dados),

  /** `POST /modelos/:id/enviar` — submete à Meta. */
  enviar: (id: string) =>
    api.post<{ status: string; motivo: string | null }>(`/modelos/${id}/enviar`, {}),

  /** `DELETE /modelos/:id` — só rascunho e recusado. */
  /** `DELETE /modelos/:id` — apaga aqui e, quando o modelo está lá, também na Meta. */
  excluir: (id: string) => api.delete<{ ok: boolean; naMeta: boolean }>(`/modelos/${id}`),
};

export const midia = {
  /**
   * `POST /midia` — guarda o arquivo e devolve a referência do modelo.
   *
   * A Meta não busca a URL da imagem: ela recebe os bytes. Por isso o arquivo
   * passa por nós antes, e só vira `header_handle` na hora de submeter.
   */
  enviar: (arquivo: File) =>
    api.enviarArquivo<{ id: string; referencia: string; formato: string; nome: string }>(
      '/midia',
      'arquivo',
      arquivo,
    ),

  /** Endereço da mídia guardada, para a prévia. */
  endereco: (referencia: string): string | null => {
    if (referencia.startsWith('midia:')) return enderecoDaApi(`/midia/${referencia.slice(6)}`);
    if (/^https?:\/\//i.test(referencia)) return referencia;
    return null;
  },
};

// ------------------------------------------------------------- distribuição
//
// O console da DISTRIBUIÇÃO. Sessão própria, separada da do cliente: os cookies
// vivem só em /api/v1/distribuicao, e o navegador nunca os manda para as rotas
// de cliente.

export interface OperadorLogado {
  id: string;
  nome: string;
  email: string;
}

export type EtapaLogin = 'codigo' | 'cadastrar_codigo';

export type SituacaoConta = 'ativa' | 'em_risco' | 'inativa' | 'nunca_usou';

/** Uma pessoa com acesso a uma conta, vista pelo suporte. */
export interface AcessoNoConsole {
  id: string;
  nome: string;
  email: string;
  papel: string;
  status: string;
  /** nenhum | email | app */
  doisFatores: string;
  travado: boolean;
  ultimoLoginEm: string | null;
}

export interface ContaNoConsole {
  id: string;
  nome: string;
  cnpj: string | null;
  contaStatus: string;
  criadaEm: string;
  assinaturaStatus: string | null;
  planoNome: string | null;
  cicloInicio: string | null;
  cicloFim: string | null;
  gratisAte: string | null;
  usoCiclo: number;
  teto: number | null;
  usoPercentual: number | null;
  ultimoEnvio: string | null;
  envios30d: number;
  ultimoLogin: string | null;
  erros7d: number;
  whatsappPronto: boolean;
  situacao: SituacaoConta;
}

export interface ResumoDoConsole {
  contas: { total: number; ativas: number; emRisco: number; inativas: number; nuncaUsaram: number };
  assinaturas: Record<string, number>;
  disparos: { ciclo: number; ultimos7d: number; ultimas24h: number };
  erros: { ultimas24h: number; contasAfetadas24h: number };
  campanhasEmAndamento: number;
  perto_do_teto: number;
  receita: { mrrCentavos: number; pagantes: number; inadimplentes: number; emGratis: number };
}

export interface TelemetriaDoConsole {
  dias: number;
  porCodigo: {
    codigo: number | null;
    classe: string | null;
    origem: string;
    ocorrencias: number;
    contas: number;
    ultima: string | null;
  }[];
  recentes: {
    id: string;
    criadoEm: string | null;
    origem: string;
    classe: string | null;
    codigo: number | null;
    status: number | null;
    metodo: string | null;
    rota: string | null;
    referencia: string | null;
    mensagem: string | null;
    contaNome: string | null;
    contaId: string | null;
  }[];
}

export interface PlanoNoConsole {
  id: string;
  codigo: string;
  nome: string;
  disparosMes: number;
  precoCentavos: number;
  ativo: boolean;
  publico: boolean;
  ordem: number;
  contas: number;
}

export type DadosPlano = Partial<Omit<PlanoNoConsole, 'id' | 'contas'>>;

export type StatusListaEspera = 'aguardando' | 'convidada' | 'recusada' | 'convertida';

export interface PedidoListaEspera {
  id: string;
  nome: string;
  email: string;
  empresa: string | null;
  telefoneE164: string | null;
  origem: string | null;
  status: StatusListaEspera;
  observacao: string | null;
  conviteExpiraEm: string | null;
  conviteExpirado: boolean;
  convidadaEm: string | null;
  convertidaEm: string | null;
  contaId: string | null;
  criadoEm: string;
}

export interface PaginaListaEspera {
  itens: PedidoListaEspera[];
  total: number;
  pagina: number;
  limite: number;
  /** Convites da janela de 7 dias da Meta. */
  capacidade: { enviados7d: number; teto: number; restantes: number; proximaVagaEm: string | null };
}

export interface RespostaConviteConsole {
  id: string;
  status: StatusListaEspera;
  expiraEm: string;
  link: string;
  emailEnviado: boolean;
  aviso: string;
}

/** Sem redirecionar para o login DO CLIENTE no 401: aqui o login é outro. */
const SEM_REDIRECT_DIST = { redirecionarNo401: false } as const;

export const distribuicao = {
  eu: () => api.get<OperadorLogado>('/distribuicao/eu', SEM_REDIRECT_DIST),
  entrar: (email: string, senha: string) =>
    api.post<{ etapa: EtapaLogin }>('/distribuicao/entrar', { email, senha }, SEM_REDIRECT_DIST),
  confirmarCodigo: (codigo: string) =>
    api.post<{ ok: boolean }>('/distribuicao/entrar/codigo', { codigo }, SEM_REDIRECT_DIST),
  iniciarCodigo: () =>
    api.post<{ endereco: string; segredo: string }>('/distribuicao/codigo/iniciar', {}, SEM_REDIRECT_DIST),
  confirmarCadastro: (codigo: string) =>
    api.post<{ ok: boolean }>('/distribuicao/codigo/confirmar', { codigo }, SEM_REDIRECT_DIST),
  sair: () => api.post<{ ok: boolean }>('/distribuicao/sair', {}, SEM_REDIRECT_DIST),
  resumo: () => api.get<ResumoDoConsole>('/distribuicao/resumo', SEM_REDIRECT_DIST),
  contas: () => api.get<ContaNoConsole[]>('/distribuicao/contas', SEM_REDIRECT_DIST),
  listaEspera: (status?: StatusListaEspera) =>
    api.get<PaginaListaEspera>(
      '/distribuicao/lista-espera?limite=100' + (status ? '&status=' + status : ''),
      SEM_REDIRECT_DIST,
    ),
  convidar: (id: string, forcar = false) =>
    api.post<RespostaConviteConsole>(
      '/distribuicao/lista-espera/' + id + '/convidar',
      { forcar },
      SEM_REDIRECT_DIST,
    ),
  recusar: (id: string, observacao: string) =>
    api.post<{ id: string; status: StatusListaEspera }>(
      '/distribuicao/lista-espera/' + id + '/recusar',
      { observacao },
      SEM_REDIRECT_DIST,
    ),
  estenderGratis: (contaId: string, dias: number) =>
    api.post<{ gratisAte: string }>('/distribuicao/contas/' + contaId + '/estender-gratis', { dias }, SEM_REDIRECT_DIST),
  acessos: (contaId: string) =>
    api.get<AcessoNoConsole[]>('/distribuicao/contas/' + contaId + '/acessos', SEM_REDIRECT_DIST),
  zerarDuasEtapas: (usuarioId: string) =>
    api.post<{ ok: boolean }>('/distribuicao/usuarios/' + usuarioId + '/zerar-duas-etapas', {}, SEM_REDIRECT_DIST),
  planos: () => api.get<PlanoNoConsole[]>('/distribuicao/planos', SEM_REDIRECT_DIST),
  criarPlano: (dados: DadosPlano) =>
    api.post<{ id: string }>('/distribuicao/planos', dados, SEM_REDIRECT_DIST),
  atualizarPlano: (id: string, dados: DadosPlano) =>
    api.patch<{ ok: boolean; campanhasRetomadas: number }>('/distribuicao/planos/' + id, dados, SEM_REDIRECT_DIST),
  telemetria: (dias = 7) =>
    api.get<TelemetriaDoConsole>(`/distribuicao/telemetria?dias=${dias}`, SEM_REDIRECT_DIST),
};

/** A tela de conversas (coexistência com "sim"). O servidor recusa se não estiver ligada. */
export const conversas = {
  /** `GET /conversas` — as conversas, a mais recente primeiro. */
  listar: (busca?: string, sinal?: AbortSignal) =>
    api.get<ConversaResumo[]>(`/conversas${busca?.trim() ? `?busca=${encodeURIComponent(busca.trim())}` : ''}`, { sinal }),

  /** `GET /conversas/:id` */
  detalhe: (id: string, sinal?: AbortSignal) => api.get<ConversaResumo>(`/conversas/${id}`, { sinal }),

  /** `GET /conversas/:id/mensagens` — `antesDe` pede a página anterior. */
  mensagens: (id: string, antesDe?: string, sinal?: AbortSignal) =>
    api.get<MensagemDaConversa[]>(
      `/conversas/${id}/mensagens${antesDe ? `?antesDe=${encodeURIComponent(antesDe)}` : ''}`,
      { sinal },
    ),

  /** `POST /conversas/:id/lida` */
  marcarLida: (id: string) => api.post<{ ok: true }>(`/conversas/${id}/lida`, {}),

  /** `POST /conversas/:id/mensagens` — texto livre, só dentro da janela de 24 h. */
  responder: (id: string, texto: string) => api.post<MensagemDaConversa>(`/conversas/${id}/mensagens`, { texto }),

  /** Endereço da mídia, para `<img>`, `<audio>` e `<video>` (o cookie vai junto). */
  enderecoDaMidia: (conversaId: string, mensagemId: string) =>
    enderecoDaApi(`/conversas/${conversaId}/mensagens/${mensagemId}/midia`),

  /** `GET /conversas/config` */
  configuracao: () => api.get<{ retencaoDias: number }>('/conversas/config'),

  /** `PATCH /conversas/config` — só o dono. */
  salvarConfiguracao: (retencaoDias: number) =>
    api.patch<{ retencaoDias: number }>('/conversas/config', { retencaoDias }),
};
