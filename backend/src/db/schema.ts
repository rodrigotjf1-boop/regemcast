/**
 * Schema Drizzle do Regemcast.
 *
 * O SQL de `database/migrations/` é a fonte da verdade do banco; este arquivo
 * é o espelho tipado. Quando os dois divergirem, o SQL vence — mas divergir é
 * bug, não convenção: no Regem a unique de `cliente(tenant_id, telefone)`
 * existe no banco desde a migration 071 e nunca foi declarada aqui, o que faz
 * quem lê o ORM acreditar que ela não existe.
 *
 * Regra: toda constraint que o Drizzle sabe expressar é declarada aqui.
 */
import { sql } from 'drizzle-orm';
import {
  customType,
  bigint,
  smallint,
  time,
  bigserial,
  boolean,
  date,
  inet,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Catálogo de planos (tabela da distribuição — RLS de escopo sistema). */
export const plano = pgTable('plano', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  codigo: text('codigo').notNull(),
  nome: text('nome').notNull(),
  /** Eixo de cobrança do produto: disparos por mês. */
  disparosMes: integer('disparos_mes').notNull(),
  precoCentavos: integer('preco_centavos').notNull().default(0),
  ativo: boolean('ativo').notNull().default(true),
  ordem: integer('ordem').notNull().default(0),
  /** Contratável pelo cliente. Cortesia e planos internos: false (migration 015). */
  publico: boolean('publico').notNull().default(true),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  codigoUq: uniqueIndex('plano_codigo_key').on(t.codigo),
}));

/**
 * Token de integração por conta (migration 043): a credencial de outro produto
 * da DMS para entrar pela porta MCP. Só o hash é guardado; o token em claro
 * sai uma vez, na emissão. `classe` = `dms` (produto do grupo) ou `externo`
 * (nunca dispara). Regras em `integracao/integracao.regras.ts`.
 */
export const integracaoToken = pgTable('integracao_token', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  contaId: uuid('conta_id').notNull().references(() => conta.id, { onDelete: 'cascade' }),
  produto: text('produto').notNull(),
  classe: text('classe').notNull(),
  nome: text('nome').notNull(),
  tokenHash: text('token_hash').notNull(),
  prefixo: text('prefixo').notNull(),
  escopos: jsonb('escopos').notNull().default(sql`'[]'::jsonb`),
  criadoPor: text('criado_por'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  ultimoUsoEm: timestamp('ultimo_uso_em', { withTimezone: true }),
  revogadoEm: timestamp('revogado_em', { withTimezone: true }),
  revogadoPor: text('revogado_por'),
}, (t) => ({
  hashUq: uniqueIndex('idx_integracao_token_hash').on(t.tokenHash),
  contaIdx: index('idx_integracao_token_conta').on(t.contaId, t.criadoEm),
}));

/**
 * Tarifas da Meta por mensagem entregue (migration 041; tabela da distribuição
 * — leitura em qualquer escopo, escrita só no de sistema).
 *
 * O preço depende da moeda da conta, do país de quem recebe (`ddi`) e da
 * categoria do modelo, e só muda no primeiro dia de um trimestre: cada linha
 * tem a data em que passa a valer, e a anterior fica como histórico.
 * `valor` é `numeric(12,6)` — entra e sai como texto; a conta é em micros
 * (`orcamento/tarifa.regras.ts`).
 */
export const tarifaMeta = pgTable('tarifa_meta', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  /** ISO 4217, a moeda de cobrança da conta (`wa_conta.moeda`). */
  moeda: text('moeda').notNull(),
  /** O código do país de quem recebe, só dígitos ("55" = Brasil). */
  ddi: text('ddi').notNull(),
  /** Como a Meta escreve em `pricing.category`: marketing, utility, authentication… */
  categoria: text('categoria').notNull(),
  valor: numeric('valor', { precision: 12, scale: 6 }).notNull(),
  vigenteDe: date('vigente_de').notNull(),
  fonte: text('fonte'),
  criadoPor: text('criado_por'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  vigenciaUq: uniqueIndex('idx_tarifa_meta_vigencia').on(t.moeda, t.ddi, t.categoria, t.vigenteDe),
}));

/**
 * O cliente do Regemcast.
 *
 * `timezone` rege toda janela de envio e todo teto de período. É coluna, e não
 * constante, porque no Regem 'America/Sao_Paulo' está cravado no SQL — e ainda
 * por cima comparado errado (`now() at time zone` devolve timestamp naive, que
 * o Postgres recasta no fuso da sessão, deslocando a virada do dia em 3h).
 */
export const conta = pgTable('conta', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  nome: text('nome').notNull(),
  cnpj: text('cnpj'),
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  /** Descanso entre campanhas de marketing, em dias; 0 desliga (migration 031). */
  descansoMarketingDias: integer('descanso_marketing_dias').notNull().default(3),
  /**
   * Orçamento de disparos (migration 042): quanto a conta aceita gastar na Meta
   * por dia, por semana e por mês, em centavos da moeda da conta. Nulo = sem
   * teto. Só o dono altera (`orcamento/orcamento.service.ts`).
   */
  orcamentoDiaCentavos: integer('orcamento_dia_centavos'),
  orcamentoSemanaCentavos: integer('orcamento_semana_centavos'),
  orcamentoMesCentavos: integer('orcamento_mes_centavos'),
  /** aprovada | ativa | suspensa | cancelada */
  status: text('status').notNull().default('aprovada'),
  planoId: uuid('plano_id').references(() => plano.id, { onDelete: 'set null' }),
  aprovadaEm: timestamp('aprovada_em', { withTimezone: true }),
  /** O que a Receita disse no cadastro (migration 014). */
  cnpjRazaoSocial: text('cnpj_razao_social'),
  cnpjSituacao: text('cnpj_situacao'),
  /** Quando o CNPJ foi conferido como ATIVO. Nulo = nunca conferido. */
  cnpjConferidoEm: timestamp('cnpj_conferido_em', { withTimezone: true }),
  /** Por quantos dias guardar as mensagens das conversas (migration 024). 0 = tudo. */
  conversasRetencaoDias: integer('conversas_retencao_dias').notNull().default(0),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  /** Um CNPJ, uma conta (índice único parcial, migration 014). */
  cnpjUq: uniqueIndex('uq_conta_cnpj').on(t.cnpj).where(sql`cnpj is not null`),
}));

/**
 * `tokenVersao` invalida sessões sem tabela de sessão: o JWT carrega a versão
 * e o guard compara a cada request. Trocar senha, suspender ou remover o
 * usuário incrementa e derruba tudo na hora.
 */
export const usuario = pgTable('usuario', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  contaId: uuid('conta_id').notNull().references(() => conta.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  /** citext no banco: a unicidade já é case-insensitive. */
  email: text('email').notNull(),
  senhaHash: text('senha_hash').notNull(),
  /** dono | operador */
  papel: text('papel').notNull().default('operador'),
  /** ativo | suspenso */
  status: text('status').notNull().default('ativo'),
  tokenVersao: integer('token_versao').notNull().default(1),
  ultimoLoginEm: timestamp('ultimo_login_em', { withTimezone: true }),
  /** Quando o e-mail foi confirmado por código. Nulo = nunca confirmado. */
  emailVerificadoEm: timestamp('email_verificado_em', { withTimezone: true }),
  /** nenhum | email | app — a segunda etapa do login. */
  doisFatores: text('dois_fatores').notNull().default('nenhum'),
  /** Cifrado com CONTA_TOTP_CHAVE. Preenchido sem 'app' = cadastro não confirmado. */
  totpSegredoCifrado: text('totp_segredo_cifrado'),
  /** Último passo (30s) aceito do app: código do mesmo passo ou anterior é recusado (migration 017). */
  totpUltimoPasso: bigint('totp_ultimo_passo', { mode: 'number' }),
  tentativasFalhas: integer('tentativas_falhas').notNull().default(0),
  bloqueadoAte: timestamp('bloqueado_ate', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailUq: uniqueIndex('usuario_email_key').on(t.email),
  contaIdx: index('idx_usuario_conta').on(t.contaId),
  /** Exatamente um dono ativo por conta (índice único parcial). */
  donoUq: uniqueIndex('uq_usuario_dono').on(t.contaId).where(sql`papel = 'dono'`),
}));

