-- 019_dispositivo_push.sql — Aparelhos do app Android que recebem avisos (push).
--
-- Cada linha é um celular com o app instalado e logado: o token do Firebase
-- Cloud Messaging (FCM) é o "endereço" para onde a notificação vai. Quem manda
-- é o servidor, nunca o app — o app só entrega o token depois do login.
--
-- DECISÕES:
--
-- * `token_fcm` é ÚNICO na base inteira, não por conta. O mesmo celular pode
--   sair de uma conta e entrar em outra; o token continua o mesmo e a linha
--   muda de dono. Por isso o registro é feito em escopo sistema (a linha antiga
--   pertence a outra conta e a RLS a esconderia do `on conflict`).
-- * `usuario_id` com `on delete cascade`: removeu o acesso, o aparelho para de
--   receber na hora. Suspender não apaga a linha — o envio filtra por status.
-- * `avisos` guarda o que a pessoa quer receber, por aparelho. JSON para
--   acrescentar um tipo novo de aviso sem migration.
-- * Token que o FCM responde como inválido (app desinstalado) é apagado pelo
--   próprio envio. `visto_em` permite expurgar o que ficou esquecido.
--
-- Idempotente: pode rodar duas vezes sem efeito diferente.

create table if not exists dispositivo (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references conta(id) on delete cascade,
  usuario_id    uuid not null references usuario(id) on delete cascade,

  token_fcm     text not null,
  plataforma    text not null default 'android'
                check (plataforma in ('android')),
  app_versao    text,
  modelo        text,

  -- O que este aparelho recebe. Chave ausente = ligado.
  avisos        jsonb not null default
                '{"campanhas": true, "modelos": true, "cobranca": true}'::jsonb,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  visto_em      timestamptz not null default now()
);

create unique index if not exists dispositivo_token_uq on dispositivo (token_fcm);
create index if not exists dispositivo_conta_idx on dispositivo (conta_id);
create index if not exists dispositivo_usuario_idx on dispositivo (usuario_id);

comment on table dispositivo is
  'Celular com o app Android logado. token_fcm e o endereco do push; unico na base (o aparelho pode trocar de conta).';

select rc_rls_conta('dispositivo');

drop trigger if exists tg_dispositivo_touch on dispositivo;
create trigger tg_dispositivo_touch before update on dispositivo
  for each row execute function rc_touch();

-- ---------------------------------------------------------------- grants

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'regemcast_app') then
    execute 'grant select, insert, update, delete on dispositivo to regemcast_app';
  end if;
end $$;
