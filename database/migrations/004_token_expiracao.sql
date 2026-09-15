-- 004_token_expiracao.sql — Quando o token do cliente vence.
--
-- O template de Embedded Signup que a Meta manda usar chama-se, literalmente,
-- "WhatsApp Embedded Signup Configuration With 60 Expiration Token": o token
-- que o cliente nos concede tem prazo.
--
-- Sem guardar esse prazo, a falha chega pelo pior caminho possível: a campanha
-- roda, a Meta responde 190 ("access token expired"), e o cliente descobre que
-- está desconectado quando as mensagens param — não antes. Guardando, dá para
-- avisar com antecedência e pedir a reconexão em hora escolhida.
--
-- Idempotente: só acrescenta coluna.

alter table wa_conta add column if not exists token_expira_em timestamptz;

comment on column wa_conta.token_expira_em is
  'Quando o token do cliente vence, conforme o expires_in que a Meta devolve na troca do code. Nulo = a Meta não informou prazo.';

-- Quem está perto de vencer, primeiro. O índice parcial deixa de fora quem não
-- tem prazo informado, que é o caso que não precisa de aviso nenhum.
create index if not exists idx_wa_conta_token_expira
  on wa_conta (token_expira_em)
  where token_expira_em is not null;