/**
 * Fila de entrada. Existe ANTES da conta — é o que transforma o teto de 10
 * clientes novos por janela rolling de 7 dias da Meta em fila administrável,
 * em vez de erro no meio do Embedded Signup.
 *
 * O convite guarda apenas o HASH do token; o token em claro só existe no link
 * enviado por e-mail.
 */
export const listaEspera = pgTable('lista_espera', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').notNull(),
  nome: text('nome').notNull(),
  empresa: text('empresa'),
  telefoneE164: text('telefone_e164'),
  origem: text('origem'),
  /** aguardando | convidada | recusada | convertida */
  status: text('status').notNull().default('aguardando'),
  observacao: text('observacao'),
  conviteTokenHash: text('convite_token_hash'),
  conviteExpiraEm: timestamp('convite_expira_em', { withTimezone: true }),
  convidadaEm: timestamp('convidada_em', { withTimezone: true }),
  convertidaEm: timestamp('convertida_em', { withTimezone: true }),
  contaId: uuid('conta_id').references(() => conta.id, { onDelete: 'set null' }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailUq: uniqueIndex('lista_espera_email_key').on(t.email),
  statusIdx: index('idx_lista_espera_status').on(t.status, t.criadoEm),
  conviteUq: uniqueIndex('uq_lista_espera_convite')
    .on(t.conviteTokenHash)
    .where(sql`convite_token_hash is not null`),
}));

/**
 * Append-only por permissão E por trigger. No Regem o módulo de campanha não
 * registra nada — nem o DELETE físico que apaga o histórico inteiro de envio,
 * que é justamente a prova de a quem foi enviado o quê.
 */
export const auditoria = pgTable('auditoria', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  /**
   * Sem FK de proposito: a trilha sobrevive ao sujeito. Com `on delete set
   * null`, apagar um usuario dispararia um UPDATE aqui — e a trigger de
   * imutabilidade bloqueia, tornando a remocao impossivel. Explicacao completa
   * na migration 001.
   */
  contaId: uuid('conta_id'),
  /** usuario | sistema | distribuicao */
  atorTipo: text('ator_tipo').notNull().default('usuario'),
  atorUsuarioId: uuid('ator_usuario_id'),
  /** Nome do ator congelado no momento do registro, para a linha seguir legivel. */
  atorNome: text('ator_nome'),
  acao: text('acao').notNull(),
  entidade: text('entidade'),
  entidadeId: text('entidade_id'),
  detalhe: jsonb('detalhe').notNull().default(sql`'{}'::jsonb`),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contaIdx: index('idx_auditoria_conta_id').on(t.contaId, t.id),
  acaoIdx: index('idx_auditoria_acao').on(t.contaId, t.acao, t.id),
}));

export const assinatura = pgTable('assinatura', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  contaId: uuid('conta_id').notNull().references(() => conta.id, { onDelete: 'cascade' }),
  planoId: uuid('plano_id').notNull().references(() => plano.id),
  /** cortesia | ativa | inadimplente | cancelada */
  status: text('status').notNull().default('cortesia'),
  cicloInicio: timestamp('ciclo_inicio', { withTimezone: true }).notNull().defaultNow(),
  cicloFim: timestamp('ciclo_fim', { withTimezone: true }).notNull(),
  gratisAte: timestamp('gratis_ate', { withTimezone: true }),
  provedorRef: text('provedor_ref'),
  /** Id da assinatura (preapproval) no Mercado Pago — migration 016. */
  mpAssinaturaId: text('mp_assinatura_id'),
  /** pending | authorized | paused | cancelled — espelho do Mercado Pago. */
  mpStatus: text('mp_status'),
  mpCheckoutUrl: text('mp_checkout_url'),
  planoContratadoId: uuid('plano_contratado_id').references(() => plano.id, { onDelete: 'set null' }),
  /** Plano menor escolhido: vale na virada do ciclo. */
  planoProximoCicloId: uuid('plano_proximo_ciclo_id').references(() => plano.id, { onDelete: 'set null' }),
  inadimplenteDesde: timestamp('inadimplente_desde', { withTimezone: true }),
  avisosEnviados: text('avisos_enviados').array().notNull().default(sql`'{}'::text[]`),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contaUq: uniqueIndex('uq_assinatura_conta').on(t.contaId),
  mpUq: uniqueIndex('uq_assinatura_mp').on(t.mpAssinaturaId).where(sql`mp_assinatura_id is not null`),
}));

/** Uma cobrança mensal do Mercado Pago (migration 016). RLS por conta. */
export const cobranca = pgTable('cobranca', {
  id: uuid('id').primaryKey().defaultRandom(),
  contaId: uuid('conta_id').notNull().references(() => conta.id, { onDelete: 'cascade' }),
  assinaturaId: uuid('assinatura_id').references(() => assinatura.id, { onDelete: 'set null' }),
  planoId: uuid('plano_id').references(() => plano.id, { onDelete: 'set null' }),
  mpFaturaId: text('mp_fatura_id'),
  mpPagamentoId: text('mp_pagamento_id'),
  valorCentavos: integer('valor_centavos').notNull(),
  /** pendente | aprovada | recusada | cancelada | estornada */
  status: text('status').notNull().default('pendente'),
  meio: text('meio'),
  vencimento: timestamp('vencimento', { withTimezone: true }),
  pagoEm: timestamp('pago_em', { withTimezone: true }),
  motivo: text('motivo'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  faturaUq: uniqueIndex('uq_cobranca_fatura').on(t.mpFaturaId).where(sql`mp_fatura_id is not null`),
  contaIdx: index('idx_cobranca_conta').on(t.contaId, t.criadoEm),
}));

/** Aviso (webhook) recebido do Mercado Pago (migration 016). Escopo de sistema. */
export const eventoMercadopago = pgTable('evento_mercadopago', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  topico: text('topico').notNull(),
  recursoId: text('recurso_id').notNull(),
  requestId: text('request_id'),
  assinaturaOk: boolean('assinatura_ok').notNull().default(false),
  processadoEm: timestamp('processado_em', { withTimezone: true }),
  erro: text('erro'),
  recebidoEm: timestamp('recebido_em', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Contador materializado por ciclo. O incremento é atômico
 * (`on conflict do update set disparos = uso_ciclo.disparos + 1`) no momento
 * em que a Meta ACEITA o envio — não quando o job é criado.
 */
export const usoCiclo = pgTable('uso_ciclo', {
  contaId: uuid('conta_id').notNull().references(() => conta.id, { onDelete: 'cascade' }),
  cicloInicio: timestamp('ciclo_inicio', { withTimezone: true }).notNull(),
  disparos: bigint('disparos', { mode: 'number' }).notNull().default(0),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.contaId, t.cicloInicio] }),
}));

// ============================================================================
// META / WHATSAPP (migration 003)
// ============================================================================

/**
 * A WhatsApp Business Account do cliente.
 *
 * `wabaId` é único GLOBAL, não por conta: é a identidade da WABA do lado da
 * Meta, e duas contas do Regemcast reivindicando a mesma significaria uma lendo
 * as conversas da outra.
 */
