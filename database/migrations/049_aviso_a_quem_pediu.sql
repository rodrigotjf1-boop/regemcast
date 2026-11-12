-- 049_aviso_a_quem_pediu.sql
--
-- O aviso assinado a quem pediu (Hub DMS, F5 parte B, PR 3; decisao F5-7): o
-- produto da DMS que pediu um disparo fica sabendo, na hora, que o pedido mudou
-- (aprovado, recusado, vencido, cancelado, executado, parou no teto). O aviso e
-- so gatilho (Padrao DMS, secao 9): leva o tipo e o id do pedido, nunca dado
-- pessoal; quem recebe le o pedido por acao_pedido_ler. Assinatura Standard
-- Webhooks com o segredo que o produto registrou. O desenho esta em
-- docs/aprovacao-de-disparos.md.
--
-- Esta migration:
-- * integracao_aviso: para onde avisar e com que segredo, um por conta e
--   produto (RLS da conta). O produto registra pela porta MCP (aviso_registrar);
--   o endereco so vale dentro das bases do produto, fixas no codigo. O segredo
--   fica cifrado. Pausa depois de muitas falhas seguidas; registrar de novo religa;
-- * aviso_saida: a fila de entrega (RLS da conta). O id e o webhook-id, o mesmo
--   em todas as tentativas. Um aviso pendente por pedido: a mudanca que chega
--   com outro ainda na fila so marca `mudou_em` (a entrega que ja saiu nao fecha
--   a linha que mudou depois de ser lida);
-- * o gatilho rc_acao_pedido_aviso: cada mudanca de situacao (ou o motivo do
--   teto) do pedido poe o aviso na fila de quem pediu, se ele registrou e nao
--   esta pausado.
--
-- Idempotente: pode rodar de novo. Sem `drop` (o gatilho e `create or replace`).

set local lock_timeout = '10s';

create table if not exists integracao_aviso (
  id               uuid primary key default gen_random_uuid(),
  conta_id         uuid not null references conta(id) on delete cascade,
  produto          text not null,
  url              text not null,
  -- O segredo whsec_ cifrado com a chave das integracoes; nunca volta para fora.
  segredo_cifrado  text not null,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  falhas_seguidas  integer not null default 0,
  falhando_desde   timestamptz,
  pausado_em       timestamptz,
  pausa_motivo     text,
  ultimo_envio_em  timestamptz,
  ultimo_status    integer,
  constraint ck_integracao_aviso_produto check (produto ~ '^[a-z][a-z0-9_-]{1,39}$'),
  constraint ck_integracao_aviso_url check (url ~ '^https://' and length(url) <= 500),
  constraint ck_integracao_aviso_falhas check (falhas_seguidas >= 0),
  constraint ck_integracao_aviso_pausa check ((pausado_em is null) = (pausa_motivo is null)),
  constraint ck_integracao_aviso_motivo check (pausa_motivo is null or length(pausa_motivo) between 1 and 300)
);

create unique index if not exists uq_integracao_aviso_conta_produto on integracao_aviso (conta_id, produto);

select rc_rls_conta('integracao_aviso');

create table if not exists aviso_saida (
  -- O webhook-id: o mesmo em todas as tentativas (quem recebe descarta o repetido).
  id               uuid primary key default gen_random_uuid(),
  conta_id         uuid not null references conta(id) on delete cascade,
  produto          text not null,
  tipo             text not null,
  recurso_id       uuid not null,
  criado_em        timestamptz not null default clock_timestamp(),
  -- A ultima mudanca que este aviso cobre: a entrega so fecha a linha se ela nao mudou depois de lida.
  mudou_em         timestamptz not null default clock_timestamp(),
  proxima_em       timestamptz not null default clock_timestamp(),
  tentativas       integer not null default 0,
  entregue_em      timestamptz,
  desistido_em     timestamptz,
  ultimo_status    integer,
  ultimo_erro      text,
  constraint ck_aviso_saida_produto check (produto ~ '^[a-z][a-z0-9_-]{1,39}$'),
  constraint ck_aviso_saida_tipo check (tipo in ('acao.alterada')),
  constraint ck_aviso_saida_tentativas check (tentativas >= 0),
  constraint ck_aviso_saida_erro check (ultimo_erro is null or length(ultimo_erro) <= 300)
);

-- Um aviso pendente por pedido: mudancas seguidas viram um aviso so (o aviso e so gatilho).
create unique index if not exists uq_aviso_saida_pendente
  on aviso_saida (conta_id, produto, tipo, recurso_id) where entregue_em is null and desistido_em is null;
-- A rotina: o que esta na hora de sair.
create index if not exists idx_aviso_saida_devido on aviso_saida (proxima_em) where entregue_em is null and desistido_em is null;
create index if not exists idx_aviso_saida_conta on aviso_saida (conta_id, criado_em desc);

select rc_rls_conta('aviso_saida');

-- O pedido mudou de situacao (ou ganhou o motivo do teto): o aviso de quem pediu vai para a fila, se ele registrou
-- e nao esta pausado. Um pendente por pedido: a mudanca nova so marca `mudou_em` e adianta a proxima tentativa.
create or replace function rc_acao_pedido_aviso() returns trigger
language plpgsql as $$
begin
  if new.situacao is not distinct from old.situacao and new.motivo is not distinct from old.motivo then
    return new;
  end if;
  insert into aviso_saida (conta_id, produto, tipo, recurso_id)
  select new.conta_id, new.aplicativo, 'acao.alterada', new.id
    from integracao_aviso a
   where a.conta_id = new.conta_id and a.produto = new.aplicativo and a.pausado_em is null
  on conflict (conta_id, produto, tipo, recurso_id) where entregue_em is null and desistido_em is null
  do update set mudou_em = clock_timestamp(), proxima_em = least(aviso_saida.proxima_em, clock_timestamp());
  return new;
end $$;

create or replace trigger trg_acao_pedido_aviso after update of situacao, motivo on acao_pedido
  for each row execute function rc_acao_pedido_aviso();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'regemcast_app') then
    execute 'grant select, insert, update, delete on integracao_aviso to regemcast_app';
    execute 'grant select, insert, update, delete on aviso_saida to regemcast_app';
  end if;
end $$;
