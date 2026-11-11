-- 048_aprovacao_de_disparos.sql
--
-- A aprovacao de disparos do Hub DMS (F5, parte B): o disparo que outro produto
-- da DMS pede pela porta MCP passa a esperar uma pessoa da conta. O dono (ou quem
-- ele autorizou) aprova na tela, com o codigo do aplicativo autenticador, fixa o
-- teto de gasto do disparo, e so entao as mensagens saem, uma vez. O contrato e o
-- pedido de acao do pacote comum (dms/integracao-dms.ts, secao 11); o desenho
-- esta em docs/aprovacao-de-disparos.md.
--
-- Esta migration:
-- * acao_pedido: o pedido, por conta (RLS da conta). Preso ao resumo do plano
--   (o que a pessoa ve: o texto do modelo, as variaveis, quem recebe, o custo e
--   o cupom), com prazo de 24 horas e as situacoes do pacote; um so ativo por
--   campanha; a chave de repeticao presa ao pedido enquanto ele existir (so o
--   resumo dela). Um gatilho deixa a situacao andar so pelas transicoes do
--   pacote, nao deixa mudar o que prende o pedido, e so deixa o teto e a decisao
--   nascerem junto da mudanca de situacao;
-- * campanha.acao_pedido_id: o pedido que disparou a campanha. O worker le dele
--   o teto de gasto antes de cada lote. Gravado uma vez (gatilho);
-- * campanha.pausa_motivo aceita teto_aprovado (nao volta sozinha);
-- * usuario.aprova_disparos: a permissao de aprovar que o dono da a outra
--   pessoa (o dono aprova sempre);
-- * usuario.aprovacao_erros, aprovacao_erro_em e aprovacao_travada_ate: a trava
--   do codigo na aprovacao (5 errados em 15 minutos travam por 15 minutos),
--   separada da trava da entrada.
--
-- Idempotente: pode rodar de novo.
--
-- ATENCAO: tem `drop constraint` (a troca do check de `pausa_motivo`, como na
-- 042). Vai pelo SQL Editor do Supabase, colada pelo dono. O check novo nasce
-- `not valid` e e validado em seguida, sem segurar a tabela durante a varredura.

set local lock_timeout = '10s';

create table if not exists acao_pedido (
  id                    uuid primary key default gen_random_uuid(),
  conta_id              uuid not null references conta(id) on delete cascade,
  -- Excluir o rascunho encerra o pedido antes (o servico); a linha fica como prova.
  campanha_id           uuid references campanha(id) on delete set null,
  acao                  text not null,
  risco                 text not null,
  situacao              text not null default 'aguardando',
  -- SHA-256 hex do plano (resumoDoPlano do pacote) e o plano que a tela mostra.
  resumo_plano          text not null,
  plano                 jsonb not null,
  -- O produto que pediu (liame) e a credencial por onde veio (o token ou a ligacao).
  aplicativo            text not null,
  token_id              uuid not null,
  ligacao_prefixo       text,
  -- {"tipo":"agente"} ou {"tipo":"pessoa","pessoa":"<resumo do e-mail>"}.
  pedido_por            jsonb not null,
  -- A chave de repeticao de quem pede, so em resumo, e a impressao do que ele mandou.
  chave_resumo          text not null,
  impressao             text not null,
  -- Gravados pelo servico (o relogio dele), nunca pelo banco: o prazo sai do mesmo instante.
  criado_em             timestamptz not null,
  vence_em              timestamptz not null,
  lembrete_em           timestamptz not null,
  lembrado_em           timestamptz,
  decidido_em           timestamptz,
  -- Quem decidiu: a pessoa (aprovou ou recusou) e o papel, para o registro do hub.
  decidido_por_usuario  uuid references usuario(id) on delete set null,
  decidido_por          text,
  teto_gasto_centavos   bigint,
  motivo                text,
  motivo_recusa         text,
  executado_em          timestamptz,
  atualizado_em         timestamptz not null default now(),
  constraint ck_acao_pedido_acao check (acao in ('campanha_disparar')),
  constraint ck_acao_pedido_risco check (risco in ('R2', 'R3')),
  constraint ck_acao_pedido_situacao
    check (situacao in ('aguardando', 'aprovado', 'executando', 'executado', 'recusado', 'vencido', 'cancelado', 'falhou')),
  constraint ck_acao_pedido_resumo check (resumo_plano ~ '^[0-9a-f]{64}$'),
  constraint ck_acao_pedido_plano check (jsonb_typeof(plano) = 'object'),
  constraint ck_acao_pedido_aplicativo check (aplicativo ~ '^[a-z][a-z0-9_-]{1,39}$'),
  constraint ck_acao_pedido_pedido_por check (jsonb_typeof(pedido_por) = 'object' and pedido_por ->> 'tipo' in ('agente', 'pessoa')),
  constraint ck_acao_pedido_chave check (chave_resumo ~ '^[0-9a-f]{64}$'),
  constraint ck_acao_pedido_impressao check (impressao ~ '^[0-9a-f]{64}$'),
  constraint ck_acao_pedido_prazo check (vence_em > criado_em and lembrete_em > criado_em and lembrete_em < vence_em),
  constraint ck_acao_pedido_decidido_por
    check (decidido_por is null or decidido_por in ('dono', 'autorizado', 'prazo', 'quem_pediu', 'produto')),
  constraint ck_acao_pedido_teto check (teto_gasto_centavos is null or teto_gasto_centavos > 0),
  constraint ck_acao_pedido_motivo check (motivo is null or motivo ~ '^[a-z][a-z-]{2,40}$'),
  constraint ck_acao_pedido_motivo_recusa check (motivo_recusa is null or length(motivo_recusa) between 1 and 300)
);

