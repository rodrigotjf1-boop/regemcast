-- 030_publicos.sql — Públicos pelas compras: o bairro e o jeito de comprar de cada contato; blocos a partir de um público.
--
-- Os públicos prontos (VIP, faixas de ticket, "um pedido só", "rumo ao 10º
-- pedido", entrega × retirada × salão, bairro, aniversariantes) são CALCULADOS
-- na consulta, como os perfis — menos dois dados que dependem de olhar todas
-- as compras do contato e por isso ficam guardados no próprio contato,
-- refeitos a cada sincronização junto com os totais:
--
-- * `bairro` — o bairro mais frequente nas entregas;
-- * `tipo_preferido` — entrega, retirada ou salão, o que ele mais faz.
--
-- O bairro é dado pessoal: anonimizar o contato apaga os dois.
--
-- `lista_divisao.origem` ganha `publico`: dividir um público em blocos.
--
-- Os contatos que JÁ têm compras recebem os dois dados aqui mesmo.
--
-- Idempotente.

alter table contato add column if not exists bairro text;
alter table contato add column if not exists tipo_preferido text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_contato_tipo_preferido') then
    alter table contato add constraint ck_contato_tipo_preferido
      check (tipo_preferido in ('entrega', 'retirada', 'salao'));
  end if;
end $$;

comment on column contato.bairro is
  'Bairro mais frequente nas entregas (das compras). Dado pessoal: sai na anonimizacao.';
comment on column contato.tipo_preferido is
  'entrega | retirada | salao: o que o contato mais faz nas compras.';

-- Blocos a partir de um público pronto.
alter table lista_divisao drop constraint if exists lista_divisao_origem_check;
alter table lista_divisao add constraint lista_divisao_origem_check
  check (origem in ('lista', 'importacao', 'base', 'perfil', 'regiao', 'publico'));

-- Quem já tem compras: bairro e jeito de comprar, a partir delas.
update contato c
   set bairro = b.bairro,
       tipo_preferido = t.tipo
  from (select distinct contato_id from compra) k
  left join lateral (
    -- O bairro que mais aparece (sem ligar para maiúscula; empate: o mais
    -- recente) e, dentro dele, a grafia mais usada, de preferência com inicial
    -- maiúscula. A mesma regra de recalcularTotais (cardapioweb.pedidos.service.ts).
    select x.bairro
      from compra x
     where x.contato_id = k.contato_id and x.bairro is not null
     group by x.bairro
     order by sum(count(*)) over (partition by lower(x.bairro)) desc,
              max(max(x.feita_em)) over (partition by lower(x.bairro)) desc,
              count(*) desc, (x.bairro ~ '^[[:upper:]]') desc, x.bairro
     limit 1
  ) b on true
  left join lateral (
    select x.tipo
      from compra x
     where x.contato_id = k.contato_id and x.tipo in ('entrega', 'retirada', 'salao')
     group by x.tipo
     order by count(*) desc, max(x.feita_em) desc
     limit 1
  ) t on true
 where c.id = k.contato_id
   and (c.bairro is distinct from b.bairro or c.tipo_preferido is distinct from t.tipo);
