-- 050_conectar_pelo_regem.sql
--
-- "Conectar pelo Regem" (Hub DMS, F6, plano "Clique RegemCast -> Regem", 15/11/2026; prototipo
-- `prototipos/clique-empresa-inteira.html` do hub). Ate aqui quem ligava a conta ao Regem era a
-- distribuicao, colando no console o token `rgm_it_` da empresa (migration 035). Agora o DONO da
-- conta liga sozinho: o Regemcast empurra o pedido ao Regem com o token do DMS ID (RFC 9126), o
-- presidente da empresa autoriza na pagina do Regem e o Regemcast troca o codigo pela LIGACAO da
-- empresa inteira (`dms_lg_regem_...`), guardada cifrada no mesmo lugar do token. O token colado
-- segue valendo para quem ja tem, ate alguem conectar pelo clique.
--
-- Esta migration:
-- * integracao_regem.origem: como a conexao nasceu, 'chave' (o token do console) ou 'clique';
-- * integracao_regem.ligacao_prefixo: o comeco do segredo da ligacao, para o suporte reconhecer;
-- * integracao_regem_pedido: o pedido em andamento (RLS da conta). O `state` so pelo resumo, o
--   verificador do PKCE cifrado, preso a quem comecou; vale 10 minutos e uma vez so. Leva a
--   declaracao do dono (o consentimento dos clientes), feita antes de ir ao Regem: na volta, a
--   primeira importacao comeca sozinha.
--
-- Idempotente: pode rodar de novo. Sem `drop`.

set local lock_timeout = '10s';

alter table integracao_regem add column if not exists origem text not null default 'chave';
alter table integracao_regem add column if not exists ligacao_prefixo text;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
     where c.conname = 'ck_integracao_regem_origem'
       and c.conrelid = to_regclass(current_schema() || '.integracao_regem')
  ) then
    alter table integracao_regem add constraint ck_integracao_regem_origem check (origem in ('chave', 'clique'));
  end if;
end $$;

comment on column integracao_regem.origem is
  'Como a conexao nasceu: chave (o token rgm_it_ colado pela distribuicao) ou clique (a ligacao do DMS ID, autorizada pelo presidente no Regem).';

create table if not exists integracao_regem_pedido (
  id                   uuid primary key default gen_random_uuid(),
  conta_id             uuid not null references conta(id) on delete cascade,
  usuario_id           uuid not null references usuario(id) on delete cascade,
  estado_hash          text not null,               -- sha-256 do state (o state nunca e guardado)
  verificador_cifrado  text not null,               -- o verificador do PKCE, cifrado com INTEGRACOES_CHAVE
  consentimento        boolean not null default false,
  evidencia            text,
  criado_em            timestamptz not null default now(),
  vence_em             timestamptz not null,
  usado_em             timestamptz
);

create unique index if not exists ux_integracao_regem_pedido_estado on integracao_regem_pedido (estado_hash);
create index if not exists ix_integracao_regem_pedido_vence on integracao_regem_pedido (vence_em);

comment on table integracao_regem_pedido is
  'Conectar pelo Regem: o pedido em andamento (resumo do state, verificador do PKCE cifrado, a declaracao do dono). 10 minutos, uma vez.';

select rc_rls_conta('integracao_regem_pedido');

-- Conferencia no MESMO Run: as tres linhas tem de vir com `ok = true`.
select 'integracao_regem: origem e ligacao_prefixo' as objeto,
       (select count(*) = 2 from information_schema.columns
         where table_schema = current_schema() and table_name = 'integracao_regem'
           and column_name in ('origem', 'ligacao_prefixo')) as ok
union all
select 'tabela integracao_regem_pedido, com RLS forcado',
       coalesce((select c.relrowsecurity and c.relforcerowsecurity from pg_class c
                  where c.oid = to_regclass(current_schema() || '.integracao_regem_pedido')), false)
union all
select 'restricao da origem',
       exists (select 1 from pg_constraint where conname = 'ck_integracao_regem_origem'
                 and conrelid = to_regclass(current_schema() || '.integracao_regem'));
