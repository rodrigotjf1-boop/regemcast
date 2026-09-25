-- 029_compras.sql — O resumo de cada compra, trazido do cardápio digital, para segmentar campanhas.
--
-- Decisão do dono (25/09/2026, "opção B"): as integrações trazem clientes E
-- compras. Guardamos o RESUMO de cada compra — data, valor, entrega/retirada/
-- salão, bairro e os itens —, e os totais do contato (pedidos, gasto, primeira
-- e última compra) são recalculados a partir daqui a cada sincronização.
--
-- O Regemcast NÃO gerencia pedido: nada de status de cozinha, pagamento,
-- endereço completo ou observação (texto livre pode ter dado pessoal). É o que
-- basta para "quem sumiu há 30 dias", "quem gasta mais", "quem pede entrega no
-- bairro X", "quem compra pizza doce".
--
-- Só compra de CONTATO que pode receber: quem pediu para sair não tem as
-- compras guardadas (minimização). Apagar o contato apaga as compras dele
-- (cascata). Guarda de até 3 anos — o que o Cardápio Web devolve de histórico.
--
-- A sincronização de pedidos do Cardápio Web ganha o seu estado em
-- `integracao_cardapioweb`: a carga do histórico (janela de 6 meses por vez,
-- página a página, retomável depois de qualquer reinício) e a consulta
-- periódica dos pedidos novos. A trava (`pedidos_trava_ate`) garante que só um
-- processo cuide de cada loja por vez.
--
-- Idempotente.

create table if not exists compra (
  id                  uuid primary key default gen_random_uuid(),
  conta_id            uuid not null references conta(id) on delete cascade,
  contato_id          uuid not null references contato(id) on delete cascade,

  -- De onde veio e o id lá: a mesma compra nunca entra duas vezes.
  fonte               text not null check (fonte in ('cardapioweb', 'regem')),
  id_externo          text not null,

  -- A data do pedido (criação), não a da sincronização.
  feita_em            timestamptz not null,
  valor_centavos      bigint not null check (valor_centavos >= 0),
  tipo                text not null default 'outro'
                      check (tipo in ('entrega', 'retirada', 'salao', 'outro')),
  -- O canal da fonte (cardápio, site, WhatsApp…), como ela chama.
  canal               text,
  bairro              text,
  -- [{ "n": nome, "q": quantidade, "v": valor em centavos }] — só o necessário.
  itens               jsonb not null default '[]'::jsonb,
  -- Quando a fonte mudou o pedido pela última vez: saber se precisa reler.
  atualizada_na_fonte timestamptz,

  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

comment on table compra is
  'Resumo de cada compra trazida de uma integracao (so para segmentar). Totais do contato saem daqui.';

select rc_rls_conta('compra');

drop trigger if exists tg_compra_touch on compra;
create trigger tg_compra_touch before update on compra
  for each row execute function rc_touch();

create unique index if not exists idx_compra_externa on compra (conta_id, fonte, id_externo);
create index if not exists idx_compra_contato on compra (contato_id, feita_em desc);
create index if not exists idx_compra_conta_data on compra (conta_id, feita_em);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'regemcast_app') then
    execute 'grant select, insert, update, delete on compra to regemcast_app';
  end if;
end $$;

-- A primeira compra: "novo cliente" e "cliente desde".
alter table contato add column if not exists primeiro_pedido_em timestamptz;

-- ---------------------------------------------------------------- sincronização de pedidos

alter table integracao_cardapioweb add column if not exists pedidos_status text not null default 'parado';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_integracao_cw_pedidos_status') then
    alter table integracao_cardapioweb add constraint ck_integracao_cw_pedidos_status
      check (pedidos_status in ('parado', 'carga', 'em_dia', 'falhou'));
  end if;
end $$;

-- A carga do histórico: de quando a quando, e onde parou (janela + página).
alter table integracao_cardapioweb add column if not exists pedidos_carga_de       timestamptz;
alter table integracao_cardapioweb add column if not exists pedidos_carga_ate      timestamptz;
alter table integracao_cardapioweb add column if not exists pedidos_janela_de      timestamptz;
alter table integracao_cardapioweb add column if not exists pedidos_pagina         integer not null default 0;
alter table integracao_cardapioweb add column if not exists pedidos_total_estimado integer;
alter table integracao_cardapioweb add column if not exists pedidos_lidos          integer not null default 0;
alter table integracao_cardapioweb add column if not exists pedidos_gravados       integer not null default 0;
alter table integracao_cardapioweb add column if not exists pedidos_ignorados      integer not null default 0;
-- Em dia: a última consulta dos pedidos alterados.
alter table integracao_cardapioweb add column if not exists pedidos_ultima_consulta timestamptz;
-- Um processo por loja, e o ritmo que a API permite.
alter table integracao_cardapioweb add column if not exists pedidos_trava_ate      timestamptz;
alter table integracao_cardapioweb add column if not exists pedidos_proximo_em     timestamptz;
alter table integracao_cardapioweb add column if not exists pedidos_erro           text;
alter table integracao_cardapioweb add column if not exists pedidos_atualizado_em  timestamptz;
