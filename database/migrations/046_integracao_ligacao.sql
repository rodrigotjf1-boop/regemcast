-- 046_integracao_ligacao.sql
--
-- A ligacao do Hub DMS (F2, etapa A2): a credencial nova da porta MCP para os
-- produtos da DMS, ao lado do token de integracao (`rct_it_`, migration 043).
--
-- Com o DMS ID, cada chamada leva DUAS coisas: o token do DMS ID (diz QUAL
-- APLICATIVO chama) e o segredo da ligacao (`DMS-Ligacao: dms_lg_regemcast_...`,
-- diz QUAL CONTA autorizou). Vazar um so nao abre nada. Esta tabela guarda a
-- ligacao:
--
-- * de uma conta com um aplicativo do DMS ID (`aplicativo` = o client_id);
-- * o segredo so em resumo (sha-256 da chave inteira) e um prefixo curto para a
--   tela — o segredo em claro sai uma vez, na criacao;
-- * a ligacao que vem de um `rct_it_` (a troca automatica, decisao F2-3) herda o
--   MESMO id, os escopos, o nome, a classe e a data do token: o limite por
--   minuto e a idempotencia seguem com a mesma chave, e revogar um revoga o
--   outro (`integracao.service.ts`);
-- * so a classe `dms` entra pelo cabecalho `DMS-Ligacao` (a excecao do Padrao
--   DMS para a porta MCP entre produtos do grupo).
--
-- Enquanto DMS_ID_LIGADO estiver desligado, nada usa esta tabela e ela fica
-- vazia: nada muda para quem usa.
--
-- Sem instrucao destrutiva. Idempotente: pode rodar de novo.

set local lock_timeout = '10s';

create table if not exists integracao_ligacao (
  id              uuid primary key default gen_random_uuid(),
  conta_id        uuid not null references conta(id) on delete cascade,
  -- O aplicativo do DMS ID dono da ligacao (o client_id). So ele usa o segredo.
  aplicativo      text not null,
  -- Quem usa: `liame`, `regem`... (o mesmo do token de origem).
  produto         text not null,
  -- `dms` = produto do grupo; `externo` = cliente de fora (nao entra pelo cabecalho).
  classe          text not null,
  -- Como aparece na tela: "Liame — piloto".
  nome            text not null,
  segredo_hash    text not null,
  -- O comeco do segredo, para a pessoa reconhecer qual e: `dms_lg_regemcast_ab12c`.
  prefixo         text not null,
  escopos         jsonb not null default '[]'::jsonb,
  -- O token de integracao de onde a ligacao veio (a troca automatica). Nulo na ligacao autorizada por clique.
  origem_token_id uuid references integracao_token(id) on delete set null,
  criado_em       timestamptz not null default now(),
  -- Quando o segredo atual foi gerado: repetir a troca gira o segredo.
  segredo_em      timestamptz not null default now(),
  ultimo_uso_em   timestamptz,
  revogado_em     timestamptz,
  revogado_por    text,
  constraint ck_integracao_ligacao_aplicativo check (length(aplicativo) between 1 and 200),
  constraint ck_integracao_ligacao_produto check (produto ~ '^[a-z][a-z0-9_-]{1,39}$'),
  constraint ck_integracao_ligacao_classe check (classe in ('dms', 'externo')),
  constraint ck_integracao_ligacao_escopos check (jsonb_typeof(escopos) = 'array')
);

create unique index if not exists idx_integracao_ligacao_segredo on integracao_ligacao (segredo_hash);
create unique index if not exists idx_integracao_ligacao_origem
  on integracao_ligacao (origem_token_id) where origem_token_id is not null;
create index if not exists idx_integracao_ligacao_conta on integracao_ligacao (conta_id, criado_em desc);

select rc_rls_conta('integracao_ligacao');

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'regemcast_app') then
    execute 'grant select, insert, update, delete on integracao_ligacao to regemcast_app';
  end if;
end $$;

comment on table integracao_ligacao is
  'Ligacoes do Hub DMS por conta: o segredo (so o resumo) que o aplicativo do DMS ID manda no cabecalho DMS-Ligacao, junto do token do DMS ID. A que vem de um token de integracao herda o id, os escopos e a data dele.';
comment on column integracao_ligacao.aplicativo is
  'O client_id do aplicativo no DMS ID. A ligacao so vale com o token desse aplicativo.';
