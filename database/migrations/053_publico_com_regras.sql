-- 053_publico_com_regras.sql
--
-- O publico da campanha montado com regras (como o "Escolher clientes" do
-- Cardapio Web): campo + comparacao + valor, todas valendo, ate 10. As regras
-- sao conferidas no servidor por uma lista FIXA de campos
-- (backend/src/modules/contato/regras-do-publico.ts); nenhum nome de coluna
-- vem de fora.
--
-- 1. campanha.publico_origem aceita 'regras' (o check da 033 e trocado).
-- 2. campanha.publico_regras: as regras usadas na montagem (a foto), para o
--    cartao e para reabrir o rascunho. campanha.publico_salvo_id: o publico
--    salvo de onde vieram (sem FK: excluir o publico salvo nao mexe em
--    campanha; o id fica so para contar os usos).
-- 3. publico_salvo: as regras com nome, por conta. Guarda as REGRAS, nao as
--    pessoas: a cada uso o servidor confere de novo quem combina. RLS ligada.
-- 4. contato.cadastro_origem_em: a data do cadastro do cliente no sistema da
--    loja (o created_at do Cardapio Web), para a regra "Data do cadastro no
--    Cardapio Web". Nula para quem nao veio de la.
--
-- Idempotente.

-- ------------------------------------------------ 1. a origem nova

do $$
begin
  if exists (select 1 from pg_constraint
              where conname = 'ck_campanha_publico_origem'
                and pg_get_constraintdef(oid) not like '%regras%') then
    alter table campanha drop constraint ck_campanha_publico_origem;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_campanha_publico_origem') then
    alter table campanha add constraint ck_campanha_publico_origem
      check (publico_origem is null
             or publico_origem in ('lista', 'numeros', 'base', 'importacao', 'perfil', 'publico', 'regiao', 'regras'))
      not valid;
    alter table campanha validate constraint ck_campanha_publico_origem;
  end if;
end $$;

-- ------------------------------------------------ 2. as regras na campanha

alter table campanha add column if not exists publico_regras jsonb;
alter table campanha add column if not exists publico_salvo_id uuid;

create index if not exists idx_campanha_publico_salvo
  on campanha (conta_id, publico_salvo_id)
  where publico_salvo_id is not null;

comment on column campanha.publico_regras is
  'As regras do publico montado com regras, como foram usadas na montagem: {"regras":[{"campo","comparacao","valor"}],"parte":{"de","ate"}|null}. Nula nas outras origens.';
comment on column campanha.publico_salvo_id is
  'O publico salvo de onde vieram as regras. Sem FK: excluir o publico salvo nao mexe na campanha.';

-- ------------------------------------------------ 3. os publicos salvos

create table if not exists publico_salvo (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references conta(id) on delete cascade,
  nome          text not null,
  -- O nome sem diferenca de maiuscula, calculado no servidor (pt-BR): o lower()
  -- do banco depende do lc_ctype e, em "C", nao baixa letra acentuada.
  nome_chave    text not null,
  regras        jsonb not null,
  criado_por    uuid,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint ck_publico_salvo_nome check (char_length(btrim(nome)) between 1 and 80),
  constraint ck_publico_salvo_regras check (jsonb_typeof(regras) = 'array'
                                            and jsonb_array_length(regras) between 1 and 10)
);

create unique index if not exists idx_publico_salvo_nome on publico_salvo (conta_id, nome_chave);
create index if not exists idx_publico_salvo_conta on publico_salvo (conta_id, criado_em);

select rc_rls_conta('publico_salvo');

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'regemcast_app') then
    execute 'grant select, insert, update, delete on publico_salvo to regemcast_app';
  end if;
end $$;

comment on table publico_salvo is
  'Publicos salvos: regras com nome, por conta. Guardam as regras, nao as pessoas: a cada uso o servidor confere de novo quem combina.';

-- ------------------------------------------------ 4. a data do cadastro na origem

alter table contato add column if not exists cadastro_origem_em timestamptz;

comment on column contato.cadastro_origem_em is
  'Quando o cliente se cadastrou no sistema da loja (o created_at do Cardapio Web). Nula para quem nao veio de la. Dado pessoal: anonimizar apaga.';
