-- 001_fundacao.sql — Núcleo do RegemCast: conta, usuário, lista de espera,
-- auditoria append-only e cobrança por faixa de disparos.
--
-- REGRAS DESTA BASE (valem para toda migration seguinte):
--   1. Toda tabela com conta_id nasce com RLS ligada NA MESMA MIGRATION.
--      (No Regem a RLS ficou numa migration genérica que varre o catálogo —
--       ela roda antes das tabelas existirem e só pega no segundo passe.)
--   2. Toda chave estrangeira é declarada de verdade.
--   3. Telefone é sempre E.164, com o "+".
--   4. Idempotente: create/add ... if not exists, guardas em do $$ ... $$.
--
-- ISOLAMENTO: o backend conecta como regemcast_app (SEM bypassrls) e define,
-- por transação, dois GUCs:
--   app.conta_id  -> uuid da conta do request
--   app.escopo    -> 'tenant' (padrão) ou 'sistema'
-- Sem GUC nenhum, current_setting(...,true) devolve null, nada casa e a
-- consulta volta vazia. Fail-closed por construção.
-- O escopo 'sistema' existe para os poucos caminhos que precisam enxergar
-- antes de saber a conta: login, webhook da Meta e jobs da fila. Todos
-- explícitos e greppáveis no código.

create extension if not exists citext;

-- ---------------------------------------------------------------- helpers

-- Lê o GUC como uuid sem estourar quando vem vazio/ausente.
create or replace function rc_conta_atual() returns uuid
language sql stable as $$
  select nullif(current_setting('app.conta_id', true), '')::uuid;
$$;

create or replace function rc_escopo_sistema() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.escopo', true), 'tenant') = 'sistema';
$$;

-- Liga RLS numa tabela de conta e cria a policy padrão. Idempotente.
create or replace function rc_rls_conta(p_tabela text) returns void
language plpgsql as $$
begin
  execute format('alter table %I enable row level security', p_tabela);
  execute format('alter table %I force row level security', p_tabela);
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = p_tabela and policyname = 'rc_isolamento'
  ) then
    execute format($f$
      create policy rc_isolamento on %I
        using (conta_id = rc_conta_atual() or rc_escopo_sistema())
        with check (conta_id = rc_conta_atual() or rc_escopo_sistema())
    $f$, p_tabela);
  end if;
end $$;

-- Tabelas da distribuição (catálogo, fila de entrada): só escopo sistema.
create or replace function rc_rls_sistema(p_tabela text) returns void
language plpgsql as $$
begin
  execute format('alter table %I enable row level security', p_tabela);
  execute format('alter table %I force row level security', p_tabela);
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = p_tabela and policyname = 'rc_sistema'
  ) then
    execute format($f$
      create policy rc_sistema on %I
        using (rc_escopo_sistema()) with check (rc_escopo_sistema())
    $f$, p_tabela);
  end if;
end $$;

create or replace function rc_touch() returns trigger
language plpgsql as $$
begin
  new.atualizado_em = now();
  return new;
end $$;

-- ---------------------------------------------------------------- plano