-- Um pedido ativo por campanha: o segundo pedido da mesma campanha, com outra chave, cai no indice.
create unique index if not exists uq_acao_pedido_campanha_ativo
  on acao_pedido (campanha_id) where situacao in ('aguardando', 'aprovado', 'executando');
-- A chave de repeticao presa ao pedido: a mesma chave do mesmo aplicativo na conta devolve o mesmo pedido.
create unique index if not exists uq_acao_pedido_chave on acao_pedido (conta_id, aplicativo, chave_resumo);
create index if not exists idx_acao_pedido_conta on acao_pedido (conta_id, criado_em desc);
-- A rotina: o que vence, o lembrete que falta e o aprovado que nao saiu.
create index if not exists idx_acao_pedido_vence on acao_pedido (vence_em) where situacao in ('aguardando', 'aprovado');
create index if not exists idx_acao_pedido_lembrete on acao_pedido (lembrete_em) where situacao = 'aguardando' and lembrado_em is null;
create index if not exists idx_acao_pedido_aprovado on acao_pedido (atualizado_em) where situacao = 'aprovado';

select rc_rls_conta('acao_pedido');

-- A guarda do pedido:
-- * o que prende o pedido nao muda depois de nascer (a campanha so pode ir a nulo, pelo on delete set null);
-- * a situacao anda so pelas transicoes do pacote (TRANSICOES_DO_PEDIDO);
-- * sem mudanca de situacao, a decisao (quem, quando, o teto, o motivo da recusa) e a execucao nao mudam; o motivo so
--   muda no executado, para o teto que parou a execucao;
-- * o teto nasce uma vez, de nulo, na aprovacao (aguardando -> aprovado).
create or replace function rc_acao_pedido_guarda() returns trigger
language plpgsql as $$
begin
  if new.resumo_plano is distinct from old.resumo_plano or new.plano is distinct from old.plano
     or new.pedido_por is distinct from old.pedido_por or new.aplicativo is distinct from old.aplicativo
     or new.conta_id is distinct from old.conta_id or new.acao is distinct from old.acao or new.risco is distinct from old.risco
     or new.chave_resumo is distinct from old.chave_resumo or new.impressao is distinct from old.impressao
     or new.token_id is distinct from old.token_id or new.ligacao_prefixo is distinct from old.ligacao_prefixo
     or new.criado_em is distinct from old.criado_em or new.vence_em is distinct from old.vence_em
     or new.lembrete_em is distinct from old.lembrete_em
     or (new.campanha_id is distinct from old.campanha_id and new.campanha_id is not null) then
    raise exception 'acao_pedido: o que prende o pedido nao muda depois de nascer' using errcode = 'check_violation';
  end if;
  if new.situacao is distinct from old.situacao and not (
       (old.situacao = 'aguardando' and new.situacao in ('aprovado', 'recusado', 'vencido', 'cancelado'))
    or (old.situacao = 'aprovado' and new.situacao in ('executando', 'vencido', 'cancelado'))
    or (old.situacao = 'executando' and new.situacao in ('executado', 'falhou'))
  ) then
    raise exception 'acao_pedido: a situacao nao vai de % para %', old.situacao, new.situacao using errcode = 'check_violation';
  end if;
  if new.situacao is not distinct from old.situacao then
    if new.decidido_em is distinct from old.decidido_em or new.decidido_por is distinct from old.decidido_por
       or new.decidido_por_usuario is distinct from old.decidido_por_usuario and new.decidido_por_usuario is not null
       or new.motivo_recusa is distinct from old.motivo_recusa or new.executado_em is distinct from old.executado_em then
      raise exception 'acao_pedido: a decisao so muda junto da situacao' using errcode = 'check_violation';
    end if;
    if new.motivo is distinct from old.motivo and not (old.situacao = 'executado' and new.motivo = 'teto-de-gasto') then
      raise exception 'acao_pedido: o motivo so muda junto da situacao (ou o teto no executado)' using errcode = 'check_violation';
    end if;
  end if;
  if new.teto_gasto_centavos is distinct from old.teto_gasto_centavos
     and not (old.teto_gasto_centavos is null and old.situacao = 'aguardando' and new.situacao = 'aprovado') then
    raise exception 'acao_pedido: o teto de gasto so nasce na aprovacao' using errcode = 'check_violation';
  end if;
  new.atualizado_em = now();
  return new;
