import { resolve } from 'node:path';

/**
 * Leitura e validação das variáveis de ambiente, uma vez, no boot.
 *
 * Fail-fast de propósito: um segredo ausente derruba o processo no start, em
 * vez de virar um 500 obscuro no primeiro request. No Regem, `WA_CLOUD_TOKEN`
 * vazio vira `BadRequestException` — ou seja, o cliente recebe "sua requisição
 * está errada" quando o problema é de configuração nossa.
 */

/**
 * Carrega `backend/.env` em desenvolvimento.
 *
 * Este arquivo é lido no import, antes de o Nest existir, então `ConfigModule`
 * não serve aqui — quando ele inicializaria, `env` já teria estourado.
 *
 * Só fora de produção, de propósito: em produção as variáveis vêm do EasyPanel
 * e `process.loadEnvFile` SOBRESCREVE o que já está em `process.env`. Um `.env`
 * esquecido dentro da imagem passaria por cima da configuração real do
 * servidor — falha silenciosa e difícil de enxergar. (O `.dockerignore` já
 * impede isso; esta guarda é a segunda tranca.)
 */
if (process.env.NODE_ENV !== 'production') {
  // Caminho relativo ao arquivo compilado (dist/config/env.js) e ao fonte
  // (src/config/env.ts): os dois estão dois níveis abaixo de backend/.
  const caminho = resolve(__dirname, '..', '..', '.env');
  try {
    process.loadEnvFile(caminho);
  } catch {
    // Sem .env: seguimos com o que estiver no ambiente. Se faltar algo
    // obrigatório, o erro logo abaixo diz exatamente qual variável é.
  }
}

/** Lê um PEM que pode vir em texto puro ou em base64. */
function pemOpcional(nome: string): string {
  const bruto = (process.env[nome] ?? '').trim();
  if (!bruto) return '';
  if (bruto.includes('-----BEGIN')) return bruto;
  try {
    const decodificado = Buffer.from(bruto, 'base64').toString('utf8');
    if (decodificado.includes('-----BEGIN')) return decodificado;
  } catch {
    // cai no erro abaixo
  }
  throw new Error(
    `Variável ${nome} não parece um certificado: esperava PEM (-----BEGIN ...) ` +
      'ou o mesmo PEM em base64.',
  );
}

function obrigatoria(nome: string): string {
  const v = process.env[nome];
  if (!v || !v.trim()) {
    throw new Error(
      `Variável de ambiente ${nome} não está definida. Veja backend/.env.example.`,
    );
  }
  return v.trim();
}

function opcional(nome: string, padrao = ''): string {
  return (process.env[nome] ?? padrao).trim();
}

function numero(nome: string, padrao: number): number {
  const bruto = process.env[nome];
  if (!bruto) return padrao;
  const n = Number(bruto);
  if (!Number.isFinite(n)) {
    throw new Error(`Variável ${nome} precisa ser um número (recebi "${bruto}").`);
  }
  return n;
}

function booleana(nome: string, padrao = false): boolean {
  const bruto = (process.env[nome] ?? '').trim().toLowerCase();
  if (!bruto) return padrao;
  return bruto === 'true' || bruto === '1' || bruto === 'sim';
}

const producao = opcional('NODE_ENV') === 'production';

/**
 * URL NOSSA que vai dentro de link enviado ao cliente (convite, rastreio de
 * clique). Em dev tem padrão; em produção é obrigatória E precisa ser https.
 *
 * O padrão silencioso é pior que a falta: um deploy sem a variável não quebra,
 * ele manda o cliente para `http://localhost:3011` — e o erro só aparece do
 * outro lado, no cliente que clicou e não chegou a lugar nenhum. Exigir https
 * é o mesmo cuidado: link http em e-mail e em template da Meta vira aviso de
 * "site não seguro" e ainda trafega o token do convite em claro.
 */
function urlPublica(nome: string, padraoDev: string): string {
  if (!producao) return opcional(nome, padraoDev);
  const valor = obrigatoria(nome);
  if (!/^https:\/\/\S+$/.test(valor)) {
    throw new Error(
      `Variável de ambiente ${nome} precisa começar com https:// em produção ` +
        `(recebi "${valor}"). Veja backend/.env.example.`,
    );
  }
  return valor;
}

