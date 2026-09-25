-- 028_blocos.sql — A base dividida em blocos: listas de 250, 500, 750, 1.000 ou do tamanho que o dono escolher.
--
-- Para lista só com nome e número (o arquivo de contatos exportado do celular,
-- sem pedido nenhum), dividir em blocos é o jeito de enviar aos poucos: dentro
-- do limite de envio da Meta (que começa em 250 pessoas por dia), escolhendo o
-- bloco do dia e acompanhando o resultado de cada bloco antes de seguir.
--
-- Cada bloco É uma lista (`contato_lista`) — a campanha escolhe um bloco como
-- escolhe qualquer lista, sem caminho novo. A divisão (`lista_divisao`) guarda
-- de onde os blocos saíram e com que regra:
--
--   * origem: lista, importação, base inteira, perfil ou região (DDD);
--   * tamanho: entre 50 e 100.000 — os tamanhos acima do limite da Meta da
--     conta são recusados pela API, não aqui (o limite muda com o tempo);
--   * ordem: como foi importado, sorteio, mais recentes, por região ou
--     melhores clientes primeiro;
--   * só quem nunca recebeu campanha: para dividir de novo o que sobrou.
--
-- Os blocos são uma FOTO da base no momento da divisão: contato novo não entra
-- sozinho — divide-se de novo. Quem pediu para sair fica de fora já na divisão
-- (e o disparo confere de novo na hora de enviar).
--
-- Apagar a divisão apaga os blocos dela (cascata); a API só deixa apagar
-- divisão cujos blocos nenhuma campanha usou.
--
-- Idempotente.

create table if not exists lista_divisao (
  id              uuid primary key default gen_random_uuid(),
  conta_id        uuid not null references conta(id) on delete cascade,

  -- O nome base dos blocos: "Contatos do celular — 25/09" → "… · bloco 01 de 14".
  nome            text not null,
  origem          text not null
                  check (origem in ('lista', 'importacao', 'base', 'perfil', 'regiao')),
  -- A lista ou a importação de origem (nulo para base, perfil e região).
  origem_id       uuid,
  -- O perfil ou a UF escolhidos, e o que a tela mostra da origem.
  origem_rotulo   text,

  tamanho         integer not null check (tamanho between 50 and 100000),
  ordem           text not null
                  check (ordem in ('importacao', 'sorteio', 'recentes', 'regiao', 'valor')),
  so_nunca_receberam boolean not null default false,

  total_contatos  integer not null check (total_contatos >= 0),
  total_blocos    integer not null check (total_blocos >= 0),

  criada_por      uuid references usuario(id) on delete set null,
  criada_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

comment on table lista_divisao is
  'Base dividida em blocos. Cada bloco e uma contato_lista (divisao_id, bloco). Foto do momento da divisao.';

select rc_rls_conta('lista_divisao');

drop trigger if exists tg_lista_divisao_touch on lista_divisao;
create trigger tg_lista_divisao_touch before update on lista_divisao
  for each row execute function rc_touch();

create index if not exists idx_lista_divisao_conta on lista_divisao (conta_id, criada_em desc);

-- O bloco é uma lista comum, marcada com a divisão e a posição.
alter table contato_lista add column if not exists divisao_id uuid references lista_divisao(id) on delete cascade;
alter table contato_lista add column if not exists bloco integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_contato_lista_bloco') then
    alter table contato_lista add constraint ck_contato_lista_bloco
      check ((divisao_id is null and bloco is null) or (divisao_id is not null and bloco >= 1));
  end if;
end $$;

create index if not exists idx_contato_lista_divisao
  on contato_lista (divisao_id, bloco)
  where divisao_id is not null;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'regemcast_app') then
    execute 'grant select, insert, update, delete on lista_divisao to regemcast_app';
  end if;
end $$;
