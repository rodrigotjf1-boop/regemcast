-- 018_campanha_acoes_modelo_edicao.sql — Pausar, editar e excluir: campanha e modelo.
--
-- Fase 0 do app Android, que vale também para a web. Quatro coisas:
--
--   1. A campanha passa a poder pausar POR DECISÃO do cliente. Até aqui toda
--      pausa era automática (conexão caiu, teto do plano, inadimplência), e o
--      motivo dizia qual delas foi. Agora existe `manual` — e a diferença
--      importa: a automática volta sozinha quando a causa some, a manual só
--      volta quando a pessoa mandar.
--
--   2. Cancelar uma campanha precisa de um estado próprio no DESTINATÁRIO. Sem
--      ele, os pendentes teriam de virar "falhou", e a tela mostraria como
--      fracasso de entrega o que foi decisão de quem cancelou — além de sujar
--      a métrica de falhas, que é a que diz se o número está com problema.
--
--   3. Campanha encerrada some da lista sem sumir do banco: `arquivada_em`.
--      Apagar de verdade levaria junto o histórico de envio, que é o que
--      sustenta a conta do ciclo e a cobrança da Meta.
--
--   4. O modelo guarda QUANDO foi editado na Meta. A Meta aceita uma edição de
--      modelo aprovado a cada 24 horas (e dez a cada 30 dias); sem a data, o
--      cliente só descobre o limite pelo erro dela, depois de escrever tudo.
--
-- Idempotente: pode rodar duas vezes sem efeito diferente.

-- -------------------------------------------------------------------- campanha

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'ck_campanha_pausa_motivo') then
    alter table campanha drop constraint ck_campanha_pausa_motivo;
  end if;
  alter table campanha add constraint ck_campanha_pausa_motivo
    check (pausa_motivo is null or pausa_motivo in ('conexao', 'teto_plano', 'inadimplencia', 'manual'));
end $$;

alter table campanha add column if not exists arquivada_em timestamptz;

comment on column campanha.arquivada_em is
  'Campanha encerrada que o cliente tirou da lista. O historico de envio continua, para o ciclo e a cobranca.';

-- A lista da tela pede sempre as não arquivadas, em ordem de criação.
create index if not exists idx_campanha_conta_ativa
  on campanha (conta_id, criado_em desc) where arquivada_em is null;

-- ------------------------------------------------------- campanha_destinatario

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
    check (status in ('pendente', 'enviando', 'enviada', 'entregue', 'lida', 'falhou', 'cancelado'));
end $$;

comment on column campanha_destinatario.status is
  'enviada = a Meta aceitou; entregue = chegou ao aparelho; cancelado = a campanha foi cancelada antes de sair.';

-- ---------------------------------------------------------------------- modelo

alter table modelo add column if not exists editado_meta_em timestamptz;

comment on column modelo.editado_meta_em is
  'Quando a ultima edicao foi aceita pela Meta. Modelo aprovado aceita 1 edicao por 24h e 10 por 30 dias.';
