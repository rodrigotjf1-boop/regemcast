-- 051_idempotencia_pela_ligacao.sql
--
-- Hub DMS F5, piloto G (16/11/2026): a escrita pela LIGACAO do clique caia sempre com "Erro interno".
-- A ligacao que nasce da autorizacao por clique nao vem de token nenhum (origem_token_id nulo, id novo,
-- migration 047). Pela ligacao, quem chama e identificado pelo id DELA (integracao.service.ts,
-- autenticarLigacao) - e a chave de idempotencia das ferramentas de escrita (migration 045) guardava esse
-- id em integracao_idempotencia.token_id, com chave estrangeira para integracao_token(id). A gravacao
-- falhava (23503), a ferramenta respondia "Erro interno", e o Liame lia "fora do ar" e desistia depois de
-- tres tentativas: rascunho de modelo e de campanha, nada saia pela via nova.
--
-- Esta migration tira a chave estrangeira: o dono da chave de idempotencia passa a ser a CREDENCIAL que
-- pediu - o id do token (rct_it_) OU o da ligacao do DMS ID -, como ja e no pedido de acao (acao_pedido,
-- migration 048, sem chave estrangeira). Os ids sao uuid de tabelas diferentes: nao se confundem. O indice
-- unico (token_id, ferramenta, chave) segue igual. A limpeza nao depende da cascata: a rotina
-- idempotencia.job.ts apaga as chaves com mais de 24 horas.
--
-- Tem `drop constraint`: vai pelo SQL Editor do Supabase (o MCP recusa instrucao com drop - LIC-171), com a
-- linha do livro (schema_migrations, sha256 do arquivo com LF) no mesmo Run. Idempotente.

set local lock_timeout = '10s';

alter table integracao_idempotencia drop constraint if exists integracao_idempotencia_token_id_fkey;

comment on column integracao_idempotencia.token_id is
  'A credencial que pediu: o id do token de integracao (rct_it_) ou o da ligacao do DMS ID. Sem chave estrangeira (migration 051): a ligacao do clique nao vem de token.';

-- Conferencia no MESMO Run: a linha tem de vir com `ok = true`.
select 'integracao_idempotencia sem chave estrangeira para integracao_token' as objeto,
       not exists (
         select 1 from pg_constraint c
          where c.conrelid = to_regclass(current_schema() || '.integracao_idempotencia')
            and c.contype = 'f'
            and pg_get_constraintdef(c.oid) like '%integracao_token%'
       ) as ok;
