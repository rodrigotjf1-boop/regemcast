-- 002_plano_leitura.sql — O catálogo de planos passa a ser LEGÍVEL dentro do
-- escopo do tenant. A escrita continua só no escopo de sistema.
--
-- POR QUE ESTA MIGRATION EXISTE (defeito de pool, não de banco):
-- `plano` nasceu em 001 com rc_rls_sistema(): só o escopo de sistema enxerga.
-- Mas GET /conta precisa do nome do plano e do teto de disparos para montar a
-- tela — e, dentro da transação do request (escopo tenant), a leitura voltava
-- vazia. O contorno era abrir uma SEGUNDA transação com comEscopoSistema() no
-- meio da primeira, ou seja, pegar uma segunda conexão do pool enquanto a
-- primeira ainda está ocupada. Com DATABASE_POOL_MAX=10, dez requests
-- simultâneos em GET /conta seguram uma conexão cada e pedem a segunda:
-- ninguém anda até estourar o connectionTimeout. O pool trava inteiro, e o
-- sintoma aparece como "banco lento", não como bug de código.
--
-- A correção fica onde está a causa: código, nome, preço e teto do plano são
-- exatamente o que o cliente já lê na tela de assinatura. Não é segredo da
-- distribuição nem dado de outra conta — diferente de lista_espera, que segue
-- só-sistema. Então LEITURA é liberada e ESCRITA continua só-sistema.
--
-- POR QUE A POLICY NOVA É `for select` E NÃO `for all`:
-- policies permissivas se somam com OR. Uma policy `for select using (true)`
-- libera apenas o SELECT; insert/update/delete continuam passando só pela
-- rc_sistema (for all), que exige rc_escopo_sistema(). Nenhum caminho de
-- tenant ganha escrita no catálogo — nem pelo RETURNING de um update, que
-- ainda precisa do USING da rc_sistema.
--
-- Idempotente: a criação é guardada por pg_policies.

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'plano' and policyname = 'rc_plano_leitura'
  ) then
    -- Sem filtro por `ativo`: uma conta pode estar num plano já descontinuado,
    -- e esconder a linha faria o teto de disparos voltar nulo na tela — que é
    -- justamente o sintoma que esta migration existe para acabar.
    create policy rc_plano_leitura on plano for select using (true);
  end if;
end $$;

comment on policy rc_plano_leitura on plano is
  'Catálogo de planos é público para quem está autenticado: leitura em qualquer escopo, escrita só no escopo de sistema (policy rc_sistema).';