end $$;

create or replace trigger trg_acao_pedido_guarda before update on acao_pedido
  for each row execute function rc_acao_pedido_guarda();

alter table campanha add column if not exists acao_pedido_id uuid references acao_pedido(id) on delete set null;

-- O pedido que disparou a campanha e gravado uma vez: dele sai o teto que o worker confere.
create or replace function rc_campanha_pedido_guarda() returns trigger
language plpgsql as $$
begin
  if old.acao_pedido_id is not null and new.acao_pedido_id is distinct from old.acao_pedido_id then
    raise exception 'campanha: o pedido que disparou a campanha nao muda' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace trigger trg_campanha_pedido_guarda before update of acao_pedido_id on campanha
  for each row execute function rc_campanha_pedido_guarda();

-- O motivo `teto_aprovado` na pausa da campanha.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'ck_campanha_pausa_motivo') then
    alter table campanha drop constraint ck_campanha_pausa_motivo;
  end if;
  alter table campanha add constraint ck_campanha_pausa_motivo
    check (pausa_motivo is null or pausa_motivo in ('conexao', 'teto_plano', 'inadimplencia', 'manual', 'modelo', 'conta_meta', 'orcamento', 'teto_aprovado'))
    not valid;
end $$;
alter table campanha validate constraint ck_campanha_pausa_motivo;

alter table usuario add column if not exists aprova_disparos boolean not null default false;
alter table usuario add column if not exists aprovacao_erros integer not null default 0;
alter table usuario add column if not exists aprovacao_erro_em timestamptz;
alter table usuario add column if not exists aprovacao_travada_ate timestamptz;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'regemcast_app') then
    -- Sem delete: o pedido e a prova do que foi pedido e de quem decidiu. O revoke tira o delete que o privilegio
    -- padrao do 001 da a toda tabela nova. O "on delete cascade" da conta segue valendo.
    execute 'grant select, insert, update on acao_pedido to regemcast_app';
    execute 'revoke delete on acao_pedido from regemcast_app';
  end if;
end $$;

comment on table acao_pedido is
  'Pedidos de acao de outro produto da DMS que esperam uma pessoa da conta (Hub DMS, F5): o disparo de campanha, preso ao resumo do plano, com prazo de 24 horas, aprovado com o codigo do aplicativo autenticador e executado uma vez.';
comment on column campanha.acao_pedido_id is
  'O pedido de aprovacao que disparou a campanha (gravado uma vez). O worker le dele o teto de gasto antes de cada lote; chegou, a campanha pausa com teto_aprovado.';
comment on column usuario.aprova_disparos is
  'A permissao de aprovar disparos pedidos por outro produto, dada pelo dono (decisao F5-2). O dono aprova sempre.';
comment on column usuario.aprovacao_erros is
  'Codigos errados seguidos na aprovacao de disparos. No quinto, aprovar trava por 15 minutos (a entrada na conta nao).';
