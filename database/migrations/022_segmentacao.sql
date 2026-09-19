-- 022_segmentacao.sql — Os números que o dono ajusta para classificar a base
-- (Campeões, Fiéis, Em risco, Perdidos…).
--
-- O perfil de cada contato NÃO é gravado: é calculado na consulta a partir da
-- última compra e da quantidade de pedidos (migration 021) com estes números.
-- Mudar um número reclassifica a base inteira na hora, sem job e sem
-- reprocessar nada. Sem linha para a conta = valores padrão.
--
-- Idempotente: pode rodar duas vezes sem efeito diferente.

create table if not exists segmentacao_parametros (
  conta_id      uuid primary key references conta(id) on delete cascade,

  -- "Comprou recentemente": última compra até N dias.
  recente_dias  integer not null default 30  check (recente_dias between 1 and 365),
  -- "Ainda ativo": até N dias (depois disso começa o risco).
  ativo_dias    integer not null default 90  check (ativo_dias between 2 and 730),
  -- "Em risco": até N dias (depois disso, perdido).
  risco_dias    integer not null default 180 check (risco_dias between 3 and 1095),
  -- "Compra com frequência": N pedidos ou mais.
  fiel_pedidos  integer not null default 5   check (fiel_pedidos between 2 and 1000),

  atualizado_por uuid references usuario(id) on delete set null,
  atualizado_em  timestamptz not null default now(),

  check (recente_dias < ativo_dias and ativo_dias < risco_dias)
);

comment on table segmentacao_parametros is
  'Limites da classificacao da base por conta. O perfil e calculado na consulta, nunca gravado.';

select rc_rls_conta('segmentacao_parametros');

drop trigger if exists tg_segmentacao_parametros_touch on segmentacao_parametros;
create trigger tg_segmentacao_parametros_touch before update on segmentacao_parametros
  for each row execute function rc_touch();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'regemcast_app') then
    execute 'grant select, insert, update, delete on segmentacao_parametros to regemcast_app';
  end if;
end $$;
