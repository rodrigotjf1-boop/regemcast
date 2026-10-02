-- 041_tarifa_meta.sql — A tabela de tarifas da Meta: quanto custa cada mensagem entregue.
--
-- Etapa 3 do roteiro (orçamento de disparos). Quem paga a mensagem é a conta do
-- cliente, direto à Meta; o Regemcast só precisa SABER o preço, para estimar o
-- custo antes do disparo, somar o gasto de cada campanha e travar o orçamento.
--
-- O preço depende de três coisas (página de preços da Meta, conferida em
-- 02/10/2026): a MOEDA em que a conta é cobrada, o PAÍS de quem recebe (pelo
-- código do país do telefone) e a CATEGORIA do modelo. A Meta só muda os
-- valores no primeiro dia de cada trimestre — por isso cada linha tem a data em
-- que passa a valer, e a anterior fica como histórico: o gasto de uma mensagem
-- de setembro é calculado com a tarifa de setembro.
--
-- É tabela da DISTRIBUIÇÃO, como `plano`: quem cadastra é o operador, no
-- console, a partir do arquivo oficial de tarifas da Meta. Nenhum valor é
-- semeado aqui — preço inventado é pior que preço ausente: sem tarifa
-- cadastrada, a tela diz que não sabe estimar.
--
-- * `moeda` — a moeda de cobrança da conta (`wa_conta.moeda`), em ISO 4217.
-- * `ddi` — o código do país de quem recebe ("55" = Brasil), só dígitos.
-- * `categoria` — como a Meta escreve no aviso de entrega (`pricing.category`):
--   marketing, utility, authentication… Lista aberta: só o formato é conferido.
-- * `valor` — o preço de UMA mensagem entregue, na moeda, com até 6 casas.
-- * `vigente_de` — o primeiro dia em que o valor vale.
--
-- Leitura liberada em qualquer escopo (o preço da Meta é público, e a campanha
-- do cliente precisa dele dentro da transação do pedido — ver 002); escrita só
-- no escopo de sistema. Só `create`: nada é apagado. Idempotente.

set local lock_timeout = '10s';

create table if not exists tarifa_meta (
  id            uuid primary key default gen_random_uuid(),
  moeda         text not null,
  ddi           text not null,
  categoria     text not null,
  valor         numeric(12, 6) not null,
  vigente_de    date not null,
  -- De onde o valor saiu ("arquivo de tarifas BRL de 01/07/2026"), para conferir depois.
  fonte         text,
  -- Quem cadastrou, no console (o nome do operador; o livro de acessos tem o resto).
  criado_por    text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint ck_tarifa_meta_moeda check (moeda ~ '^[A-Z]{3}$'),
  constraint ck_tarifa_meta_ddi check (ddi ~ '^[1-9][0-9]{0,3}$'),
  constraint ck_tarifa_meta_categoria check (categoria ~ '^[a-z][a-z0-9_-]{0,39}$'),
  constraint ck_tarifa_meta_valor check (valor > 0 and valor < 1000)
);

-- Uma tarifa por moeda, país, categoria e data de início.
create unique index if not exists idx_tarifa_meta_vigencia
  on tarifa_meta (moeda, ddi, categoria, vigente_de);

select rc_rls_sistema('tarifa_meta');

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'tarifa_meta' and policyname = 'rc_tarifa_meta_leitura'
  ) then
    -- `for select`: policies permissivas se somam com OR, e esta libera só a
    -- leitura. Insert, update e delete continuam passando só pela rc_sistema.
    create policy rc_tarifa_meta_leitura on tarifa_meta for select using (true);
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'tg_tarifa_meta_touch') then
    create trigger tg_tarifa_meta_touch before update on tarifa_meta
      for each row execute function rc_touch();
  end if;
end $$;

comment on table tarifa_meta is
  'Tarifas da Meta por mensagem entregue: moeda da conta, pais de quem recebe (ddi), categoria e a data em que passam a valer. Cadastradas no console de distribuicao, a partir do arquivo oficial da Meta.';
comment on policy rc_tarifa_meta_leitura on tarifa_meta is
  'O preco da Meta e publico: leitura em qualquer escopo (a campanha do cliente precisa dele na transacao do pedido), escrita so no escopo de sistema (policy rc_sistema).';