export const waConta = pgTable('wa_conta', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  contaId: uuid('conta_id').notNull().references(() => conta.id, { onDelete: 'cascade' }),
  wabaId: text('waba_id').notNull(),
  businessId: text('business_id'),
  nome: text('nome'),
  /**
   * Token do cliente, cifrado em AES-256-GCM (`v1.iv.tag.cifra`).
   * Nunca sai daqui em claro — ver `modules/meta/cripto.ts`.
   */
  tokenCifrado: text('token_cifrado'),
  tokenEm: timestamp('token_em', { withTimezone: true }),
  /**
   * Quando o token do cliente vence. O template de Embedded Signup da Meta
   * emite token com prazo (60 dias), e sem isto a falha chega pelo pior
   * caminho: erro 190 no meio de uma campanha, sem aviso prévio.
   */
  tokenExpiraEm: timestamp('token_expira_em', { withTimezone: true }),
  /**
   * A renovação automática da autorização (migration 040, `meta/renovacao.job.ts`):
   * quando foi tentada pela última vez, e com que código a Meta recusou
   * (-1 = sem código). Erro nulo = deu certo, ou nunca foi tentada.
   */
  tokenRenovacaoEm: timestamp('token_renovacao_em', { withTimezone: true }),
  tokenRenovacaoErro: integer('token_renovacao_erro'),
  escopos: jsonb('escopos').notNull().default(sql`'[]'::jsonb`),
  /** Prazo do Brasil: toda WABA elegível precisa estar em BRL até 30/jun/2027. */
  moeda: text('moeda'),
  statusRevisao: text('status_revisao'),
  restricoes: jsonb('restricoes').notNull().default(sql`'[]'::jsonb`),
  /**
   * A saúde da conta na Meta (`health_status`, migration 039): `disponivel`,
   * `limitado` ou `bloqueado`; a lista do que está por trás (`saude`) e quando
   * foi lida. Nulo = ainda não lida. Regras em `meta/saude.regras.ts`.
   */
  saudeEstado: text('saude_estado'),
  saude: jsonb('saude'),
  saudeEm: timestamp('saude_em', { withTimezone: true }),
  /** O fuso da cobrança, a forma de pagamento e a verificação da empresa, lidos junto da saúde. */
  fuso: text('fuso'),
  pagamentoId: text('pagamento_id'),
  verificacaoNegocio: text('verificacao_negocio'),
  webhookAssinadoEm: timestamp('webhook_assinado_em', { withTimezone: true }),
  onboardadaEm: timestamp('onboardada_em', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  wabaUq: uniqueIndex('uq_wa_conta_waba').on(t.wabaId),
  contaIdx: index('idx_wa_conta_conta').on(t.contaId),
}));

/**
 * O número que dispara. `phoneNumberId` é único global pelo mesmo motivo do
 * `wabaId`, e é por ele que o webhook descobre de quem é cada evento.
 */
export const waNumero = pgTable('wa_numero', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  contaId: uuid('conta_id').notNull().references(() => conta.id, { onDelete: 'cascade' }),
  waContaId: uuid('wa_conta_id').notNull().references(() => waConta.id, { onDelete: 'cascade' }),
  phoneNumberId: text('phone_number_id').notNull(),
  telefoneE164: text('telefone_e164'),
  nomeExibicao: text('nome_exibicao'),
  /** verde | amarela | vermelha | desconhecida — 7 dias em amarela derrubam o tier. */
  qualidade: text('qualidade').notNull().default('desconhecida'),
  qualidadeEm: timestamp('qualidade_em', { withTimezone: true }),
  /** Teto de usuários únicos por 24h. Conta nova começa em 250. */
  tierLimite: integer('tier_limite'),
  tierNome: text('tier_nome'),
  tierEm: timestamp('tier_em', { withTimezone: true }),
  /** A saúde do número na Meta (`health_status`, migration 039), como a da conta. */
  saudeEstado: text('saude_estado'),
  saude: jsonb('saude'),
  saudeEm: timestamp('saude_em', { withTimezone: true }),
  /** pendente | registrado | suspenso | removido. Sem registro, todo envio dá 133010. */
  status: text('status').notNull().default('pendente'),
  registradoEm: timestamp('registrado_em', { withTimezone: true }),
  /**
   * O número também vive no app WhatsApp Business do celular (coexistência).
   * Muda duas coisas no motor: pula o /register (o app já registrou, e chamar
   * dá erro) e limita a vazão a 20 mps.
   */
  coexistencia: boolean('coexistencia').notNull().default(false),
  /** nao_se_aplica | pendente | sincronizando | concluida | expirada | falhou */
  sincronizacao: text('sincronizacao').notNull().default('nao_se_aplica'),
  sincronizacaoEm: timestamp('sincronizacao_em', { withTimezone: true }),
  sincronizacaoErro: text('sincronizacao_erro'),
  /** De onde o prazo de 24h da coexistência é contado. */
  onboardadoEm: timestamp('onboardado_em', { withTimezone: true }),
  /**
   * Coexistência (migration 023): guardar os contatos e as conversas do
   * WhatsApp Business? `true` guarda, `false` descarta o que chega, `null` =
   * o dono ainda não respondeu (o que chega fica esperando a resposta).
   */
  integrarConversas: boolean('integrar_conversas'),
  integrarDecididoEm: timestamp('integrar_decidido_em', { withTimezone: true }),
  integrarDecididoPor: uuid('integrar_decidido_por').references(() => usuario.id, { onDelete: 'set null' }),
  /** A lista "WhatsApp Business" deste número. */
  integrarListaId: uuid('integrar_lista_id').references(() => contatoLista.id, { onDelete: 'set null' }),
  /** Um registro de importação por número, somando os lotes da agenda. */
  integrarImportacaoId: uuid('integrar_importacao_id').references(() => importacao.id, { onDelete: 'set null' }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  phoneUq: uniqueIndex('uq_wa_numero_phone').on(t.phoneNumberId),
  contaIdx: index('idx_wa_numero_conta').on(t.contaId),
  waContaIdx: index('idx_wa_numero_wa_conta').on(t.waContaId),
}));

/**
 * Webhook recebido, gravado ANTES de qualquer efeito colateral.
 *
 * No Regem o controller responde 200 e processa em memória sem await: deploy no
 * meio do processamento perde o evento em definitivo, porque a Meta já recebeu
 * 200 e não reenvia.
 *
 * Sem FK e sem `notNull` em `contaId` de propósito: o evento chega identificado
 * por `phone_number_id` e só depois descobrimos de quem é — e precisa ser
 * gravado mesmo quando não resolve para conta nenhuma, que é justamente o caso
 * que merece investigação.
 */
export const waEvento = pgTable('wa_evento', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  chaveIdempotencia: text('chave_idempotencia').notNull(),
  tipo: text('tipo').notNull(),
  phoneNumberId: text('phone_number_id'),
  contaId: uuid('conta_id'),
  payload: jsonb('payload').notNull(),
  recebidoEm: timestamp('recebido_em', { withTimezone: true }).notNull().defaultNow(),
  processadoEm: timestamp('processado_em', { withTimezone: true }),
  tentativas: integer('tentativas').notNull().default(0),
  erro: text('erro'),
}, (t) => ({
  chaveUq: uniqueIndex('uq_wa_evento_chave').on(t.chaveIdempotencia),
  pendenteIdx: index('idx_wa_evento_pendente').on(t.recebidoEm).where(sql`processado_em is null`),
}));

/**
 * Campanha: um disparo.
 *
 * O modelo fica gravado **por valor** (nome, idioma, categoria), não só por
 * referência. Modelo pode ser editado ou excluído na Meta depois, e o registro
 * do que foi enviado não pode mudar retroativamente — uma campanha que diz
 * "enviei o modelo X" precisa continuar dizendo isso no ano que vem.
 */
