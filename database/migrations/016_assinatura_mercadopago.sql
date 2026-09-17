-- 016_assinatura_mercadopago.sql — Assinatura paga pelo Mercado Pago, pagamentos e inadimplência.
--
-- Fases 2 e 3 da cobrança, num arquivo só para o banco nascer inteiro:
--
--   - a assinatura guarda o vínculo com a assinatura do Mercado Pago (preapproval)
--     e qual plano foi contratado — inclusive o que vale só no próximo ciclo;
--   - cada cobrança do Mercado Pago vira uma linha em `cobranca`, visível ao
--     cliente no histórico de pagamentos;
--   - cada aviso (webhook) recebido fica registrado em `evento_mercadopago`: é o
--     que torna o processamento idempotente (o Mercado Pago reenvia o mesmo aviso
--     várias vezes) e o que responde "o aviso chegou?" quando algo não bate;
--   - a inadimplência ganha data de início, para contar a carência;
--   - a campanha pode pausar por inadimplência.
--
-- Idempotente: pode rodar duas vezes sem efeito diferente.

-- ----------------------------------------------------------------- assinatura

-- Id da assinatura no Mercado Pago (preapproval). Nulo = nunca contratou.
alter table assinatura add column if not exists mp_assinatura_id text;
-- Estado LÁ: pending | authorized | paused | cancelled. O `status` desta tabela
-- continua sendo o nosso; este é o espelho do que o Mercado Pago diz.
alter table assinatura add column if not exists mp_status text;
-- Link do checkout, para retomar uma contratação que ficou pela metade.
alter table assinatura add column if not exists mp_checkout_url text;
-- O plano da assinatura do Mercado Pago (pendente ou ativa).
alter table assinatura add column if not exists plano_contratado_id uuid references plano(id) on delete set null;
-- Troca para um plano MENOR: vale só na virada do ciclo, para não tirar do
-- cliente disparos que ele já pagou neste mês.
alter table assinatura add column if not exists plano_proximo_ciclo_id uuid references plano(id) on delete set null;
-- Desde quando está inadimplente. É daqui que a carência é contada.
alter table assinatura add column if not exists inadimplente_desde timestamptz;
-- Avisos de fim do grátis já enviados (d7, d3, d0), para não mandar duas vezes.
alter table assinatura add column if not exists avisos_enviados text[] not null default '{}';

create unique index if not exists uq_assinatura_mp
  on assinatura (mp_assinatura_id) where mp_assinatura_id is not null;

comment on column assinatura.mp_status is
  'Estado da assinatura no Mercado Pago (pending/authorized/paused/cancelled). Espelho; o status nosso e a coluna status.';

-- -------------------------------------------------------------------- cobranca

-- Uma cobrança do Mercado Pago: cada mês da assinatura é uma. O cliente vê o
-- próprio histórico, por isso a RLS é por conta.
create table if not exists cobranca (
  id               uuid primary key default gen_random_uuid(),
  conta_id         uuid not null references conta(id) on delete cascade,
  assinatura_id    uuid references assinatura(id) on delete set null,
  plano_id         uuid references plano(id) on delete set null,

  -- A "fatura" da assinatura no Mercado Pago (authorized_payment). Um por mês.
  mp_fatura_id     text,
  -- O pagamento em si, quando existe (a fatura pode ser tentada mais de uma vez).
  mp_pagamento_id  text,

  valor_centavos   integer not null,

  -- pendente  — agendada ou tentando cobrar
  -- aprovada  — pago
  -- recusada  — a cobrança falhou (o Mercado Pago ainda pode tentar de novo)
  -- cancelada — não será mais cobrada
  -- estornada — foi paga e devolvida
  status           text not null default 'pendente'
                   check (status in ('pendente','aprovada','recusada','cancelada','estornada')),

  -- Como pagou (cartão, pix, boleto…), como o Mercado Pago informar.
  meio             text,
  vencimento       timestamptz,
  pago_em          timestamptz,
  -- Motivo da recusa, em texto para o cliente.
  motivo           text,

  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

select rc_rls_conta('cobranca');

create unique index if not exists uq_cobranca_fatura
  on cobranca (mp_fatura_id) where mp_fatura_id is not null;

create index if not exists idx_cobranca_conta
  on cobranca (conta_id, criado_em desc);

drop trigger if exists tg_cobranca_touch on cobranca;
create trigger tg_cobranca_touch before update on cobranca
  for each row execute function rc_touch();

-- ---------------------------------------------------------- evento_mercadopago

-- Cada aviso recebido do Mercado Pago. Escopo de sistema: é da distribuição.
create table if not exists evento_mercadopago (
  id             bigserial primary key,
  -- subscription_preapproval | subscription_authorized_payment | payment | …
  topico         text not null,
  -- O id do recurso no Mercado Pago (data.id).
  recurso_id     text not null,
  -- x-request-id: o mesmo aviso reenviado chega com o mesmo valor.
  request_id     text,
  -- A assinatura do aviso conferiu? Aviso sem assinatura válida é gravado (para
  -- investigar) e NUNCA processado.
  assinatura_ok  boolean not null default false,
  processado_em  timestamptz,
  erro           text,
  recebido_em    timestamptz not null default now()
);

select rc_rls_sistema('evento_mercadopago');

create unique index if not exists uq_evento_mercadopago_request
  on evento_mercadopago (topico, recurso_id, request_id) where request_id is not null;

create index if not exists idx_evento_mercadopago_tempo
  on evento_mercadopago (recebido_em desc);

-- -------------------------------------------------------------------- campanha

-- A campanha também pausa quando a conta passa da carência sem pagar.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'ck_campanha_pausa_motivo') then
    alter table campanha drop constraint ck_campanha_pausa_motivo;
  end if;
  alter table campanha add constraint ck_campanha_pausa_motivo
    check (pausa_motivo is null or pausa_motivo in ('conexao', 'teto_plano', 'inadimplencia'));
end $$;
