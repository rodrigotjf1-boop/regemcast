-- 045_integracao_escrita.sql
--
-- O que a porta MCP precisa para ESCREVER: rascunho de modelo e de campanha
-- feitos por outro produto da DMS.
--
-- 1. O autor "integracao" na auditoria. Ate aqui a trilha conhecia tres autores
--    (usuario, sistema, distribuicao). O que um aplicativo conectado faz passa
--    a sair com o autor `integracao` e o nome do token em `ator_nome` — nunca
--    como se fosse uma pessoa da conta, nem como "sistema".
--    Trocar o `check` exige derruba-lo e cria-lo de novo: por isso este arquivo
--    tem `drop constraint` e vai pelo SQL Editor.
--
-- 2. De onde veio o rascunho. `campanha.integracao_produto` e
--    `modelo.integracao_produto` guardam o produto que montou (ex.: `liame`).
--    Vazio = feito por uma pessoa, na tela. E o que a tela usa para dizer
--    "montada pelo Liame".
--
-- 3. A chave de idempotencia. Quem integra repete o pedido quando a rede cai
--    no meio; a mesma chave com o mesmo pedido devolve a mesma resposta, sem
--    criar de novo. A linha nasce na MESMA transacao da acao: so existe se a
--    acao confirmou. Guardada por 24 horas.
--
-- Idempotente: pode rodar de novo.

set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. o autor

alter table auditoria drop constraint if exists auditoria_ator_tipo_check;
alter table auditoria add constraint auditoria_ator_tipo_check
  check (ator_tipo in ('usuario', 'sistema', 'distribuicao', 'integracao'));

-- ------------------------------------------------------- 2. de onde veio

alter table campanha add column if not exists integracao_produto text;
alter table modelo add column if not exists integracao_produto text;

comment on column campanha.integracao_produto is
  'O produto que montou a campanha pela porta MCP (ex.: liame). Nulo = montada por uma pessoa, na tela.';
comment on column modelo.integracao_produto is
  'O produto que criou o rascunho pela porta MCP (ex.: liame). Nulo = criado por uma pessoa, na tela.';

-- ------------------------------------------------ 3. a chave de idempotencia

create table if not exists integracao_idempotencia (
  id          uuid primary key default gen_random_uuid(),
  conta_id    uuid not null references conta(id) on delete cascade,
  token_id    uuid not null references integracao_token(id) on delete cascade,
  ferramenta  text not null,
  chave       text not null,
  -- sha-256 do pedido: a mesma chave com outro pedido e recusada.
  pedido_hash text not null,
  -- A resposta que a acao deu. Nula so dentro da transacao que a esta criando.
  resposta    jsonb,
  criado_em   timestamptz not null default now()
);

create unique index if not exists idx_integracao_idempotencia_chave
  on integracao_idempotencia (token_id, ferramenta, chave);
create index if not exists idx_integracao_idempotencia_prazo on integracao_idempotencia (criado_em);

select rc_rls_conta('integracao_idempotencia');

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'regemcast_app') then
    execute 'grant select, insert, update, delete on integracao_idempotencia to regemcast_app';
  end if;
end $$;

comment on table integracao_idempotencia is
  'Chaves de idempotencia das ferramentas de escrita da porta MCP: a mesma chave com o mesmo pedido devolve a resposta guardada. A linha nasce na transacao da acao e sai depois de 24 horas.';