export const campanha = pgTable('campanha', {
  id: uuid('id').primaryKey().defaultRandom(),
  contaId: uuid('conta_id').notNull(),
  nome: text('nome').notNull(),
  /** Id do modelo na Meta. Pode sumir de lá; por isso não é a única cópia. */
  modeloId: text('modelo_id'),
  modeloNome: text('modelo_nome').notNull(),
  modeloIdioma: text('modelo_idioma').notNull(),
  modeloCategoria: text('modelo_categoria'),
  status: text('status').notNull().default('rascunho'),
  criadaPor: uuid('criada_por'),
  /** O produto que montou a campanha pela porta MCP (migration 045); nulo = uma pessoa, na tela. */
  integracaoProduto: text('integracao_produto'),
  /** 0 = domingo … 6 = sábado. Vazio = qualquer dia. */
  janelaDias: smallint('janela_dias').array().notNull().default(sql`'{}'`),
  /** 'HH:MM:SS' no fuso da conta. `time`, não instante: a regra é "das 9 às 20 todo dia". */
  janelaInicio: time('janela_inicio'),
  janelaFim: time('janela_fim'),
  pausaSegundos: integer('pausa_segundos').notNull().default(0),
  maxPorDia: integer('max_por_dia'),
  maxPorSemana: integer('max_por_semana'),
  maxPorMes: integer('max_por_mes'),
  /**
   * Por que está pausada: conexao | teto_plano | inadimplencia | manual | modelo
   * (a Meta recusou o modelo, ou o arquivo dele sumiu — migration 037) |
   * conta_meta (a Meta recusou por um problema da conta ou do número:
   * pagamento, restrição, registro — migration 038). Nulo quando não está.
   */
  pausaMotivo: text('pausa_motivo'),
  /** O código da Meta que pausou a campanha (modelo, conta_meta ou conexao); nulo nas outras pausas. */
  pausaErroCodigo: integer('pausa_erro_codigo'),
  /** A frase da Meta, crua, do erro que pausou — dela sai o endereço para resolver. */
  pausaErroMeta: text('pausa_erro_meta'),
  /**
   * O que o modelo exige no envio além das variáveis do corpo, com os valores
   * já resolvidos (`meta/envio.regras.ts`, migration 037). Foto tirada ao criar
   * a campanha. Nulo = só o corpo.
   */
  envio: jsonb('envio'),
  /** Lista de contatos de onde saiu o público (migration 017). Nulo = números digitados. */
  listaId: uuid('lista_id'),
  /** Campanha encerrada que o cliente tirou da lista (migration 018). O histórico fica. */
  arquivadaEm: timestamp('arquivada_em', { withTimezone: true }),
  /**
   * Até quando esperar porque a Meta pediu calma (130429, 80007). Não é pausa:
   * a campanha segue ativa e o worker só a pula até lá (migration 027).
   */
  retomarEm: timestamp('retomar_em', { withTimezone: true }),
  /** Descanso desta campanha, copiado da conta ao criar; nulo = sem descanso (migration 031). */
  descansoDias: integer('descanso_dias'),
  /** De onde saiu o público (migration 033): lista | numeros | base | importacao | perfil | publico | regiao. */
  publicoOrigem: text('publico_origem'),
  /** O nome do público no cartão ("Toda a base", "Pedem à noite"…); nulo para lista e números. */
  publicoRotulo: text('publico_rotulo'),
  /**
   * De onde sai cada variável, em ordem (migration 034): `[{ origem, valor }]`.
   * A conferência do cashback na hora do envio usa. Nulo = números digitados
   * ou campanha anterior à 034.
   */
  variaveisLista: jsonb('variaveis_lista'),
  iniciadaEm: timestamp('iniciada_em', { withTimezone: true }),
  concluidaEm: timestamp('concluida_em', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contaIdx: index('idx_campanha_conta').on(t.contaId, t.criadoEm),
}));

/**
 * Um destinatário da campanha, e o que de fato aconteceu com a mensagem dele.
 *
 * `waMessageId` (o `wamid`) é a peça central: é por ele que o webhook de status
 * encontra esta linha. Sem ele, "enviada" nunca vira "entregue" nem "falhou", e
 * a campanha mente. É o defeito que o Regem tem hoje.
 *
 * Sem contador agregado na campanha, de propósito: contador denormalizado tem
 * que ser mantido no envio E no webhook, e o dia em que um dos dois falha o
 * número na tela mente sem ninguém perceber. Contar daqui é sempre verdade.
 */
export const campanhaDestinatario = pgTable('campanha_destinatario', {
  id: uuid('id').primaryKey().defaultRandom(),
  contaId: uuid('conta_id').notNull(),
  campanhaId: uuid('campanha_id').notNull(),
  /** E.164 sem o '+': país + DDD + número, só dígitos. */
  telefoneE164: text('telefone_e164').notNull(),
  /** Valores das variáveis, em ordem: o primeiro item é `{{1}}`. */
  variaveis: jsonb('variaveis').notNull().default(sql`'[]'::jsonb`),
  status: text('status').notNull().default('pendente'),
  waMessageId: text('wa_message_id'),
  erroCodigo: integer('erro_codigo'),
  erroTitulo: text('erro_titulo'),
  erroDetalhe: text('erro_detalhe'),
  /** A frase da Meta, crua (migration 038). A explicação da tela sai do catálogo, pelo código. */
  erroMeta: text('erro_meta'),
  enviadaEm: timestamp('enviada_em', { withTimezone: true }),
  entregueEm: timestamp('entregue_em', { withTimezone: true }),
  lidaEm: timestamp('lida_em', { withTimezone: true }),
  falhouEm: timestamp('falhou_em', { withTimezone: true }),
  /** Quantas vezes a Meta recusou por ritmo ou instabilidade e voltamos a tentar (migration 027). */
  tentativas: smallint('tentativas').notNull().default(0),
  /** Não reenviar antes disto. Nulo = pode sair já (migration 027). */
  proximaTentativaEm: timestamp('proxima_tentativa_em', { withTimezone: true }),
  /** A pessoa respondeu a esta mensagem (migration 031). Só o fato; o texto não é guardado. */
  respondidaEm: timestamp('respondida_em', { withTimezone: true }),
  /**
   * O `pricing.type` do aviso da Meta (migration 036): `regular` = cobrada, na
   * entrega (status `entregue` ou `lida`); `free_*` = de graça. Nulo = a Meta
   * ainda não disse. Valor da Meta, guardado como veio (`meta/tarifa.regras.ts`).
   */
  tarifaTipo: text('tarifa_tipo'),
  /** O `pricing.category` do aviso da Meta (migration 036): a tabela de preço em que a mensagem caiu. */
  tarifaCategoria: text('tarifa_categoria'),
  /** O valor da variável do título para esta pessoa, resolvido na montagem (migration 037). */
  variavelCabecalho: text('variavel_cabecalho'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  unicoUq: uniqueIndex('idx_campanha_destinatario_unico').on(t.campanhaId, t.telefoneE164),
  enviadaIdx: index('idx_campanha_destinatario_enviada')
    .on(t.contaId, t.enviadaEm)
    .where(sql`enviada_em is not null`),
  statusIdx: index('idx_campanha_destinatario_status').on(t.campanhaId, t.status),
  wamidUq: uniqueIndex('idx_campanha_destinatario_wamid')
    .on(t.waMessageId)
    .where(sql`wa_message_id is not null`),
}));

/**
 * Um público. É o que a campanha escolhe no lugar de uma caixa de texto.
 *
 * Lista é coleção explícita, e não filtro salvo, porque o cliente precisa saber
 * exatamente quem vai receber antes de disparar. Filtro salvo muda de tamanho
 * sozinho entre a conferência e o envio — e a conta da Meta chega maior.
 */
export const contatoLista = pgTable('contato_lista', {
  id: uuid('id').primaryKey().defaultRandom(),
  contaId: uuid('conta_id').notNull(),
  nome: text('nome').notNull(),
  descricao: text('descricao'),
  /** O bloco é uma lista comum, marcada com a divisão de onde saiu (migration 028). */
  divisaoId: uuid('divisao_id'),
  /** Posição do bloco na divisão, de 1 em diante. Nulo fora de divisão. */
  bloco: integer('bloco'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contaIdx: index('idx_contato_lista_conta').on(t.contaId, t.criadoEm),
  divisaoIdx: index('idx_contato_lista_divisao').on(t.divisaoId, t.bloco).where(sql`divisao_id is not null`),
}));

/**
 * A base dividida em blocos (migration 028). Cada bloco é uma `contato_lista`
 * com `divisao_id` e `bloco`; aqui fica de onde os blocos saíram e com que
 * regra. É uma foto do momento da divisão.
 */
