-- Conferência do banco na nuvem. Rode INTEIRO no SQL Editor do Supabase
-- (uma query só, devolve uma linha por item) e me mande o resultado.
select 'ledger existe'            as item,
       coalesce(to_regclass('public.schema_migrations')::text, 'NAO') as valor
union all
select 'migrations no ledger',
       coalesce((select string_agg(arquivo, ', ' order by arquivo)
                   from schema_migrations), '(ledger vazio ou inexistente)')
union all
select 'tabelas criadas',
       (select string_agg(relname, ', ' order by relname)
          from pg_class
         where relnamespace = 'public'::regnamespace and relkind = 'r')
union all
select 'policies (esperado 8)',
       (select count(*)::text from pg_policies where schemaname = 'public')
union all
select 'policy da migration 002',
       case when exists (select 1 from pg_policies
                          where schemaname='public' and policyname='rc_plano_leitura')
            then 'presente' else 'FALTA — a 002 nao foi aplicada' end
union all
select 'app ignora RLS?',
       (select rolbypassrls::text from pg_roles where rolname='regemcast_app')
union all
select 'tabelas sem RLS forcada',
       coalesce((select string_agg(relname, ', ' order by relname)
                   from pg_class
                  where relnamespace='public'::regnamespace and relkind='r'
                    and not relforcerowsecurity
                    and relname <> 'schema_migrations'), '(nenhuma — correto)')
union all
select 'plano semeado',
       coalesce((select string_agg(codigo, ', ') from plano), '(vazio)');
