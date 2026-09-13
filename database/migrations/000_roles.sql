-- 000_roles.sql — Roles do banco. RODA UMA VEZ, COMO SUPERUSUÁRIO.
--
-- Separado das demais migrations de propósito: criar role exige privilégio que
-- o usuário da aplicação não tem (e não deve ter). No Supabase, rode este
-- arquivo pelo SQL Editor logado como postgres; nas migrations seguintes o
-- runner usa regemcast_app.
--
-- A lição vem do Regem: lá a migration de RLS abre com um guard que faz return
-- se o role não existir — e como criar o role era passo manual que nunca foi
-- feito, a RLS nunca chegou a ser criada. Aqui o role vem PRIMEIRO, e o
-- runner recusa aplicar 001 sem ele.
--
-- Troque a senha antes de rodar. Ela vai para DATABASE_URL.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'regemcast_app') then
    -- Sem bypassrls, sem createdb, sem createrole, sem superuser: este role
    -- é EXATAMENTE o que a API precisa e nada além.
    create role regemcast_app login password 'TROQUE_ESTA_SENHA'
      nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end $$;

-- Sem DDL: migration é aplicada por outro caminho (ver docs/banco.md).
revoke create on schema public from regemcast_app;
grant usage on schema public to regemcast_app;

-- Conferência rápida — as três colunas precisam voltar false.
--   select rolsuper, rolcreaterole, rolbypassrls
--     from pg_roles where rolname = 'regemcast_app';