/**
 * Piso de tamanho do token do console de distribuição. Espelha
 * TAMANHO_MINIMO_DIST_TOKEN do DistTokenGuard de propósito: lá a checagem é por
 * request (o guard relê process.env para permitir rotação sem redeploy), aqui é
 * no boot — token curto não pode ficar escondido até alguém abrir o console.
 * O valor nunca aparece em log nem em mensagem de erro.
 */
const DIST_TOKEN_MINIMO = 24;

function distToken(): string {
  const valor = opcional('DIST_TOKEN');
  if (valor && producao && valor.length < DIST_TOKEN_MINIMO) {
    throw new Error(
      `Variável de ambiente DIST_TOKEN tem menos de ${DIST_TOKEN_MINIMO} caracteres ` +
        'e protege os dados de TODAS as contas. Gere outra com: openssl rand -hex 32.',
    );
  }
  return valor;
}

export const env = {
  producao,
  porta: numero('PORT', 3010),

  banco: {
    url: obrigatoria('DATABASE_URL'),
    /**
     * Em produção o certificado é verificado de verdade. `rejectUnauthorized:
     * false` é o padrão silencioso de muita biblioteca e transforma TLS em
     * teatro — quem está no meio do caminho lê tudo.
     */
    ssl: opcional('DATABASE_SSL', producao ? 'require' : 'disable'),
    poolMax: numero('DATABASE_POOL_MAX', 10),
    /**
     * CA para validar o certificado do banco. Aceita o PEM inteiro ou o PEM em
     * base64 — variável multi-linha é problema em painel de deploy. Vazio faz
     * o modo de DATABASE_SSL decidir.
     */
    caCert: pemOpcional('DATABASE_CA_CERT'),
  },

  redis: {
    url: opcional('REDIS_URL', 'redis://localhost:6379'),
  },

  sessao: {
    segredo: obrigatoria('JWT_SECRET'),
    ttlHoras: numero('JWT_TTL_HORAS', 12),
    cookieNome: opcional('COOKIE_NOME', 'regemcast_sess'),
    cookieDominio: opcional('COOKIE_DOMINIO'),
    /**
     * Validade da sessão do APLICATIVO, em dias.
     *
     * Bem maior que as 12 horas da web, e de propósito: no navegador a pessoa
     * volta e digita a senha; no celular, exigir senha a cada meio dia faria o
     * app ser desinstalado. O que segura o risco é outra coisa — o token fica
     * no cofre do sistema, a tela pede biometria para reabrir, e trocar a senha
     * ou suspender o acesso derruba a sessão na hora (token_versao).
     */
    ttlAppDias: numero('JWT_TTL_APP_DIAS', 30),
  },

  rede: {
    /** Base do link de convite que o cliente recebe por e-mail. */
    appUrl: urlPublica('APP_URL', 'http://localhost:3011'),
    apiUrl: opcional('API_URL', 'http://localhost:3010'),
    /** Em produção é obrigatório: sem lista, CORS com credenciais vira buraco. */
    corsOrigin: producao
      ? obrigatoria('CORS_ORIGIN').split(',').map((s) => s.trim()).filter(Boolean)
      : opcional('CORS_ORIGIN', 'http://localhost:3011').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: numero('TRUST_PROXY', 1),
    trustCloudflare: booleana('TRUST_CLOUDFLARE', false),
    swagger: booleana('SWAGGER_ENABLED', !producao),
  },

  meta: {
    appId: opcional('META_APP_ID'),
    appSecret: opcional('META_APP_SECRET'),
    verifyToken: opcional('META_VERIFY_TOKEN'),
    configId: opcional('META_CONFIG_ID'),
    graphVersao: opcional('META_GRAPH_VERSAO', 'v25.0'),
    tokenChave: opcional('META_TOKEN_CHAVE'),
  },

  /**
   * ATENÇÃO: esta base fica CONGELADA dentro de cada template aprovado pela
   * Meta. Trocar depois obriga a recriar e reaprovar todos os modelos, com
   * nome novo — foi o que aconteceu no Regem, onde o domínio da API vive
   * dentro dos templates já aprovados.
   *
   * Por isso ela é obrigatória e https em produção, como a APP_URL: um deploy
   * sem a variável não congelaria "o domínio errado", congelaria `localhost`
   * dentro de templates que só se conserta recriando tudo.
   */
  rastreioBase: urlPublica('RASTREIO_BASE_URL', 'http://localhost:3010/r'),

  /**
   * Console de distribuição (Regem), não do cliente. Opcional: sem ela as rotas
   * do console respondem 503 (DistTokenGuard é fail-closed). Aparece aqui para
   * o boot recusar um token curto demais — o guard, que lê process.env a cada
   * request, continua sendo quem autoriza.
   */
  distribuicao: {
    token: distToken(),
    /**
     * Cifra o segredo do código de duas etapas dos operadores. Chave PRÓPRIA de
     * propósito — reusar a dos tokens da Meta faria um vazamento dela expor os
     * tokens de todos os clientes E os códigos dos operadores de uma vez. Sem
     * ela, o cadastro de duas etapas recusa em vez de cair na outra chave.
     */
    totpChave: opcional('DIST_TOTP_CHAVE'),
    cookieNome: opcional('DIST_COOKIE_NOME', 'regemcast_dist'),
    /** Sessão de operador é curta: é acesso a todas as contas. */
    ttlHoras: numero('DIST_TTL_HORAS', 8),
  },

  /**
   * Envio de e-mail (códigos de verificação e convites), pelo Resend.
   *
   * Sem a chave, fora de produção o e-mail vai para o LOG (dá para testar o
   * fluxo inteiro na máquina); em produção o envio recusa com 503 dizendo qual
   * variável falta — nunca finge que mandou.
   */
  email: {
    resendChave: opcional('RESEND_API_KEY'),
    remetente: opcional('EMAIL_REMETENTE', 'RegemCast <nao-responda@dmstecnologias.com>'),
  },

  /**
   * Cifra o segredo do app autenticador dos CLIENTES. Chave própria, separada
   * da dos operadores (DIST_TOTP_CHAVE) e da dos tokens da Meta: um vazamento
   * de uma não abre as outras.
   */
  seguranca: {
    totpChave: opcional('CONTA_TOTP_CHAVE'),
  },

  /**
   * Quantos clientes novos a Meta deixa conectar por janela de 7 dias. É 10 até
   * a Access Verification sair; depois, 200. Variável para subir sem deploy de
   * código.
   */
  /**
   * Integrações com sistemas do cliente (hoje: Cardápio Web).
   *
   * `INTEGRACOES_CHAVE` cifra as credenciais que o cliente conecta (a chave da
   * loja, os tokens OAuth). Chave própria, 32 bytes em base64, separada da dos
   * tokens da Meta: vazar uma não abre a outra. Sem ela, conectar responde 503
   * dizendo o que falta — nunca grava credencial em claro.
   */
  integracoes: {
    chave: opcional('INTEGRACOES_CHAVE'),
    cardapiowebUrl: opcional('CARDAPIOWEB_API_URL', 'https://integracao.cardapioweb.com'),
  },

  /**
   * Push do app Android, pelo Firebase Cloud Messaging.
   *
   * O JSON da conta de serviço do projeto Firebase, em texto ou base64. Sem
   * ele o push fica desligado: os avisos simplesmente não saem e nada mais
   * muda — campanha, webhook e cobrança seguem iguais.
   */
  push: {
    contaServico: opcional('FIREBASE_CONTA_SERVICO'),
  },

  /**
   * Mercado Pago (conta da SISTER TECNOLOGIA): assinaturas dos clientes.
   *
   * Sem o token, contratar um plano responde 503 dizendo o que falta — nunca
   * cria assinatura pela metade. Sem o segredo do webhook, os avisos são
   * gravados e NUNCA processados: aviso sem assinatura conferida não ativa
   * plano de ninguém.
   */
  mercadoPago: {
    accessToken: opcional('MP_ACCESS_TOKEN'),
    webhookSegredo: opcional('MP_WEBHOOK_SEGREDO'),
    /** Dias depois do vencimento sem pagamento até os disparos pararem. */
    carenciaDias: numero('CARENCIA_DIAS', 5),
  },

  listaEspera: {
    tetoSemana: numero('TETO_CLIENTES_NOVOS_7D', 10),
  },

  storage: {
    url: opcional('SUPABASE_URL'),
    chave: opcional('SUPABASE_SERVICE_KEY'),
    bucket: opcional('SUPABASE_BUCKET', 'regemcast-midia'),
  },
} as const;

export type Env = typeof env;
