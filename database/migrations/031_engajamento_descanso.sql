-- 031_engajamento_descanso.sql — Descanso entre campanhas, número sem WhatsApp e resposta à campanha.
--
-- Decisões do dono (25/09/2026, Fase 4A):
--
-- * DESCANSO: quem recebeu uma campanha de MARKETING nos últimos N dias fica
--   de fora da próxima. N é da conta (`conta.descanso_marketing_dias`, padrão
--   3, 0 desliga) e é copiado para a campanha quando ela é criada
--   (`campanha.descanso_dias`): vale só para campanhas criadas depois deste
--   deploy, e mudar o número da conta não muda campanha em andamento. Nulo na
--   campanha = sem descanso (antigas, modelo que não é marketing, ou liberada
--   pelo dono). Quem fica de fora vira `descanso` — não é falha, e não conta
--   no plano.
-- * SEM WHATSAPP: o número que a Meta recusou com 131026 em DUAS campanhas
--   diferentes é marcado (`contato.sem_whatsapp_em`) e sai sozinho dos envios
--   e dos públicos. "Tentar de novo" (Bloqueios) zera a marca; só as falhas
--   depois disso (`sem_whatsapp_liberado_em`) contam para marcar de novo.
-- * RESPONDEU: a resposta da pessoa à mensagem da campanha (a Meta manda o
--   `context.id` da mensagem respondida) marca `respondida_em`. Só o fato; o
--   texto não é guardado.
--
-- Idempotente.

-- ---------------------------------------------------------------- descanso
alter table conta add column if not exists descanso_marketing_dias integer not null default 3;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_conta_descanso_marketing_dias') then
    alter table conta add constraint ck_conta_descanso_marketing_dias
      check (descanso_marketing_dias between 0 and 30);
  end if;
end $$;

alter table campanha add column if not exists descanso_dias integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_campanha_descanso_dias') then
    alter table campanha add constraint ck_campanha_descanso_dias
      check (descanso_dias is null or descanso_dias between 1 and 30);
  end if;
end $$;

comment on column conta.descanso_marketing_dias is
  'Descanso entre campanhas de marketing, em dias (0 desliga). Copiado para a campanha ao criar.';
comment on column campanha.descanso_dias is
  'Descanso desta campanha, copiado da conta ao criar. Nulo = sem descanso.';

-- O status novo do destinatário: `descanso` (não saiu, não é falha, não conta no plano).
do $$
declare
  v_nome text;
begin
  for v_nome in
    select conname from pg_constraint
     where conrelid = 'campanha_destinatario'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%pendente%'
  loop
    execute format('alter table campanha_destinatario drop constraint %I', v_nome);
  end loop;

  alter table campanha_destinatario add constraint ck_campanha_destinatario_status
    check (status in ('pendente', 'enviando', 'enviada', 'entregue', 'lida', 'falhou', 'cancelado', 'descanso'));
end $$;

-- A busca "esta pessoa recebeu campanha?" é pelo telefone, na conta — no
-- descanso (na hora do envio) e nos públicos de engajamento.
create index if not exists idx_campanha_destinatario_telefone
  on campanha_destinatario (conta_id, telefone_e164);

-- ---------------------------------------------------------------- respondeu
alter table campanha_destinatario add column if not exists respondida_em timestamptz;

-- ---------------------------------------------------------------- sem WhatsApp
alter table contato add column if not exists sem_whatsapp_em timestamptz;
alter table contato add column if not exists sem_whatsapp_liberado_em timestamptz;

comment on column contato.sem_whatsapp_em is
  'A Meta recusou o numero (131026) em duas campanhas: fica fora dos envios e dos publicos ate "tentar de novo".';