export const listaDivisao = pgTable('lista_divisao', {
  id: uuid('id').primaryKey().defaultRandom(),
  contaId: uuid('conta_id').notNull(),
  nome: text('nome').notNull(),
  /** lista | importacao | base | perfil | regiao */
  origem: text('origem').notNull(),
  origemId: uuid('origem_id'),
  origemRotulo: text('origem_rotulo'),
  tamanho: integer('tamanho').notNull(),
  /** importacao | sorteio | recentes | regiao | valor */
  ordem: text('ordem').notNull(),
  soNuncaReceberam: boolean('so_nunca_receberam').notNull().default(false),
  totalContatos: integer('total_contatos').notNull(),
  totalBlocos: integer('total_blocos').notNull(),
  criadaPor: uuid('criada_por'),
  criadaEm: timestamp('criada_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contaIdx: index('idx_lista_divisao_conta').on(t.contaId, t.criadaEm),
}));

/**
 * O registro de cada importação, com os totais como foram NO DIA.
 *
 * Recontar depois dá outro número, porque a base muda — e a pergunta "de onde
 * veio este contato?" precisa ter resposta.
 */
export const importacao = pgTable('importacao', {
  id: uuid('id').primaryKey().defaultRandom(),
  contaId: uuid('conta_id').notNull(),
  /** vcard | csv | xlsx | texto */
  formato: text('formato').notNull(),
  arquivoNome: text('arquivo_nome'),
  totalLidos: integer('total_lidos').notNull().default(0),
  validos: integer('validos').notNull().default(0),
  invalidos: integer('invalidos').notNull().default(0),
  novos: integer('novos').notNull().default(0),
  jaExistiam: integer('ja_existiam').notNull().default(0),
  listaId: uuid('lista_id'),
  criadoPor: uuid('criado_por'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contaIdx: index('idx_importacao_conta').on(t.contaId, t.criadoEm),
}));

/**
 * Uma pessoa que pode receber mensagem desta conta.
 *
 * `optOut` mora aqui, na mesma linha, de propósito: na auditoria do Regem o
 * descadastro ficava em tabela separada e NÃO barrava o envio, porque o disparo
 * lia a base e nunca cruzava com a lista de saída. Juntos, esquecer de cruzar
 * deixa de ser possível.
 */
export const contato = pgTable('contato', {
  id: uuid('id').primaryKey().defaultRandom(),
  contaId: uuid('conta_id').notNull(),
  /** E.164 sem o '+', COM o código do país — o formato que a Cloud API aceita. */
  telefoneE164: text('telefone_e164').notNull(),
  nome: text('nome'),
  /** declarado | formulario | conversa | api */
  consentimentoOrigem: text('consentimento_origem'),
  consentimentoEm: timestamp('consentimento_em', { withTimezone: true }),
  consentimentoEvidencia: text('consentimento_evidencia'),
  optOut: boolean('opt_out').notNull().default(false),
  optOutEm: timestamp('opt_out_em', { withTimezone: true }),
  optOutOrigem: text('opt_out_origem'),
  importacaoId: uuid('importacao_id'),
  // ---- migration 021: o que veio do sistema da loja
  email: text('email'),
  dataNascimento: text('data_nascimento'),
  pedidos: integer('pedidos'),
  totalGastoCentavos: bigint('total_gasto_centavos', { mode: 'number' }),
  ultimoPedidoEm: timestamp('ultimo_pedido_em', { withTimezone: true }),
  /** A primeira compra conhecida (migration 029). */
  primeiroPedidoEm: timestamp('primeiro_pedido_em', { withTimezone: true }),
  /** O bairro mais frequente nas entregas (migration 030). Dado pessoal. */
  bairro: text('bairro'),
  /** entrega | retirada | salao — o que mais faz nas compras (migration 030). */
  tipoPreferido: text('tipo_preferido'),
  /** madrugada | cafe | almoco | tarde | noite — quando mais compra, no fuso da conta (migration 032). */
  periodoPreferido: text('periodo_preferido'),
  /** A Meta recusou o número (131026) em duas campanhas (migration 031). */
  semWhatsappEm: timestamp('sem_whatsapp_em', { withTimezone: true }),
  /** "Tentar de novo": só as falhas depois disto contam (migration 031). */
  semWhatsappLiberadoEm: timestamp('sem_whatsapp_liberado_em', { withTimezone: true }),
  /** Saldo de cashback no Cardápio Web, em centavos; nulo = nunca lido (migration 034). */
  cashbackCentavos: integer('cashback_centavos'),
  /** Dia em que o cashback vence (`AAAA-MM-DD`); nulo = sem data (migration 034). */
  cashbackVenceEm: date('cashback_vence_em'),
  /** Quando o saldo foi lido do Cardápio Web (migration 034). */
  cashbackEm: timestamp('cashback_em', { withTimezone: true }),
  metricasEm: timestamp('metricas_em', { withTimezone: true }),
  metricasOrigem: text('metricas_origem'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  unicoUq: uniqueIndex('idx_contato_unico').on(t.contaId, t.telefoneE164),
  contaIdx: index('idx_contato_conta').on(t.contaId, t.criadoEm),
  elegivelIdx: index('idx_contato_elegivel').on(t.contaId).where(sql`opt_out = false`),
  /** Só quem tem saldo de cashback (migration 034): os públicos de cashback e a coluna da tela. */
  cashbackIdx: index('idx_contato_cashback').on(t.contaId, t.cashbackVenceEm).where(sql`cashback_centavos > 0`),
}));

/** Quem está em qual lista. `contaId` próprio para a RLS não precisar de junção. */
export const contatoListaItem = pgTable('contato_lista_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  contaId: uuid('conta_id').notNull(),
  listaId: uuid('lista_id').notNull(),
  contatoId: uuid('contato_id').notNull(),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  unicoUq: uniqueIndex('idx_contato_lista_item_unico').on(t.listaId, t.contatoId),
  listaIdx: index('idx_contato_lista_item_lista').on(t.contaId, t.listaId),
  contatoIdx: index('idx_contato_lista_item_contato').on(t.contaId, t.contatoId),
}));

/**
 * Modelo de mensagem: o que o cliente escreve, e o que a Meta respondeu.
 *
 * Três colunas existem por motivos que só aparecem depois:
 *
 * - `status = 'rascunho'` — um modelo leva minutos para escrever e a Meta o
 *   recusa por detalhe. Sem rascunho, cada recusa apaga o trabalho.
 * - `motivo` — a Meta diz por que recusou UMA vez, na resposta do POST. Quem
 *   não grava naquele instante nunca mais sabe, e o cliente tenta às cegas.
 * - `categoriaMeta` — ela RECLASSIFICA marketing disfarçado de utilidade, e o
 *   preço muda junto. Guardamos o que pedimos e o que ela devolveu.
 */
