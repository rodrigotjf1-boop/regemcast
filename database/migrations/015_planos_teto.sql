-- 015_planos_teto.sql — As faixas pagas e o motivo de uma campanha pausar.
--
-- Primeira fase da cobrança. Duas coisas:
--
--   1. O catálogo passa a ter as faixas pagas (disparos por mês, preço fixo).
--      Planos continuam editáveis no console de distribuição — os valores daqui
--      são o ponto de partida, não um preço cravado no código.
--
--   2. A campanha ganha o MOTIVO da pausa. Até aqui só existia uma pausa (a
--      conexão com a Meta caiu). Com o teto do plano valendo, uma campanha pode
--      parar por falta de disparos no ciclo — e a tela precisa dizer qual dos
--      dois aconteceu, porque o que resolve um não resolve o outro.
--
-- Idempotente: pode rodar duas vezes sem efeito diferente.

-- ---------------------------------------------------------------------- plano

-- Contratável pelo cliente. O "Primeiro mês" (cortesia) e planos internos de
-- teste existem no catálogo, mas não aparecem como opção de contratação.
alter table plano add column if not exists publico boolean not null default true;

comment on column plano.publico is
  'Aparece como opcao de contratacao para o cliente. Cortesia e planos internos: false.';

-- Plano de preço zero não é contratável: é cortesia ou teste.
update plano set publico = false where preco_centavos = 0 and publico = true;

-- As faixas. `on conflict do nothing`: se o preço já foi ajustado no console,
-- rodar a migration de novo não volta o valor antigo.
insert into plano (codigo, nome, disparos_mes, preco_centavos, ativo, ordem, publico)
values
  ('faixa_5k',  'Essencial',     5000,  3000, true, 1, true),
  ('faixa_20k', 'Profissional', 20000,  9900, true, 2, true),
  ('faixa_50k', 'Escala',       50000, 24900, true, 3, true)
on conflict (codigo) do nothing;

-- Preço e teto nunca negativos: um typo no console não pode virar plano que
-- paga o cliente ou teto que bloqueia tudo sem explicação.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_plano_valores') then
    alter table plano add constraint ck_plano_valores
      check (preco_centavos >= 0 and disparos_mes >= 0);
  end if;
end $$;

-- ------------------------------------------------------------------- campanha

-- Por que a campanha está pausada. Nulo quando não está.
--   conexao     — a conexão com a Meta caiu antes de terminar
--   teto_plano  — acabaram os disparos do plano neste ciclo
alter table campanha add column if not exists pausa_motivo text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_campanha_pausa_motivo') then
    alter table campanha add constraint ck_campanha_pausa_motivo
      check (pausa_motivo is null or pausa_motivo in ('conexao', 'teto_plano'));
  end if;
end $$;

-- As pausas que já existem só podiam ser de conexão.
update campanha set pausa_motivo = 'conexao'
 where status = 'pausada' and pausa_motivo is null;
