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
  bigint,
  bigserial,
  boolean,
  inet,
  index,
  integer,
  jsonb,
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
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  codigoUq: uniqueIndex('plano_codigo_key').on(t.codigo),
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
  /** aprovada | ativa | suspensa | cancelada */
  status: text('status').notNull().default('aprovada'),
  planoId: uuid('plano_id').references(() => plano.id, { onDelete: 'set null' }),
  aprovadaEm: timestamp('aprovada_em', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

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
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contaUq: uniqueIndex('uq_assinatura_conta').on(t.contaId),
}));

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
  escopos: jsonb('escopos').notNull().default(sql`'[]'::jsonb`),
  /** Prazo do Brasil: toda WABA elegível precisa estar em BRL até 30/jun/2027. */
  moeda: text('moeda'),
  statusRevisao: text('status_revisao'),
  restricoes: jsonb('restricoes').notNull().default(sql`'[]'::jsonb`),
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
  enviadaEm: timestamp('enviada_em', { withTimezone: true }),
  entregueEm: timestamp('entregue_em', { withTimezone: true }),
  lidaEm: timestamp('lida_em', { withTimezone: true }),
  falhouEm: timestamp('falhou_em', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  unicoUq: uniqueIndex('idx_campanha_destinatario_unico').on(t.campanhaId, t.telefoneE164),
  statusIdx: index('idx_campanha_destinatario_status').on(t.campanhaId, t.status),
  wamidUq: uniqueIndex('idx_campanha_destinatario_wamid')
    .on(t.waMessageId)
    .where(sql`wa_message_id is not null`),
}));