export const modelo = pgTable('modelo', {
  id: uuid('id').primaryKey().defaultRandom(),
  contaId: uuid('conta_id').notNull(),
  /** simples | carrossel. Carrossel não tem cabeçalho, rodapé nem oferta. */
  tipo: text('tipo').notNull().default('simples'),
  /** Nome técnico da Meta: minúsculas, números e '_'. */
  nome: text('nome').notNull(),
  idioma: text('idioma').notNull().default('pt_BR'),
  /** O que pedimos: MARKETING | UTILITY | AUTHENTICATION. */
  categoria: text('categoria').notNull().default('MARKETING'),
  /** O que a Meta devolveu, quando reclassificou. */
  categoriaMeta: text('categoria_meta'),
  /** TEXT | IMAGE | VIDEO | DOCUMENT. Nulo = sem cabeçalho. */
  cabecalhoFormato: text('cabecalho_formato'),
  cabecalhoTexto: text('cabecalho_texto'),
  /** Vai para a Meta como array SIMPLES; o corpo usa array ANINHADO. */
  cabecalhoExemplo: text('cabecalho_exemplo'),
  cabecalhoMidia: text('cabecalho_midia'),
  corpo: text('corpo').notNull(),
  /** Exemplos das variáveis, em ordem: o primeiro item é `{{1}}`. */
  corpoExemplos: jsonb('corpo_exemplos').notNull().default(sql`'[]'::jsonb`),
  rodape: text('rodape'),
  botoes: jsonb('botoes').notNull().default(sql`'[]'::jsonb`),
  /** Oferta por tempo limitado: só MARKETING, e proíbe rodapé e cabeçalho de texto. */
  ltoAtivo: boolean('lto_ativo').notNull().default(false),
  ltoTexto: text('lto_texto'),
  /** Por quantas horas a oferta vale depois de enviada (migration 037). Nulo = 3. */
  ltoHoras: integer('lto_horas'),
  /** Os cartões do carrossel, em ordem: { imagem, corpo, botoes[] }. */
  cartoes: jsonb('cartoes').notNull().default(sql`'[]'::jsonb`),
  status: text('status').notNull().default('rascunho'),
  motivo: text('motivo'),
  metaTemplateId: text('meta_template_id'),
  /** Quando a última edição foi aceita pela Meta (migration 018). Ela aceita 1 a cada 24h. */
  editadoMetaEm: timestamp('editado_meta_em', { withTimezone: true }),
  criadoPor: uuid('criado_por'),
  /** O produto que criou o rascunho pela porta MCP (migration 045); nulo = uma pessoa, na tela. */
  integracaoProduto: text('integracao_produto'),
  enviadoEm: timestamp('enviado_em', { withTimezone: true }),
  respondidoEm: timestamp('respondido_em', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  unicoUq: uniqueIndex('idx_modelo_unico').on(t.contaId, t.nome, t.idioma),
  contaIdx: index('idx_modelo_conta').on(t.contaId, t.criadoEm),
  metaIdUq: uniqueIndex('idx_modelo_meta_id')
    .on(t.metaTemplateId)
    .where(sql`meta_template_id is not null`),
}));

/**
 * `bytea` do Postgres. O Drizzle não traz o tipo pronto no pg-core; sem ele o
 * binário viraria texto e cada byte fora do ASCII seria corrompido na volta.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * Arquivo enviado pelo cliente para cabeçalho de modelo.
 *
 * A Meta NÃO busca a URL da mídia de um modelo — ela recebe os bytes e devolve
 * um `header_handle`. Por isso o arquivo precisa ficar guardado aqui até a
 * submissão, e o handle fica junto para reenviar sem subir de novo.
 */
export const midia = pgTable('midia', {
  id: uuid('id').primaryKey().defaultRandom(),
  contaId: uuid('conta_id').notNull(),
  nomeArquivo: text('nome_arquivo').notNull(),
  tipoMime: text('tipo_mime').notNull(),
  tamanhoBytes: integer('tamanho_bytes').notNull(),
  /** Os bytes. Podem ser expurgados depois que `metaHandle` existe. */
  conteudo: bytea('conteudo'),
  metaHandle: text('meta_handle'),
  metaHandleEm: timestamp('meta_handle_em', { withTimezone: true }),
  criadoPor: uuid('criado_por'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contaIdx: index('idx_midia_conta').on(t.contaId, t.criadoEm),
}));

/**
 * A mídia do modelo já entregue à Meta para ENVIO (migration 037).
 *
 * Mandar um modelo com imagem exige o id que a Meta devolve em
 * `POST /{numero}/media` — outro caminho, e outro id, que o `header_handle` da
 * criação do modelo. O id vale 30 dias e é de quem subiu: fica guardado por
 * número, para a campanha subir o arquivo uma vez e não uma por destinatário.
 */
export const midiaEnvio = pgTable('midia_envio', {
  id: uuid('id').primaryKey().defaultRandom(),
  contaId: uuid('conta_id').notNull(),
  midiaId: uuid('midia_id').notNull(),
  phoneNumberId: text('phone_number_id').notNull(),
  mediaId: text('media_id').notNull(),
  expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  unicoUq: uniqueIndex('idx_midia_envio_unico').on(t.midiaId, t.phoneNumberId),
}));

/**
 * Limites da classificação da base (migration 022). Sem linha = padrão
 * (30/90/180 dias, 5 pedidos). O perfil é calculado, nunca gravado.
 */
