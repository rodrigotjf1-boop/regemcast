-- 033_campanha_publico_da_base.sql — A campanha para "toda a base", uma importação, um perfil ou um público, sem precisar de lista.
--
-- Pedido do dono (26/09/2026): os contatos importados sem lista — as planilhas
-- exportadas do Cardápio Web, por exemplo — não apareciam em "Quem recebe": a
-- campanha só aceitava uma lista ou números digitados. Agora aceita também um
-- público da base: toda a base, uma importação, um perfil ou um público pronto
-- (VIP, "Pedem à noite", "Já compraram…", bairro, engajamento…).
--
-- Como com a lista, o público é uma FOTO tirada ao montar a campanha: os
-- destinatários são copiados na hora. A campanha guarda de onde ele veio e o
-- nome que o cartão mostra:
--
-- * `publico_origem` — lista | numeros | base | importacao | perfil | publico | regiao;
-- * `publico_rotulo` — "Toda a base", "Importação: clientes.xlsx", "Perfil: Em risco", "Pedem à noite"…
--
-- As campanhas que já existem ganham a origem pelo que têm (lista ou números).
--
-- `contato.importacao_id` ganha índice: a tela conta, para cada importação,
-- quantos ainda podem receber.
--
-- Idempotente.

alter table campanha add column if not exists publico_origem text;
alter table campanha add column if not exists publico_rotulo text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_campanha_publico_origem') then
    alter table campanha add constraint ck_campanha_publico_origem
      check (publico_origem is null
             or publico_origem in ('lista', 'numeros', 'base', 'importacao', 'perfil', 'publico', 'regiao'));
  end if;
end $$;

comment on column campanha.publico_origem is
  'De onde saiu o publico: lista | numeros | base | importacao | perfil | publico | regiao.';
comment on column campanha.publico_rotulo is
  'O nome do publico que o cartao da campanha mostra ("Toda a base", "Pedem a noite"...). Nulo para lista e numeros.';

update campanha
   set publico_origem = case when lista_id is not null then 'lista' else 'numeros' end
 where publico_origem is null;

create index if not exists idx_contato_importacao on contato (importacao_id) where importacao_id is not null;
