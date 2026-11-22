-- 052_dms_graph.sql
--
-- O DMS Graph no Regemcast (plano "DMS Graph: recursos por produto", F4; prototipo aprovado em
-- 22/11/2026). "Graph" aqui e o produto da DMS, nao a Graph API da Meta: por isso o prefixo
-- `dms_graph_` em tudo. O dono da conta liga pelo clique (RFC 9126 + PKCE), o responsavel autoriza na
-- pagina do Graph e o Regemcast guarda a LIGACAO da conta, cifrada. O primeiro recurso e ajustar o
-- video do cabecalho do modelo, sem IA e sem franquia.
--
-- Esta migration:
-- * dms_graph_ligacao: a ligacao da conta (uma viva por conta), o segredo cifrado e o historico;
-- * dms_graph_pedido: o pedido em andamento. O `state` so pelo resumo, o verificador do PKCE cifrado,
--   preso a quem comecou; vale 10 minutos e uma vez so;
-- * dms_graph_ajuste: cada ajuste de video. A chave de idempotencia e por conta: repetir o mesmo pedido
--   devolve o mesmo ajuste, e o resultado vira UMA midia so.
--
-- Todas com RLS forcada na mesma migration. Idempotente: pode rodar de novo. Sem `drop`.

set local lock_timeout = '10s';

create table if not exists dms_graph_ligacao (
  id               uuid primary key default gen_random_uuid(),
  conta_id         uuid not null references conta(id) on delete cascade,
  segredo_cifrado  text not null,               -- a ligacao `dms_lg_graph_...`, cifrada com INTEGRACOES_CHAVE
  prefixo          text not null,               -- o comeco do segredo, para o suporte reconhecer
  conta_graph      text,                        -- o id da conta no Graph
  conta_graph_nome text,
  permissoes       text[] not null default '{}',
  criada_por       uuid references usuario(id) on delete set null,
  criada_por_nome  text,
  criada_em        timestamptz not null default now(),
  ultimo_uso_em    timestamptz,
  revogada_em      timestamptz,
  revogada_origem  text,
  revogada_por     text,
  constraint ck_dms_graph_ligacao_origem check (revogada_origem is null or revogada_origem in ('dono', 'troca', 'graph'))
);

create unique index if not exists ux_dms_graph_ligacao_viva on dms_graph_ligacao (conta_id) where revogada_em is null;
create index if not exists ix_dms_graph_ligacao_conta on dms_graph_ligacao (conta_id, criada_em desc);
create index if not exists ix_dms_graph_ligacao_criada_por on dms_graph_ligacao (criada_por);

comment on table dms_graph_ligacao is
  'A ligacao da conta com o DMS Graph (produto da DMS, nao a Graph API da Meta). Uma viva por conta; o segredo fica cifrado.';

select rc_rls_conta('dms_graph_ligacao');

create table if not exists dms_graph_pedido (
  id                   uuid primary key default gen_random_uuid(),
  conta_id             uuid not null references conta(id) on delete cascade,
  usuario_id           uuid not null references usuario(id) on delete cascade,
  estado_hash          text not null,           -- sha-256 do state (o state nunca e guardado)
  verificador_cifrado  text not null,           -- o verificador do PKCE, cifrado com INTEGRACOES_CHAVE
  permissoes           text[] not null default '{}',
  criado_em            timestamptz not null default now(),
  vence_em             timestamptz not null,
  usado_em             timestamptz
);

create unique index if not exists ux_dms_graph_pedido_estado on dms_graph_pedido (estado_hash);
create index if not exists ix_dms_graph_pedido_vence on dms_graph_pedido (conta_id, vence_em);
create index if not exists ix_dms_graph_pedido_usuario on dms_graph_pedido (usuario_id);

comment on table dms_graph_pedido is
  'Conectar ao DMS Graph: o pedido em andamento (resumo do state e verificador do PKCE cifrado). 10 minutos, uma vez.';

select rc_rls_conta('dms_graph_pedido');

create table if not exists dms_graph_ajuste (
  id                  uuid primary key default gen_random_uuid(),
  conta_id            uuid not null references conta(id) on delete cascade,
  usuario_id          uuid references usuario(id) on delete set null,
  midia_origem_id     uuid not null references midia(id) on delete cascade,
  midia_resultado_id  uuid references midia(id) on delete set null,
  chave               text not null,            -- a chave de idempotencia que vai ao Graph
  tarefa              uuid,                     -- o numero da tarefa no Graph
  situacao            text not null default 'pedindo',
  pedido              jsonb not null,           -- trecho, proporcao e texto (sem os bytes)
  erro_codigo         text,
  erro_frase          text,
  pode_repetir        boolean not null default false,
  bytes               integer,
  largura             integer,
  altura              integer,
  duracao_ms          integer,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  constraint ck_dms_graph_ajuste_situacao check (situacao in ('pedindo', 'processando', 'pronto', 'erro'))
);

create unique index if not exists ux_dms_graph_ajuste_chave on dms_graph_ajuste (conta_id, chave);
create index if not exists ix_dms_graph_ajuste_origem on dms_graph_ajuste (midia_origem_id);
create index if not exists ix_dms_graph_ajuste_resultado on dms_graph_ajuste (midia_resultado_id);
create index if not exists ix_dms_graph_ajuste_usuario on dms_graph_ajuste (usuario_id);

comment on table dms_graph_ajuste is
  'Cada ajuste de video pelo DMS Graph: a mesma chave devolve o mesmo ajuste, e o resultado vira uma midia so.';

select rc_rls_conta('dms_graph_ajuste');

-- Conferencia no MESMO Run: as quatro linhas tem de vir com `ok = true`.
select 'dms_graph_ligacao, com RLS forcado' as objeto,
       coalesce((select c.relrowsecurity and c.relforcerowsecurity from pg_class c
                  where c.oid = to_regclass(current_schema() || '.dms_graph_ligacao')), false) as ok
union all
select 'dms_graph_pedido, com RLS forcado',
       coalesce((select c.relrowsecurity and c.relforcerowsecurity from pg_class c
                  where c.oid = to_regclass(current_schema() || '.dms_graph_pedido')), false)
union all
select 'dms_graph_ajuste, com RLS forcado',
       coalesce((select c.relrowsecurity and c.relforcerowsecurity from pg_class c
                  where c.oid = to_regclass(current_schema() || '.dms_graph_ajuste')), false)
union all
select 'uma ligacao viva por conta',
       exists (select 1 from pg_indexes where schemaname = current_schema() and indexname = 'ux_dms_graph_ligacao_viva');