export const segmentacaoParametros = pgTable('segmentacao_parametros', {
  contaId: uuid('conta_id').primaryKey(),
  recenteDias: integer('recente_dias').notNull().default(30),
  ativoDias: integer('ativo_dias').notNull().default(90),
  riscoDias: integer('risco_dias').notNull().default(180),
  fielPedidos: integer('fiel_pedidos').notNull().default(5),
  atualizadoPor: uuid('atualizado_por'),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Conexão com a loja do Cardápio Web (migration 020). Uma por conta. A
 * credencial fica cifrada com INTEGRACOES_CHAVE; o andamento da importação da
 * base de clientes fica aqui para continuar de onde parou após um reinício.
 */
export const integracaoCardapioweb = pgTable('integracao_cardapioweb', {
  id: uuid('id').primaryKey().defaultRandom(),
  contaId: uuid('conta_id').notNull(),
  /** chave (X-API-KEY, legado) | oauth (CW App Store) */
  modo: text('modo').notNull().default('chave'),
  ambiente: text('ambiente').notNull().default('producao'),
  credencialCifrada: text('credencial_cifrada'),
  refreshCifrado: text('refresh_cifrado'),
  tokenExpiraEm: timestamp('token_expira_em', { withTimezone: true }),
  lojaId: text('loja_id'),
  lojaNome: text('loja_nome'),
  /** parada | rodando | concluida | falhou */
  sincStatus: text('sinc_status').notNull().default('parada'),
  sincPagina: integer('sinc_pagina').notNull().default(0),
  sincTotalPaginas: integer('sinc_total_paginas'),
  sincLidos: integer('sinc_lidos').notNull().default(0),
  sincNovos: integer('sinc_novos').notNull().default(0),
  sincBloqueados: integer('sinc_bloqueados').notNull().default(0),
  sincInvalidos: integer('sinc_invalidos').notNull().default(0),
  sincIniciadaEm: timestamp('sinc_iniciada_em', { withTimezone: true }),
  sincConcluidaEm: timestamp('sinc_concluida_em', { withTimezone: true }),
  sincErro: text('sinc_erro'),
  listaId: uuid('lista_id'),
  importacaoId: uuid('importacao_id'),
  consentimentoPor: uuid('consentimento_por'),
  consentimentoEm: timestamp('consentimento_em', { withTimezone: true }),
  // ---- sincronização de pedidos (migration 029)
  /** parado | carga (histórico) | em_dia (consulta periódica) | falhou */
  pedidosStatus: text('pedidos_status').notNull().default('parado'),
  pedidosCargaDe: timestamp('pedidos_carga_de', { withTimezone: true }),
  pedidosCargaAte: timestamp('pedidos_carga_ate', { withTimezone: true }),
  pedidosJanelaDe: timestamp('pedidos_janela_de', { withTimezone: true }),
  pedidosPagina: integer('pedidos_pagina').notNull().default(0),
  pedidosTotalEstimado: integer('pedidos_total_estimado'),
  pedidosLidos: integer('pedidos_lidos').notNull().default(0),
  pedidosGravados: integer('pedidos_gravados').notNull().default(0),
  pedidosIgnorados: integer('pedidos_ignorados').notNull().default(0),
  pedidosUltimaConsulta: timestamp('pedidos_ultima_consulta', { withTimezone: true }),
  pedidosTravaAte: timestamp('pedidos_trava_ate', { withTimezone: true }),
  pedidosProximoEm: timestamp('pedidos_proximo_em', { withTimezone: true }),
  pedidosErro: text('pedidos_erro'),
  pedidosAtualizadoEm: timestamp('pedidos_atualizado_em', { withTimezone: true }),
  // ---- leitura diária do cashback (migration 034)
  /** A última página lida; 0 = parada (a próxima leitura começa do início). */
  saldosPagina: integer('saldos_pagina').notNull().default(0),
  saldosIniciadaEm: timestamp('saldos_iniciada_em', { withTimezone: true }),
  /** Quando a próxima leitura pode sair (4h no fuso da conta, ou a nova tentativa); nulo = assim que der. */
  saldosProximaEm: timestamp('saldos_proxima_em', { withTimezone: true }),
  saldosTravaAte: timestamp('saldos_trava_ate', { withTimezone: true }),
  saldosConcluidaEm: timestamp('saldos_concluida_em', { withTimezone: true }),
  saldosErro: text('saldos_erro'),
  saldosAtualizadoEm: timestamp('saldos_atualizado_em', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A conexão com a empresa no Regem (migration 035): o token da API de
 * integração, cifrado, ligado pela distribuição; a autorização da 99 do dono;
 * e o andamento de clientes e vendas, cada um pelo seu cursor.
 */
export const integracaoRegem = pgTable('integracao_regem', {
  id: uuid('id').primaryKey().defaultRandom(),
  contaId: uuid('conta_id').notNull(),
  credencialCifrada: text('credencial_cifrada'),
  empresaId: text('empresa_id'),
  empresaNome: text('empresa_nome'),
  /** `[{ id, nome }]` — as lojas da empresa que o token abre. */
  lojas: jsonb('lojas').notNull().default(sql`'[]'::jsonb`),
  escopos: text('escopos').array().notNull().default(sql`'{}'`),
  ligadaEm: timestamp('ligada_em', { withTimezone: true }),
  /** Quem ligou pela distribuição (e-mail do operador). */
  ligadaPor: text('ligada_por'),
  incluir99: boolean('incluir_99').notNull().default(false),
  autorizacao99Por: uuid('autorizacao_99_por'),
  autorizacao99Em: timestamp('autorizacao_99_em', { withTimezone: true }),
  autorizacao99Texto: text('autorizacao_99_texto'),
  consentimentoPor: uuid('consentimento_por'),
  consentimentoEm: timestamp('consentimento_em', { withTimezone: true }),
  consentimentoEvidencia: text('consentimento_evidencia'),
  listaId: uuid('lista_id'),
  importacaoId: uuid('importacao_id'),
  /** parado | carga | em_dia | falhou */
  clientesStatus: text('clientes_status').notNull().default('parado'),
  clientesCursor: text('clientes_cursor'),
  clientesLidos: integer('clientes_lidos').notNull().default(0),
  clientesNovos: integer('clientes_novos').notNull().default(0),
  clientesBloqueados: integer('clientes_bloqueados').notNull().default(0),
  clientesIgnorados: integer('clientes_ignorados').notNull().default(0),
  clientesInvalidos: integer('clientes_invalidos').notNull().default(0),
  clientesRemovidos: integer('clientes_removidos').notNull().default(0),
  clientesUltimaConsulta: timestamp('clientes_ultima_consulta', { withTimezone: true }),
  clientesErro: text('clientes_erro'),
  /** parado | carga | em_dia | falhou */
  pedidosStatus: text('pedidos_status').notNull().default('parado'),
  pedidosCursor: text('pedidos_cursor'),
  pedidosLidos: integer('pedidos_lidos').notNull().default(0),
  pedidosGravados: integer('pedidos_gravados').notNull().default(0),
  pedidosIgnorados: integer('pedidos_ignorados').notNull().default(0),
  pedidosUltimaConsulta: timestamp('pedidos_ultima_consulta', { withTimezone: true }),
  pedidosErro: text('pedidos_erro'),
  travaAte: timestamp('trava_ate', { withTimezone: true }),
  proximoEm: timestamp('proximo_em', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

/** O cliente do Regem ligado ao contato (migration 035). */
export const integracaoRegemCliente = pgTable(
  'integracao_regem_cliente',
  {
    contaId: uuid('conta_id').notNull(),
    regemId: text('regem_id').notNull(),
    contatoId: uuid('contato_id'),
    telefoneE164: text('telefone_e164'),
    canais: text('canais').array().notNull().default(sql`'{}'`),
    /** Entrou na base só pela 99, por esta conexão: sai se a autorização for desfeita. */
    so99: boolean('so_99').notNull().default(false),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.contaId, t.regemId] }) }),
);

/**
 * O resumo de cada compra trazida de uma integração (migration 029) — só para
 * segmentar. Os totais do contato (`pedidos`, `totalGastoCentavos`,
 * `primeiroPedidoEm`, `ultimoPedidoEm`) saem daqui a cada sincronização.
 */
export const compra = pgTable('compra', {
  id: uuid('id').primaryKey().defaultRandom(),
  contaId: uuid('conta_id').notNull(),
  contatoId: uuid('contato_id').notNull(),
  /** cardapioweb | regem */
  fonte: text('fonte').notNull(),
  idExterno: text('id_externo').notNull(),
  feitaEm: timestamp('feita_em', { withTimezone: true }).notNull(),
  valorCentavos: bigint('valor_centavos', { mode: 'number' }).notNull(),
  /** entrega | retirada | salao | outro */
  tipo: text('tipo').notNull().default('outro'),
  canal: text('canal'),
  bairro: text('bairro'),
  /** [{ n: nome, q: quantidade, v: centavos }] */
  itens: jsonb('itens').notNull().default(sql`'[]'::jsonb`),
  atualizadaNaFonte: timestamp('atualizada_na_fonte', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  externaUq: uniqueIndex('idx_compra_externa').on(t.contaId, t.fonte, t.idExterno),
  contatoIdx: index('idx_compra_contato').on(t.contatoId, t.feitaEm),
  dataIdx: index('idx_compra_conta_data').on(t.contaId, t.feitaEm),
}));

/**
 * Os produtos que cada contato já comprou (migration 032), tirados das compras
 * e refeitos junto com os totais (`contato/habitos.ts`). `chave` é o nome em
 * minúsculas; `nome`, a grafia que o contato mais comprou. Só para segmentar.
 */
export const contatoProduto = pgTable('contato_produto', {
  contaId: uuid('conta_id').notNull(),
  contatoId: uuid('contato_id').notNull(),
  chave: text('chave').notNull(),
  nome: text('nome').notNull(),
  compras: integer('compras').notNull(),
  ultimaEm: timestamp('ultima_em', { withTimezone: true }).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.contatoId, t.chave] }),
  chaveIdx: index('idx_contato_produto_chave').on(t.contaId, t.chave),
}));

/**
 * Celular com o app Android logado (migration 019). `tokenFcm` é o endereço do
 * push e é único na base inteira: o aparelho pode trocar de conta.
 */
