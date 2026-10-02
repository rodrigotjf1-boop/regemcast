-- 043_integracao_token.sql
--
-- A porta para outros produtos da DMS: o token de integracao por conta.
--
-- O RegemCast passa a ter um endereco MCP (`/api/v1/mcp`), por onde outro
-- produto do grupo (o Liame primeiro) le numeros da conta e pede acoes. Quem
-- entra por ali se identifica com um token que:
--
-- * vale para UMA conta;
-- * fica guardado so em hash (sha-256) — o token em claro aparece uma unica vez,
--   na emissao, e nao da para recuperar depois;
-- * carrega os escopos que pode usar e a classe de quem o usa: `dms` (produto
--   do grupo) ou `externo`. O escopo de disparo so existe para a classe `dms`;
-- * pode ser revogado pela distribuicao ou pelo dono da conta, e guarda quando
--   foi usado pela ultima vez.
--
-- E a credencial provisoria ate o hub da DMS e o login unico existirem: quando
-- eles chegarem, troca-se a porta e as ferramentas ficam.
--
-- Sem `drop`. Idempotente: pode rodar de novo.

set local lock_timeout = '10s';

create table if not exists integracao_token (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references conta(id) on delete cascade,
  -- Quem usa o token: `liame`, `regem`, `gogem`...
  produto       text not null,
  -- `dms` = produto do grupo; `externo` = cliente de fora (nunca dispara).
  classe        text not null,
  -- Como aparece na tela: "Liame — piloto".
  nome          text not null,
  token_hash    text not null,
  -- O comeco do token, para a pessoa reconhecer qual e: `rct_it_ab12cd34`.
  prefixo       text not null,
  escopos       jsonb not null default '[]'::jsonb,
  criado_por    text,
  criado_em     timestamptz not null default now(),
  ultimo_uso_em timestamptz,
  revogado_em   timestamptz,
  revogado_por  text,
  constraint ck_integracao_token_produto check (produto ~ '^[a-z][a-z0-9_-]{1,39}$'),
  constraint ck_integracao_token_classe check (classe in ('dms', 'externo')),
  constraint ck_integracao_token_escopos check (jsonb_typeof(escopos) = 'array')
);

create unique index if not exists idx_integracao_token_hash on integracao_token (token_hash);
create index if not exists idx_integracao_token_conta on integracao_token (conta_id, criado_em desc);

select rc_rls_conta('integracao_token');

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'regemcast_app') then
    execute 'grant select, insert, update, delete on integracao_token to regemcast_app';
  end if;
end $$;

comment on table integracao_token is
  'Tokens de integracao por conta (a porta MCP para outros produtos da DMS). So o hash e guardado; escopos e classe (dms ou externo) decidem o que o token pode fazer.';
comment on column integracao_token.classe is
  'dms = produto do grupo DMS; externo = cliente de fora do grupo. O escopo de disparo so e aceito na classe dms.';
