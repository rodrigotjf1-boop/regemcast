-- 032_habitos_compra.sql — Hábitos de compra: o período do dia em que cada contato costuma pedir e os produtos que já comprou.
--
-- Decisões do dono (25/09/2026, Fase 4B):
--
-- * PERÍODO: a hora de cada compra, no fuso da conta (`conta.timezone`), cai
--   num período do dia — madrugada (0h às 6h), café da manhã (6h às 11h),
--   almoço (11h às 15h), tarde (15h às 18h) e noite (18h à meia-noite). O que
--   mais aparece nas compras do contato (empate: o da compra mais recente) fica
--   em `contato.periodo_preferido`, refeito a cada sincronização junto com os
--   totais e quando a conta troca de fuso. Vira público ("Pedem à noite") e a
--   campanha sugere a janela de envio.
-- * PRODUTOS: `contato_produto` guarda, por contato, cada produto que ele já
--   comprou — em quantas compras e quando foi a última —, refeito junto com os
--   totais. É o que responde "quem já comprou pizza doce?" sem abrir todas as
--   compras a cada consulta: com 100 mil compras e a RLS ligada, a contagem do
--   público cai de 0,7 s para 0,04 s. O favorito do contato é o produto com
--   mais compras.
--
-- Produto é pelo nome, sem ligar para maiúscula (`chave` = o nome em
-- minúsculas); a grafia mostrada é a mais usada, com desempate explícito — não
-- a que a ordenação do banco puser primeiro. Apagar o contato apaga os
-- produtos dele (cascata); anonimizar também (no código, junto com as compras).
--
-- Os contatos que JÁ têm compras recebem o período e os produtos aqui mesmo,
-- com a mesma regra do código (`contato/habitos.ts`).
--
-- Idempotente.

-- ---------------------------------------------------------------- período
alter table contato add column if not exists periodo_preferido text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_contato_periodo_preferido') then
    alter table contato add constraint ck_contato_periodo_preferido
      check (periodo_preferido in ('madrugada', 'cafe', 'almoco', 'tarde', 'noite'));
  end if;
end $$;

comment on column contato.periodo_preferido is
  'madrugada | cafe | almoco | tarde | noite: o periodo do dia, no fuso da conta, em que o contato mais compra.';

-- ---------------------------------------------------------------- produtos
create table if not exists contato_produto (
  conta_id    uuid not null references conta(id) on delete cascade,
  contato_id  uuid not null references contato(id) on delete cascade,
  -- O nome em minúsculas: "Pizza Calabresa" e "pizza calabresa" são o mesmo produto.
  chave       text not null,
  -- A grafia que este contato mais comprou.
  nome        text not null,
  -- Em quantas compras o produto veio, e a última delas.
  compras     integer not null check (compras > 0),
  ultima_em   timestamptz not null,
  primary key (contato_id, chave)
);

comment on table contato_produto is
  'Produtos que cada contato ja comprou, tirados das compras e refeitos junto com os totais. So para segmentar.';

select rc_rls_conta('contato_produto');

-- "Quem já comprou X", dentro da conta.
create index if not exists idx_contato_produto_chave on contato_produto (conta_id, chave);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'regemcast_app') then
    execute 'grant select, insert, update, delete on contato_produto to regemcast_app';
  end if;
end $$;

-- ---------------------------------------------------------------- quem já tem compras
-- Os produtos: por grafia primeiro (em quantas compras e a última), depois
-- juntando as grafias do mesmo nome — a mais usada vence; empate: a mais
-- recente, depois a com inicial maiúscula.
insert into contato_produto (conta_id, contato_id, chave, nome, compras, ultima_em)
select s.conta_id, s.contato_id, s.chave,
       (array_agg(s.nome order by s.qtd desc, s.ultima desc, (s.nome ~ '^[[:upper:]]') desc, s.nome))[1],
       sum(s.qtd)::int,
       max(s.ultima)
  from (
    select x.conta_id, x.contato_id, lower(i.item->>'n') as chave, i.item->>'n' as nome,
           count(distinct x.id) as qtd, max(x.feita_em) as ultima
      from compra x
     cross join lateral jsonb_array_elements(
             case when jsonb_typeof(x.itens) = 'array' then x.itens else '[]'::jsonb end
           ) as i(item)
     where coalesce(btrim(i.item->>'n'), '') <> ''
     group by 1, 2, 3, 4
  ) s
 group by s.conta_id, s.contato_id, s.chave
on conflict (contato_id, chave) do update
   set nome = excluded.nome, compras = excluded.compras, ultima_em = excluded.ultima_em;

-- O período: a hora de cada compra no fuso da conta; o que mais aparece vence,
-- empate: o da compra mais recente.
update contato c
   set periodo_preferido = p.periodo
  from (select distinct contato_id from compra) k
  join lateral (
    select y.periodo
      from (
        select case
                 when extract(hour from x.feita_em at time zone ct.timezone) < 6 then 'madrugada'
                 when extract(hour from x.feita_em at time zone ct.timezone) < 11 then 'cafe'
                 when extract(hour from x.feita_em at time zone ct.timezone) < 15 then 'almoco'
                 when extract(hour from x.feita_em at time zone ct.timezone) < 18 then 'tarde'
                 else 'noite'
               end as periodo,
               x.feita_em
          from compra x
          join conta ct on ct.id = x.conta_id
         where x.contato_id = k.contato_id
      ) y
     group by y.periodo
     order by count(*) desc, max(y.feita_em) desc
     limit 1
  ) p on true
 where c.id = k.contato_id
   and c.periodo_preferido is distinct from p.periodo;