export const dispositivo = pgTable('dispositivo', {
  id: uuid('id').primaryKey().defaultRandom(),
  contaId: uuid('conta_id').notNull(),
  usuarioId: uuid('usuario_id').notNull(),
  tokenFcm: text('token_fcm').notNull(),
  plataforma: text('plataforma').notNull().default('android'),
  appVersao: text('app_versao'),
  modelo: text('modelo'),
  /** O que este aparelho recebe: `{ campanhas, modelos, cobranca }`. Ausente = ligado. */
  avisos: jsonb('avisos').notNull().default(sql`'{"campanhas": true, "modelos": true, "cobranca": true}'::jsonb`),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  vistoEm: timestamp('visto_em', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Telemetria de erro. Escopo de DISTRIBUIÇÃO: o cliente nunca lê esta tabela
 * (a policy é `rc_sistema`). O `contaId` serve para agrupar, não dá acesso.
 */
export const eventoErro = pgTable('evento_erro', {
  id: uuid('id').primaryKey().defaultRandom(),
  contaId: uuid('conta_id'),
  referencia: text('referencia'),
  rota: text('rota'),
  metodo: text('metodo'),
  status: integer('status'),
  /** api | meta | banco | fila | webhook */
  origem: text('origem').notNull().default('api'),
  classe: text('classe'),
  codigo: integer('codigo'),
  /** Mensagem técnica — nunca a traduzida ao cliente. */
  mensagem: text('mensagem'),
  /** Sem telefone inteiro, sem token, sem corpo de mensagem. */
  detalhe: jsonb('detalhe').notNull().default(sql`'{}'::jsonb`),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tempoIdx: index('idx_evento_erro_tempo').on(t.criadoEm),
}));

/**
 * Operador da distribuição: login próprio, separado dos clientes, com
 * verificação em duas etapas obrigatória. Escopo de SISTEMA.
 */
export const operadorDistribuicao = pgTable('operador_distribuicao', {
  id: uuid('id').primaryKey().defaultRandom(),
  nome: text('nome').notNull(),
  email: text('email').notNull(),
  senhaHash: text('senha_hash').notNull(),
  /** Cifrado com DIST_TOTP_CHAVE. Em claro, quem lê o banco gera os códigos. */
  totpSegredoCifrado: text('totp_segredo_cifrado'),
  /** Só vira verdade depois que o operador confirma um código válido. */
  totpAtivo: boolean('totp_ativo').notNull().default(false),
  /** Último passo (30s) aceito do app: código do mesmo passo ou anterior é recusado (migration 017). */
  totpUltimoPasso: bigint('totp_ultimo_passo', { mode: 'number' }),
  status: text('status').notNull().default('ativo'),
  tokenVersao: integer('token_versao').notNull().default(1),
  tentativasFalhas: integer('tentativas_falhas').notNull().default(0),
  bloqueadoAte: timestamp('bloqueado_ate', { withTimezone: true }),
  ultimoLoginEm: timestamp('ultimo_login_em', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

/** O que cada operador viu ou fez. Append-only — o banco recusa update e delete. */
export const acessoDistribuicao = pgTable('acesso_distribuicao', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  operadorId: uuid('operador_id'),
  operadorNome: text('operador_nome'),
  acao: text('acao').notNull(),
  contaId: uuid('conta_id'),
  detalhe: jsonb('detalhe').notNull().default(sql`'{}'::jsonb`),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Códigos de 6 dígitos enviados por e-mail (migration 014). Só o HMAC do código.
 * Escopo de SISTEMA: conferido antes de existir sessão.
 */
export const codigoVerificacao = pgTable('codigo_verificacao', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** convite | login | ativar_email */
  finalidade: text('finalidade').notNull(),
  email: text('email').notNull(),
  usuarioId: uuid('usuario_id').references(() => usuario.id, { onDelete: 'cascade' }),
  listaEsperaId: uuid('lista_espera_id').references(() => listaEspera.id, { onDelete: 'cascade' }),
  codigoHash: text('codigo_hash').notNull(),
  tentativas: integer('tentativas').notNull().default(0),
  expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
  usadoEm: timestamp('usado_em', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailIdx: index('idx_codigo_verificacao_email').on(t.finalidade, t.email, t.criadoEm),
}));

/**
 * Conversa do WhatsApp: número da empresa × pessoa (migration 024).
 *
 * Só existe para número em coexistência cujo dono respondeu "sim" sobre
 * trazer contatos e conversas. `telefoneE164` no formato do `contato` (com o
 * 9º dígito), e os totais (última mensagem, não lidas, janela de 24h) são
 * mantidos pelo código, uma vez por lote — sem gatilho.
 */
export const conversa = pgTable('conversa', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  contaId: uuid('conta_id').notNull().references(() => conta.id, { onDelete: 'cascade' }),
  waNumeroId: uuid('wa_numero_id').notNull().references(() => waNumero.id, { onDelete: 'cascade' }),
  telefoneE164: text('telefone_e164').notNull(),
  nomePerfil: text('nome_perfil'),
  ultimaMensagemEm: timestamp('ultima_mensagem_em', { withTimezone: true }),
  ultimaMensagem: text('ultima_mensagem'),
  /** Última mensagem DO CLIENTE: a janela de 24h de texto livre conta daqui. */
  ultimaEntradaEm: timestamp('ultima_entrada_em', { withTimezone: true }),
  naoLidas: integer('nao_lidas').notNull().default(0),
  lidaEm: timestamp('lida_em', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  numeroTelefoneUq: uniqueIndex('conversa_numero_telefone_uq').on(t.waNumeroId, t.telefoneE164),
  listaIdx: index('conversa_lista_idx').on(t.contaId, t.ultimaMensagemEm),
}));

/**
 * Uma mensagem de uma conversa (migration 024).
 *
 * `wamid` único por conta: a Meta reentrega o webhook, e o histórico pode
 * repetir o que chegou ao vivo. `criadaEm` é a data ORIGINAL da mensagem.
 */
export const mensagem = pgTable('mensagem', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  contaId: uuid('conta_id').notNull().references(() => conta.id, { onDelete: 'cascade' }),
  conversaId: uuid('conversa_id').notNull().references(() => conversa.id, { onDelete: 'cascade' }),
  wamid: text('wamid').notNull(),
  /** entrada | saida */
  direcao: text('direcao').notNull(),
  /** cliente | celular | painel | historico | campanha */
  origem: text('origem').notNull(),
  tipo: text('tipo').notNull().default('text'),
  texto: text('texto'),
  midiaId: text('midia_id'),
  midiaMime: text('midia_mime'),
  midiaNome: text('midia_nome'),
  /** Só saída: enviando | enviada | entregue | lida | falhou */
  status: text('status'),
  erroCodigo: integer('erro_codigo'),
  erroTitulo: text('erro_titulo'),
  enviadaPor: uuid('enviada_por').references(() => usuario.id, { onDelete: 'set null' }),
  criadaEm: timestamp('criada_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  wamidUq: uniqueIndex('mensagem_wamid_uq').on(t.contaId, t.wamid),
  conversaIdx: index('mensagem_conversa_idx').on(t.conversaId, t.criadaEm),
  retencaoIdx: index('mensagem_retencao_idx').on(t.contaId, t.criadaEm),
}));

/**
 * Mensagem que chegou com a origem de um anúncio de clique para o WhatsApp
 * (migration 044). Só a origem, o momento e o telefone — nenhum conteúdo. Só é
 * escrita enquanto a conta tem aplicativo conectado com a permissão
 * `conversas.anuncio.ler`, e sai depois de 180 dias. Regras em
 * `meta/anuncio.regras.ts`.
 */
export const conversaAnuncio = pgTable('conversa_anuncio', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  contaId: uuid('conta_id').notNull().references(() => conta.id, { onDelete: 'cascade' }),
  waNumeroId: uuid('wa_numero_id').notNull().references(() => waNumero.id, { onDelete: 'cascade' }),
  /** Quem escreveu, no formato do `contato` (só dígitos, com o 55 e o 9º dígito). */
  telefoneE164: text('telefone_e164').notNull(),
  wamid: text('wamid').notNull(),
  abertaEm: timestamp('aberta_em', { withTimezone: true }).notNull(),
  /** `ad` ou `post`, como a Meta manda. */
  origemTipo: text('origem_tipo').notNull(),
  origemId: text('origem_id').notNull(),
  ctwaClid: text('ctwa_clid'),
  origemUrl: text('origem_url'),
  /** Quando a linha entrou: ordena a leitura com cursor e conta o prazo de guarda. */
  registradoEm: timestamp('registrado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  wamidUq: uniqueIndex('idx_conversa_anuncio_wamid').on(t.contaId, t.wamid),
  cursorIdx: index('idx_conversa_anuncio_cursor').on(t.contaId, t.registradoEm, t.id),
  prazoIdx: index('idx_conversa_anuncio_prazo').on(t.registradoEm),
}));

/**
 * Chave de idempotência das ferramentas de escrita da porta MCP (migration
 * 045). A linha nasce na transação da ação e guarda a resposta dela; a mesma
 * chave com o mesmo pedido devolve essa resposta. Sai depois de 24 horas.
 */
export const integracaoIdempotencia = pgTable('integracao_idempotencia', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  contaId: uuid('conta_id').notNull().references(() => conta.id, { onDelete: 'cascade' }),
  tokenId: uuid('token_id').notNull().references(() => integracaoToken.id, { onDelete: 'cascade' }),
  ferramenta: text('ferramenta').notNull(),
  chave: text('chave').notNull(),
  pedidoHash: text('pedido_hash').notNull(),
  resposta: jsonb('resposta'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  chaveUq: uniqueIndex('idx_integracao_idempotencia_chave').on(t.tokenId, t.ferramenta, t.chave),
  prazoIdx: index('idx_integracao_idempotencia_prazo').on(t.criadoEm),
}));
