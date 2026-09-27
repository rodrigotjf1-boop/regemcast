-- 034_cashback_cardapioweb.sql — O cashback do Cardápio Web em cada contato, a leitura diária e a campanha que fala do saldo.
--
-- Fase 4C (decisão do dono em 25/09/2026; plano aprovado em 27/09/2026):
--
-- * `contato.cashback_centavos`, `cashback_vence_em`, `cashback_em` — o saldo
--   de cashback do cliente no Cardápio Web (a API manda reais com centavos;
--   aqui fica em centavos inteiros), o dia em que vence e quando foi lido.
--   Nulo = nunca lido (a loja não usa o Cardápio Web, ou o cliente não está
--   lá). O índice é só de quem tem saldo: os públicos "Têm cashback" e
--   "Cashback vence em até 7 dias" e a coluna da tela de Contatos.
-- * `campanha.variaveis_lista` — de onde sai cada variável da campanha (texto
--   fixo, nome, saldo do cashback…). A conferência na hora do envio usa: quem
--   perdeu o cashback entre a montagem e o envio não recebe, e quem ainda tem
--   recebe o saldo do dia.
-- * `integracao_cardapioweb.saldos_*` — o andamento da leitura diária da lista
--   de clientes (às 4h, no fuso da conta): a página, o início, a próxima
--   leitura, a trava entre processos e o erro.
--
-- Nenhuma tabela nova: as três já têm RLS. Idempotente.

-- `contato` é tabela quente (webhook, disparo): se alguma consulta longa
-- segurar a tabela, o `alter` desiste em 10 s em vez de enfileirar todo o
-- resto atrás dele. Aí é só rodar de novo.
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- contato
alter table contato add column if not exists cashback_centavos integer;
alter table contato add column if not exists cashback_vence_em date;
alter table contato add column if not exists cashback_em timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_contato_cashback_centavos') then
    alter table contato add constraint ck_contato_cashback_centavos
      check (cashback_centavos is null or cashback_centavos >= 0);
  end if;
end $$;

comment on column contato.cashback_centavos is
  'Saldo de cashback do cliente no Cardapio Web, em centavos. Nulo = nunca lido.';
comment on column contato.cashback_vence_em is
  'Dia em que o saldo de cashback vence (Cardapio Web). Nulo = sem data.';
comment on column contato.cashback_em is
  'Quando o saldo de cashback foi lido do Cardapio Web.';

create index if not exists idx_contato_cashback
  on contato (conta_id, cashback_vence_em) where cashback_centavos > 0;

-- ---------------------------------------------------------------- campanha
alter table campanha add column if not exists variaveis_lista jsonb;

comment on column campanha.variaveis_lista is
  'De onde sai cada variavel (fixo, nome, primeiro_nome, cashback_saldo, cashback_validade), em ordem. Nulo = numeros digitados ou campanha antiga.';

-- ---------------------------------------------------------------- leitura diária
alter table integracao_cardapioweb add column if not exists saldos_pagina integer not null default 0;
alter table integracao_cardapioweb add column if not exists saldos_iniciada_em timestamptz;
alter table integracao_cardapioweb add column if not exists saldos_proxima_em timestamptz;
alter table integracao_cardapioweb add column if not exists saldos_trava_ate timestamptz;
alter table integracao_cardapioweb add column if not exists saldos_concluida_em timestamptz;
alter table integracao_cardapioweb add column if not exists saldos_erro text;
alter table integracao_cardapioweb add column if not exists saldos_atualizado_em timestamptz;

comment on column integracao_cardapioweb.saldos_pagina is
  'Leitura diaria do cashback: a ultima pagina lida (0 = parada, comeca do inicio).';
comment on column integracao_cardapioweb.saldos_proxima_em is
  'Quando a proxima leitura do cashback pode sair (4h no fuso da conta, ou a nova tentativa). Nulo = assim que der.';
