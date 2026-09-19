-- 021_contato_metricas.sql — O que o contato traz do sistema da loja: e-mail,
-- aniversário e o histórico de compra (quantos pedidos, quanto gastou, quando
-- comprou pela última vez).
--
-- É a base para classificar a base (Campeões, Fiéis, Em risco, Perdidos…) e
-- mandar campanha para quem faz sentido — reativar quem sumiu, agradecer quem
-- mais compra.
--
-- DECISÕES:
--
-- * "Dias inativo" NÃO é coluna: muda todo dia. Guardamos a data da última
--   compra e calculamos os dias na consulta. Planilha que traz "dias inativo"
--   vira data (dia da importação − dias).
-- * Dinheiro em centavos (bigint), como no resto do sistema: nada de float.
-- * `metricas_em` e `metricas_origem` dizem de quando e de onde veio a foto do
--   histórico (planilha, Cardápio Web). A importação mais nova substitui.
--
-- Idempotente: pode rodar duas vezes sem efeito diferente.

alter table contato add column if not exists email                text;
alter table contato add column if not exists data_nascimento      date;
alter table contato add column if not exists pedidos              integer;
alter table contato add column if not exists total_gasto_centavos bigint;
alter table contato add column if not exists ultimo_pedido_em     timestamptz;
alter table contato add column if not exists metricas_em          timestamptz;
alter table contato add column if not exists metricas_origem      text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_contato_pedidos') then
    alter table contato add constraint ck_contato_pedidos check (pedidos is null or pedidos >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_contato_total_gasto') then
    alter table contato add constraint ck_contato_total_gasto
      check (total_gasto_centavos is null or total_gasto_centavos >= 0);
  end if;
end $$;

-- Ordenar e filtrar a base por recência e valor (as duas perguntas da
-- classificação) sem varrer a tabela inteira.
create index if not exists idx_contato_recencia
  on contato (conta_id, ultimo_pedido_em desc nulls last)
  where opt_out = false;

comment on column contato.ultimo_pedido_em is
  'Ultima compra conhecida. Dias inativo = hoje - esta data (calculado, nunca guardado).';
comment on column contato.metricas_origem is
  'De onde veio a foto do historico de compra: planilha | cardapioweb.';