-- Catálogo de planos. Eixo de cobrança: disparos por mês (decisão do produto).
-- O primeiro mês é grátis com teto próprio, por isso disparos_mes e
-- disparos_cortesia são colunas distintas.
create table if not exists plano (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null unique,
  nome          text not null,
  disparos_mes  integer not null,
  preco_centavos integer not null default 0,
  ativo         boolean not null default true,
  ordem         integer not null default 0,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
select rc_rls_sistema('plano');

insert into plano (codigo, nome, disparos_mes, preco_centavos, ordem)
values ('cortesia', 'Primeiro mês', 5000, 0, 0)
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------- conta

-- O cliente do RegemCast. timezone rege TODA janela de envio e TODO teto de
-- período — no Regem 'America/Sao_Paulo' está cravado no SQL e a comparação
-- com timestamptz desloca a virada do dia em 3 horas.
create table if not exists conta (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  cnpj          text,
  timezone      text not null default 'America/Sao_Paulo',
  status        text not null default 'aprovada'
                check (status in ('aprovada','ativa','suspensa','cancelada')),
  plano_id      uuid references plano(id) on delete set null,
  aprovada_em   timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- A própria conta é filtrada pelo id, não por conta_id: policy própria.
alter table conta enable row level security;
alter table conta force row level security;
do $$ begin
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='conta' and policyname='rc_isolamento') then
    create policy rc_isolamento on conta
      using (id = rc_conta_atual() or rc_escopo_sistema())
      with check (id = rc_conta_atual() or rc_escopo_sistema());
  end if;
end $$;

drop trigger if exists tg_conta_touch on conta;
create trigger tg_conta_touch before update on conta
  for each row execute function rc_touch();

-- ---------------------------------------------------------------- usuário

-- token_versao invalida sessões em andamento sem tabela de sessão: o JWT
-- carrega a versão e o guard compara. Trocar senha, suspender ou remover o
-- usuário incrementa e derruba tudo na hora.
create table if not exists usuario (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references conta(id) on delete cascade,
  nome          text not null,
  email         citext not null unique,
  senha_hash    text not null,
  papel         text not null default 'operador' check (papel in ('dono','operador')),
  status        text not null default 'ativo' check (status in ('ativo','suspenso')),
  token_versao  integer not null default 1,
  ultimo_login_em timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_usuario_conta on usuario (conta_id);
select rc_rls_conta('usuario');

drop trigger if exists tg_usuario_touch on usuario;
create trigger tg_usuario_touch before update on usuario
  for each row execute function rc_touch();

-- Toda conta precisa de exatamente um dono ativo.
create unique index if not exists uq_usuario_dono
  on usuario (conta_id) where papel = 'dono';

-- ---------------------------------------------------------------- lista de espera

-- Existe ANTES da conta. É o que transforma o teto de 10 clientes novos por
-- janela rolling de 7 dias da Meta em fila administrável, em vez de erro no
-- meio do Embedded Signup.
create table if not exists lista_espera (
  id             uuid primary key default gen_random_uuid(),
  email          citext not null unique,
  nome           text not null,
  empresa        text,
  telefone_e164  text,
  origem         text,
  status         text not null default 'aguardando'
                 check (status in ('aguardando','convidada','recusada','convertida')),
  observacao     text,
  convite_token_hash text,
  convite_expira_em  timestamptz,
  convidada_em   timestamptz,
  convertida_em  timestamptz,
  conta_id       uuid references conta(id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists idx_lista_espera_status on lista_espera (status, criado_em);
create unique index if not exists uq_lista_espera_convite
  on lista_espera (convite_token_hash) where convite_token_hash is not null;
select rc_rls_sistema('lista_espera');

drop trigger if exists tg_lista_espera_touch on lista_espera;
create trigger tg_lista_espera_touch before update on lista_espera
  for each row execute function rc_touch();

-- ---------------------------------------------------------------- auditoria

-- Append-only de verdade: o revoke abaixo tira update/delete do role da
-- aplicação, e a trigger bloqueia mesmo quem tiver o grant.
--
-- POR QUE conta_id E ator_usuario_id NÃO TÊM FK AQUI (e têm em todo o resto):
-- uma trilha precisa sobreviver ao sujeito. Com `references ... on delete set
-- null`, apagar um usuário dispara um UPDATE nesta tabela — que a trigger de
-- imutabilidade bloqueia. O efeito é que remover usuário ou conta passa a ser
-- impossível, com um erro que não explica nada:
--     ERRO: auditoria é append-only (tentativa de UPDATE na linha 22)
--     CONTEXTO: UPDATE ONLY "auditoria" SET "ator_usuario_id" = NULL ...
-- Então o ator vira dado CONGELADO: guardamos o id e o nome como estavam no
-- momento do registro, e a linha continua legível depois que a pessoa sai.
-- Isto é decisão, não descuido — diferente de `campanha.tenant_id` no Regem,
-- que é uuid solto por esquecimento numa tabela operacional.
create table if not exists auditoria (
  id            bigserial primary key,
  conta_id      uuid,
  ator_tipo     text not null default 'usuario'
                check (ator_tipo in ('usuario','sistema','distribuicao')),
  ator_usuario_id uuid,
  ator_nome     text,
  acao          text not null,
  entidade      text,
  entidade_id   text,
  detalhe       jsonb not null default '{}'::jsonb,
  ip            inet,
  user_agent    text,
  criado_em     timestamptz not null default now()
);
-- A trilha é paginada por cursor sobre o id (monotônico e sem empate, ao
-- contrário de criado_em), então o índice precisa ser por (conta_id, id desc)
-- — senão a paginação ordena em memória.
create index if not exists idx_auditoria_conta_id on auditoria (conta_id, id desc);
create index if not exists idx_auditoria_acao on auditoria (conta_id, acao, id desc);

alter table auditoria enable row level security;
alter table auditoria force row level security;
do $$ begin
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='auditoria' and policyname='rc_isolamento') then
    create policy rc_isolamento on auditoria
      using (conta_id = rc_conta_atual() or rc_escopo_sistema())
      with check (conta_id = rc_conta_atual() or rc_escopo_sistema());
  end if;
end $$;

create or replace function rc_auditoria_imutavel() returns trigger
language plpgsql as $$
begin
  raise exception 'auditoria é append-only (tentativa de % na linha %)', tg_op, old.id;
end $$;

drop trigger if exists tg_auditoria_imutavel on auditoria;
create trigger tg_auditoria_imutavel before update or delete on auditoria
  for each row execute function rc_auditoria_imutavel();

-- ---------------------------------------------------------------- assinatura e uso

create table if not exists assinatura (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references conta(id) on delete cascade,
  plano_id      uuid not null references plano(id),
  status        text not null default 'cortesia'
                check (status in ('cortesia','ativa','inadimplente','cancelada')),
  ciclo_inicio  timestamptz not null default now(),
  ciclo_fim     timestamptz not null,
  gratis_ate    timestamptz,
  provedor_ref  text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists uq_assinatura_conta on assinatura (conta_id);
select rc_rls_conta('assinatura');

drop trigger if exists tg_assinatura_touch on assinatura;
create trigger tg_assinatura_touch before update on assinatura
  for each row execute function rc_touch();

-- Contador materializado por ciclo. O incremento é atômico (upsert com
-- disparos = uso_ciclo.disparos + 1) no momento em que a Meta ACEITA o envio.
create table if not exists uso_ciclo (
  conta_id      uuid not null references conta(id) on delete cascade,
  ciclo_inicio  timestamptz not null,
  disparos      bigint not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (conta_id, ciclo_inicio)
);
select rc_rls_conta('uso_ciclo');

-- ---------------------------------------------------------------- grants

-- Idempotente e tolerante: em dev-local o role pode não existir ainda.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'regemcast_app') then
    execute 'grant usage on schema public to regemcast_app';
    execute 'grant select, insert, update, delete on all tables in schema public to regemcast_app';
    execute 'grant usage, select on all sequences in schema public to regemcast_app';
    -- auditoria é append-only também por permissão, não só por trigger.
    execute 'revoke update, delete on auditoria from regemcast_app';
    execute 'alter default privileges in schema public
               grant select, insert, update, delete on tables to regemcast_app';
    execute 'alter default privileges in schema public
               grant usage, select on sequences to regemcast_app';
  else
    raise notice 'role regemcast_app ainda não existe — rode 000_roles.sql antes (ver docs/banco.md)';
  end if;
end $$;
