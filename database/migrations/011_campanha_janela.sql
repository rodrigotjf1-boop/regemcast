-- 011_campanha_janela.sql — Janela de envio e ritmo da campanha.
--
-- O que falta na campanha não é "agendar para uma data": é **uma janela**. Numa
-- base de mil contatos, o disparo leva tempo, e a pergunta que importa não é
-- "quando começa" e sim "em que horas do dia pode sair".
--
-- Mandar promoção às três da manhã é o jeito mais rápido de a pessoa bloquear o
-- número — e bloqueio derruba a nota de qualidade da conta na Meta, que reduz o
-- limite diário, que estrangula todas as campanhas seguintes. A janela não é
-- educação: é proteção do ativo.
--
-- O RITMO responde à outra metade do mesmo problema. A Meta tem teto por dia, e
-- o produto tem teto de bom senso: mil mensagens em dois minutos parece robô
-- para qualquer sistema antifraude. A pausa entre envios existe para não
-- parecer.
--
-- Tudo aqui é OPCIONAL. Sem janela e sem ritmo, a campanha sai como sempre saiu:
-- direto, na velocidade que a Meta aceitar.
--
-- Idempotente: pode rodar duas vezes sem efeito diferente.

-- ---------------------------------------------------------------- a janela

-- Dias da semana em que a campanha pode enviar: 0 = domingo … 6 = sábado.
-- Vazio significa "qualquer dia", e não "nenhum dia" — é a leitura que evita
-- uma campanha parada para sempre porque ninguém marcou nada.
alter table campanha
  add column if not exists janela_dias smallint[] not null default '{}';

-- Faixa de horário, no fuso da conta (`conta.timezone`). Guardar `time` e não
-- `timestamptz` é proposital: a regra é "das 9 às 20 todo dia", não "às 9 do
-- dia 14". Um horário absoluto expiraria no dia seguinte.
alter table campanha
  add column if not exists janela_inicio time;

alter table campanha
  add column if not exists janela_fim time;

-- ----------------------------------------------------------------- o ritmo

-- Segundos entre uma mensagem e a próxima.
alter table campanha
  add column if not exists pausa_segundos integer not null default 0;

-- Tetos por período. Nulo = sem teto nosso (a Meta continua mandando no dela).
alter table campanha
  add column if not exists max_por_dia integer;

alter table campanha
  add column if not exists max_por_semana integer;

alter table campanha
  add column if not exists max_por_mes integer;

-- ------------------------------------------------------------- consistência

do $$
begin
  -- Pausa negativa não existe, e pausa de uma hora entre mensagens seria uma
  -- campanha de dias — provavelmente engano de digitação, não intenção.
  if not exists (select 1 from pg_constraint where conname = 'campanha_pausa_check') then
    alter table campanha
      add constraint campanha_pausa_check
      check (pausa_segundos >= 0 and pausa_segundos <= 3600);
  end if;

  -- Dias válidos: 0 a 6. Um 7 na lista deixaria a campanha esperando por um dia
  -- que nunca chega.
  if not exists (select 1 from pg_constraint where conname = 'campanha_janela_dias_check') then
    alter table campanha
      add constraint campanha_janela_dias_check
      check (janela_dias <@ array[0,1,2,3,4,5,6]::smallint[]);
  end if;

  -- Os tetos precisam ser crescentes: um teto diário maior que o mensal é
  -- contradição, e a que passa despercebida é justamente essa.
  if not exists (select 1 from pg_constraint where conname = 'campanha_tetos_check') then
    alter table campanha
      add constraint campanha_tetos_check
      check (
        (max_por_dia is null or max_por_semana is null or max_por_dia <= max_por_semana)
        and (max_por_semana is null or max_por_mes is null or max_por_semana <= max_por_mes)
        and (max_por_dia is null or max_por_mes is null or max_por_dia <= max_por_mes)
      );
  end if;
end $$;

comment on column campanha.janela_dias is
  'Dias em que pode enviar: 0=domingo … 6=sabado. Vazio = qualquer dia.';

comment on column campanha.janela_inicio is
  'Hora local (conta.timezone). `time` e nao `timestamptz`: a regra e "das 9 as 20 todo dia".';

comment on column campanha.pausa_segundos is
  'Intervalo entre mensagens. Mil mensagens em dois minutos parece robo para sistema antifraude.';

-- A campanha ganha um estado a mais: esperando a janela abrir. Sem ele,
-- "enviando" ficaria significando duas coisas diferentes — trabalhando e
-- parada esperando — e a tela não teria como contar a verdade.
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'campanha_status_check' and conrelid = 'campanha'::regclass
  ) then
    alter table campanha drop constraint campanha_status_check;
  end if;

  alter table campanha
    add constraint campanha_status_check
    check (status in ('rascunho','agendada','enfileirada','enviando','concluida','pausada','cancelada'));
end $$;
