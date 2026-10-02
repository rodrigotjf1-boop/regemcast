-- 040_renovacao_da_autorizacao.sql — Quando a renovação da autorização foi tentada, e com que resultado.
--
-- A autorização do cliente (o token do Embedded Signup) vence em 60 dias. A
-- Meta tem uma renovação oficial enquanto ela ainda vale
-- (`oauth/access_token?grant_type=fb_exchange_token&set_token_expires_in_60_days=true`):
-- o servidor passa a renovar sozinho, e o dono só precisa "reconectar" quando a
-- conexão já caiu.
--
-- * `wa_conta.token_renovacao_em` — quando a renovação foi tentada pela última
--   vez. É o que espaça as tentativas (uma por dia quando falha).
-- * `wa_conta.token_renovacao_erro` — com que código a Meta recusou a última
--   tentativa (-1 = sem código: rede, tempo esgotado). Nulo = deu certo, ou
--   nunca foi tentada. Fica no banco, e não só no log, porque é por aqui que se
--   descobre se a Meta aceita renovar este tipo de autorização.
--
-- Só `add column`: nada é apagado nem reescrito. Idempotente.

set local lock_timeout = '10s';

alter table wa_conta add column if not exists token_renovacao_em timestamptz;
alter table wa_conta add column if not exists token_renovacao_erro integer;

comment on column wa_conta.token_renovacao_em is
  'Quando a renovacao automatica da autorizacao foi tentada pela ultima vez.';
comment on column wa_conta.token_renovacao_erro is
  'O codigo com que a Meta recusou a ultima tentativa de renovar a autorizacao (-1 = sem codigo). Nulo = deu certo, ou nunca foi tentada.';
