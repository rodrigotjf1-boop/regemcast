-- 042_orcamento_de_disparos.sql
--
-- Etapa 3 do roteiro, terceira parte: os TETOS de gasto na Meta.
--
-- O dono da conta define quanto aceita gastar com mensagens por dia, por semana
-- e por mes (na moeda em que a Meta cobra a conta, em centavos). O envio conta
-- o que ja saiu no periodo pelas tarifas de `tarifa_meta` (migration 041) e,
-- quando a proxima mensagem nao cabe, a campanha PAUSA com o motivo `orcamento`
-- e volta sozinha na virada do periodo.
--
-- * `conta.orcamento_{dia,semana,mes}_centavos`: os tres tetos. Nulo = sem
--   teto naquele periodo. Os periodos sao contados no fuso da conta.
-- * `orcamento_aviso`: quais avisos (80% e 100%) ja sairam em cada periodo. A
--   chave unica e o que impede o mesmo aviso de sair duas vezes quando duas
--   rodadas cruzam a marca ao mesmo tempo.
-- * `campanha.pausa_motivo` aceita `orcamento`. A hora em que a campanha volta
--   fica em `campanha.retomar_em`, que ja existe (migration 027).
--
-- Idempotente: pode rodar de novo.
--
-- ATENCAO: tem `drop constraint` (a troca do check de `pausa_motivo`). Vai pelo
-- SQL Editor do Supabase, colada pelo dono, e nao pela conexao de escrita.

set local lock_timeout = '10s';

alter table conta add column if not exists orcamento_dia_centavos integer;
alter table conta add column if not exists orcamento_semana_centavos integer;
alter table conta add column if not exists orcamento_mes_centavos integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_conta_orcamento') then
    alter table conta add constraint ck_conta_orcamento check (
      (orcamento_dia_centavos is null or orcamento_dia_centavos > 0)
      and (orcamento_semana_centavos is null or orcamento_semana_centavos > 0)
      and (orcamento_mes_centavos is null or orcamento_mes_centavos > 0)
    );
  end if;
end $$;

comment on column conta.orcamento_dia_centavos is
  'Teto de gasto na Meta por dia, em centavos da moeda da conta (wa_conta.moeda). Nulo = sem teto. So o dono altera.';
comment on column conta.orcamento_semana_centavos is
  'Teto de gasto na Meta por semana (segunda a domingo, no fuso da conta), em centavos. Nulo = sem teto.';
comment on column conta.orcamento_mes_centavos is
  'Teto de gasto na Meta por mes (no fuso da conta), em centavos. Nulo = sem teto.';

create table if not exists orcamento_aviso (
  id         uuid primary key default gen_random_uuid(),
  conta_id   uuid not null references conta(id) on delete cascade,
  -- `dia`, `semana` ou `mes`, e o primeiro dia dele no fuso da conta.
  periodo    text not null,
  inicio     date not null,
  -- 80 = chegou a 80% do teto; 100 = o teto foi atingido.
  nivel      smallint not null,
  criado_em  timestamptz not null default now(),
  constraint ck_orcamento_aviso_periodo check (periodo in ('dia', 'semana', 'mes')),
  constraint ck_orcamento_aviso_nivel check (nivel in (80, 100))
);

create unique index if not exists idx_orcamento_aviso_unico
  on orcamento_aviso (conta_id, periodo, inicio, nivel);

select rc_rls_conta('orcamento_aviso');

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'regemcast_app') then
    execute 'grant select, insert, update, delete on orcamento_aviso to regemcast_app';
  end if;
end $$;

comment on table orcamento_aviso is
  'Avisos do orcamento de disparos que ja sairam (80% e 100%), um por conta, periodo e nivel. Existe para o aviso nao repetir.';

-- O motivo `orcamento` na pausa da campanha.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'ck_campanha_pausa_motivo') then
    alter table campanha drop constraint ck_campanha_pausa_motivo;
  end if;
  alter table campanha add constraint ck_campanha_pausa_motivo
    check (pausa_motivo is null or pausa_motivo in ('conexao', 'teto_plano', 'inadimplencia', 'manual', 'modelo', 'conta_meta', 'orcamento'));
end $$;
