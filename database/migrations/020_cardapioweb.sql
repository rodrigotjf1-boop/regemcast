-- 020_cardapioweb.sql — Conexão com o Cardápio Web: importar a base de clientes
-- da loja do cliente.
--
-- Uma linha por conta (uma loja do Cardápio Web por conta, como 1 conta = 1
-- WABA). Guarda a credencial CIFRADA — a chave da loja (modo legado, X-API-KEY)
-- hoje, ou os tokens OAuth quando o app "Regemcast" estiver na CW App Store — e
-- o andamento da sincronização, para ela continuar de onde parou se o servidor
-- reiniciar no meio.
--
-- Quem é dono do dado: o restaurante (controlador). O Cardápio Web e o
-- Regemcast são operadores. A autorização é a conexão feita pelo dono da conta,
-- com a declaração de consentimento registrada em `consentimento_*`.
--
-- Idempotente: pode rodar duas vezes sem efeito diferente.

create table if not exists integracao_cardapioweb (
  id                 uuid primary key default gen_random_uuid(),
  conta_id           uuid not null references conta(id) on delete cascade,

  -- chave = X-API-KEY gerada pela loja no Portal (legado)
  -- oauth = app instalado pela CW App Store (access + refresh)
  modo               text not null default 'chave' check (modo in ('chave','oauth')),
  ambiente           text not null default 'producao' check (ambiente in ('producao','sandbox')),
  credencial_cifrada text,
  refresh_cifrado    text,
  token_expira_em    timestamptz,

  -- A loja, como o Cardápio Web devolve em GET /merchant.
  loja_id            text,
  loja_nome          text,

  -- ---- sincronização da base de clientes
  sinc_status        text not null default 'parada'
                     check (sinc_status in ('parada','rodando','concluida','falhou')),
  sinc_pagina        integer not null default 0,
  sinc_total_paginas integer,
  sinc_lidos         integer not null default 0,
  sinc_novos         integer not null default 0,
  sinc_bloqueados    integer not null default 0,
  sinc_invalidos     integer not null default 0,
  sinc_iniciada_em   timestamptz,
  sinc_concluida_em  timestamptz,
  sinc_erro          text,
  lista_id           uuid references contato_lista(id) on delete set null,
  importacao_id      uuid references importacao(id) on delete set null,

  -- Quem declarou que os clientes autorizaram mensagens, e quando.
  consentimento_por  uuid references usuario(id) on delete set null,
  consentimento_em   timestamptz,

  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);

create unique index if not exists idx_integracao_cardapioweb_conta
  on integracao_cardapioweb (conta_id);

-- O trabalho que sobrevive a reinício procura só o que está rodando.
create index if not exists idx_integracao_cardapioweb_rodando
  on integracao_cardapioweb (atualizado_em)
  where sinc_status = 'rodando';

comment on table integracao_cardapioweb is
  'Conexao com a loja do Cardapio Web. Credencial cifrada; andamento da importacao da base de clientes.';

select rc_rls_conta('integracao_cardapioweb');

drop trigger if exists tg_integracao_cardapioweb_touch on integracao_cardapioweb;
create trigger tg_integracao_cardapioweb_touch before update on integracao_cardapioweb
  for each row execute function rc_touch();

-- ---------------------------------------------------------------- importação
--
-- A importação vinda do Cardápio Web também deixa registro (quantos, quando,
-- quem), como a de arquivo.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'importacao_formato_check') then
    alter table importacao drop constraint importacao_formato_check;
  end if;
  alter table importacao add constraint importacao_formato_check
    check (formato in ('vcard','csv','xlsx','texto','cardapioweb'));
end $$;

-- ---------------------------------------------------------------- grants

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'regemcast_app') then
    execute 'grant select, insert, update, delete on integracao_cardapioweb to regemcast_app';
  end if;
end $$;
