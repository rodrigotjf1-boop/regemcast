-- 003_meta_whatsapp.sql — A conta de WhatsApp de cada cliente.
--
-- Fase 1: o cliente conecta a PRÓPRIA WABA pelo Embedded Signup, e a partir daí
-- disparamos em nome dele, com a credencial dele.
--
-- A diferença central em relação ao Regem está aqui: lá existe UM
-- `WA_CLOUD_TOKEN` de ambiente que serve todas as lojas, porque a distribuição
-- é dona do app e do número. Aqui cada conta traz a própria WABA, então o token
-- é POR CONTA e fica cifrado em repouso. Sem isso, um vazamento do .env daria
-- acesso a todos os clientes de uma vez.
--
-- Idempotente. Toda tabela nasce com RLS ligada na mesma migration.

-- ---------------------------------------------------------------- wa_conta

-- A WhatsApp Business Account do cliente, como a Meta a identifica.
--
-- `waba_id` é único GLOBAL, não por conta: é o identificador da WABA do lado da
-- Meta, e duas contas do Regemcast reivindicando a mesma WABA significaria uma
-- lendo as conversas da outra. No Regem essa proteção existe só na tabela
-- legada, e o número de marketing ficou sem unique nenhum.
create table if not exists wa_conta (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references conta(id) on delete cascade,

  waba_id       text not null,
  business_id   text,
  nome          text,

  /*
   * Token de acesso do cliente, CIFRADO (AES-256-GCM).
   *
   * Formato: v1.<iv_base64>.<tag_base64>.<cifra_base64> — ver
   * backend/src/modules/meta/cripto.ts. O prefixo de versão existe para o dia
   * em que a chave for rotacionada: dá para decifrar o formato antigo e
   * regravar no novo sem adivinhar qual é qual.
   *
   * Nunca sai daqui em claro: não vai para log, não vai para resposta de API,
   * não aparece para o próprio cliente. Ele autorizou o acesso; manusear a
   * credencial é nosso.
   */
  token_cifrado text,
  token_em      timestamptz,

  /* Escopos que a Meta concedeu, como vieram. Serve para diagnosticar
   * "por que não consigo criar template nesta conta". */
  escopos       jsonb not null default '[]'::jsonb,

  /*
   * Moeda da WABA. Existe por causa do prazo do Brasil: a Meta exige que toda
   * WABA de cliente elegível esteja em BRL até 30/jun/2027, e a partir de
   * 1º/jul/2027 para de entregar mensagens das que não estiverem. WABA criada
   * hoje com Sold-To Brasil já nasce em BRL; o campo existe para enxergar quem
   * chegar trazendo conta antiga.
   */
  moeda         text,

  /* Espelho do que a Meta reporta sobre a conta: revisão e restrições. */
  status_revisao text,
  restricoes    jsonb not null default '[]'::jsonb,

  webhook_assinado_em timestamptz,
  onboardada_em timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists uq_wa_conta_waba on wa_conta (waba_id);
create index if not exists idx_wa_conta_conta on wa_conta (conta_id);
select rc_rls_conta('wa_conta');

drop trigger if exists tg_wa_conta_touch on wa_conta;
create trigger tg_wa_conta_touch before update on wa_conta
  for each row execute function rc_touch();

comment on column wa_conta.token_cifrado is
  'Token do cliente cifrado em AES-256-GCM (v1.iv.tag.cifra). Nunca em claro, nunca em log, nunca em resposta de API.';

-- ---------------------------------------------------------------- wa_numero

-- O número que dispara. `phone_number_id` é a identidade do remetente do lado
-- da Meta e é por ele que o webhook descobre de quem é cada evento — daí ser
-- único global, como o waba_id.
create table if not exists wa_numero (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references conta(id) on delete cascade,
  wa_conta_id   uuid not null references wa_conta(id) on delete cascade,

  phone_number_id text not null,
  telefone_e164 text,
  nome_exibicao text,

  /*
   * Qualidade do número, como a Meta reporta em `phone_number_quality_update`.
   * Precisa ficar VISÍVEL para o cliente: sete dias em "amarelo" derrubam o
   * tier um nível, e quem não vê isso a tempo se queima sem entender por quê.
   */
  qualidade     text not null default 'desconhecida'
                check (qualidade in ('verde','amarela','vermelha','desconhecida')),
  qualidade_em  timestamptz,

  /*
   * Teto de usuários únicos por 24h. Toda conta nova começa em 250 e sobe por
   * escalonamento. O disparo respeita ESTE número, e a tela mostra ele ao lado
   * do teto do plano — são dois limites diferentes, e o cliente precisa saber
   * qual dos dois está segurando a campanha dele.
   */
  tier_limite   integer,
  tier_nome     text,
  tier_em       timestamptz,

  /* pendente: veio do signup mas ainda não foi registrado com PIN na Cloud API.
   * Sem o registro, todo envio falha com 133010 — erro que não diz o que fazer. */
  status        text not null default 'pendente'
                check (status in ('pendente','registrado','suspenso','removido')),
  registrado_em timestamptz,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists uq_wa_numero_phone on wa_numero (phone_number_id);
create index if not exists idx_wa_numero_conta on wa_numero (conta_id);
create index if not exists idx_wa_numero_wa_conta on wa_numero (wa_conta_id);
select rc_rls_conta('wa_numero');

drop trigger if exists tg_wa_numero_touch on wa_numero;
create trigger tg_wa_numero_touch before update on wa_numero
  for each row execute function rc_touch();

-- ---------------------------------------------------------------- wa_evento

-- Todo webhook recebido vira linha ANTES de qualquer efeito colateral.
--
-- No Regem o controller responde 200 e chama `processar(body)` sem await: um
-- deploy no meio do processamento perde o evento em definitivo, porque a Meta
-- já recebeu 200 e não reenvia. Aqui o evento é gravado, o 200 sai, e o
-- processamento acontece depois — podendo ser repetido sem duplicar efeito.
--
-- Sem conta_id na policy: o evento chega identificado por phone_number_id e só
-- depois descobrimos de quem é. A tabela é da distribuição.
create table if not exists wa_evento (
  id            bigserial primary key,

  /*
   * Idempotência. A Meta reenvia quando não recebe 200 a tempo, e reenvio não
   * pode disparar de novo os efeitos (responder ao cliente, gravar opt-out,
   * sobrescrever status). A chave sai do conteúdo do evento — id da mensagem,
   * ou hash do payload quando não houver id.
   */
  chave_idempotencia text not null,

  tipo          text not null,
  phone_number_id text,
  conta_id      uuid,

  payload       jsonb not null,

  recebido_em   timestamptz not null default now(),
  processado_em timestamptz,
  tentativas    integer not null default 0,
  erro          text
);

create unique index if not exists uq_wa_evento_chave on wa_evento (chave_idempotencia);
-- Fila de reprocessamento: o que ainda não foi processado, na ordem de chegada.
create index if not exists idx_wa_evento_pendente
  on wa_evento (recebido_em) where processado_em is null;
select rc_rls_sistema('wa_evento');

comment on table wa_evento is
  'Webhooks recebidos da Meta, gravados antes de qualquer efeito colateral. Escopo sistema: o evento chega por phone_number_id e só depois resolve a conta.';

-- ---------------------------------------------------------------- grants

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'regemcast_app') then
    execute 'grant select, insert, update, delete on wa_conta, wa_numero, wa_evento to regemcast_app';
    execute 'grant usage, select on sequence wa_evento_id_seq to regemcast_app';
  end if;
end $$;
