-- 039_saude_da_conta.sql — A situação de envio que a Meta informa, guardada para a tela e para o disparo.
--
-- Etapa 2 do roteiro (01/10/2026). A Meta tem o campo `health_status` na conta
-- do WhatsApp e no número: diz se dá para enviar (AVAILABLE), se envia com
-- restrição (LIMITED) ou se está bloqueado (BLOCKED), e o que está por trás —
-- a conta, a empresa, o aplicativo, o número —, cada um com o erro e a solução
-- que ela sugere. O Regemcast não lia. No teste do dono a conta estava sem
-- pagamento configurado e isso só apareceu DEPOIS do disparo, na recusa de cada
-- mensagem (131042).
--
-- * `wa_conta.saude_estado`, `saude`, `saude_em` — o veredito da Meta para a
--   conta (`disponivel`, `limitado`, `bloqueado`), a lista do que está por trás
--   dele como ela devolveu, e quando foi lida. Nulo = ainda não lida.
-- * `wa_conta.fuso`, `pagamento_id`, `verificacao_negocio` — o fuso da cobrança,
--   o identificador da forma de pagamento e a verificação da empresa, lidos
--   junto. Sem moeda ou sem forma de pagamento a Meta aceita a mensagem e
--   recusa em seguida. A `moeda` já existia (lida uma vez, na conexão) e passa
--   a ser atualizada.
-- * `wa_numero.saude_estado`, `saude`, `saude_em` — o mesmo, por número.
--
-- Só `add column` e `add constraint`: nada é apagado nem reescrito.
-- Idempotente.

set local lock_timeout = '10s';

-- ---------------------------------------------------------------- conta do WhatsApp
alter table wa_conta add column if not exists saude_estado text;
alter table wa_conta add column if not exists saude jsonb;
alter table wa_conta add column if not exists saude_em timestamptz;
alter table wa_conta add column if not exists fuso text;
alter table wa_conta add column if not exists pagamento_id text;
alter table wa_conta add column if not exists verificacao_negocio text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_wa_conta_saude_estado') then
    alter table wa_conta add constraint ck_wa_conta_saude_estado
      check (saude_estado is null or saude_estado in ('disponivel', 'limitado', 'bloqueado'));
  end if;
end $$;

comment on column wa_conta.saude_estado is
  'O que a Meta diz do envio desta conta (health_status): disponivel, limitado ou bloqueado. Nulo = ainda nao lido.';
comment on column wa_conta.saude is
  'O health_status da conta como a Meta devolveu, ja normalizado: a lista do que esta por tras do estado (conta, empresa, aplicativo), com erros e solucoes. E se a cobranca foi lida.';
comment on column wa_conta.saude_em is 'Quando o health_status da conta foi lido na Meta.';
comment on column wa_conta.fuso is 'O fuso horario da cobranca da conta na Meta (timezone_id).';
comment on column wa_conta.pagamento_id is
  'O identificador da forma de pagamento da conta na Meta (primary_funding_id). Nulo = a Meta nao informou nenhuma.';
comment on column wa_conta.verificacao_negocio is
  'A verificacao da empresa dona da conta, como a Meta devolve (business_verification_status).';

-- ---------------------------------------------------------------- número
alter table wa_numero add column if not exists saude_estado text;
alter table wa_numero add column if not exists saude jsonb;
alter table wa_numero add column if not exists saude_em timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_wa_numero_saude_estado') then
    alter table wa_numero add constraint ck_wa_numero_saude_estado
      check (saude_estado is null or saude_estado in ('disponivel', 'limitado', 'bloqueado'));
  end if;
end $$;

comment on column wa_numero.saude_estado is
  'O que a Meta diz do envio por este numero (health_status): disponivel, limitado ou bloqueado. Nulo = ainda nao lido.';
comment on column wa_numero.saude is 'O health_status do numero, normalizado: o que esta por tras do estado, com erros e solucoes.';
comment on column wa_numero.saude_em is 'Quando o health_status do numero foi lido na Meta.';
