-- 044_conversa_anuncio.sql
--
-- De qual anuncio a conversa veio.
--
-- Quando alguem clica num anuncio de "clique para o WhatsApp" e escreve para a
-- loja, a Meta manda junto da PRIMEIRA mensagem a origem dela (`referral`): o
-- id do anuncio, o tipo (anuncio ou publicacao), o endereco e o identificador
-- do clique (`ctwa_clid`). E com isso que outro produto da DMS (o Liame) liga
-- o anuncio ao pedido que veio depois.
--
-- Esta tabela guarda uma linha por mensagem que chegou com essa origem:
--
-- * so a origem, o momento e o telefone de quem escreveu. NENHUM conteudo de
--   mensagem, nem o texto do anuncio;
-- * vale para qualquer numero da conta, guarde ele as conversas ou nao — por
--   isso e uma tabela a parte, e a `conversa` fica como esta;
-- * so e escrita enquanto a conta tem um aplicativo conectado com a permissao
--   de ler conversas abertas por anuncio (a regra fica no codigo). Sem
--   aplicativo, nada e guardado;
-- * a mesma mensagem de novo (a Meta reentrega) nao cria linha nova;
-- * `registrado_em` e a hora em que a linha entrou: e por ela que a leitura
--   com cursor anda, e por ela que a linha sai depois de 180 dias.
--
-- Sem `drop`. Idempotente: pode rodar de novo.

set local lock_timeout = '10s';

create table if not exists conversa_anuncio (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references conta(id) on delete cascade,
  wa_numero_id  uuid not null references wa_numero(id) on delete cascade,
  -- Quem escreveu, no formato do contato (so digitos, com o 55 e o 9o digito).
  telefone_e164 text not null,
  wamid         text not null,
  -- A hora da mensagem, pelo WhatsApp.
  aberta_em     timestamptz not null,
  -- `ad` (anuncio) ou `post` (publicacao), como a Meta manda.
  origem_tipo   text not null,
  -- O id do anuncio (ou da publicacao) na Meta.
  origem_id     text not null,
  -- O identificador do clique. A Meta o omite em anuncio no Status do WhatsApp.
  ctwa_clid     text,
  origem_url    text,
  registrado_em timestamptz not null default now()
);

create unique index if not exists idx_conversa_anuncio_wamid on conversa_anuncio (conta_id, wamid);
create index if not exists idx_conversa_anuncio_cursor on conversa_anuncio (conta_id, registrado_em, id);
create index if not exists idx_conversa_anuncio_prazo on conversa_anuncio (registrado_em);

select rc_rls_conta('conversa_anuncio');

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'regemcast_app') then
    execute 'grant select, insert, update, delete on conversa_anuncio to regemcast_app';
  end if;
end $$;

comment on table conversa_anuncio is
  'Mensagens que chegaram com a origem de um anuncio de clique para o WhatsApp (referral). So a origem, o momento e o telefone; nenhum conteudo. Escrita so enquanto a conta tem aplicativo conectado com a permissao conversas.anuncio.ler; apagada depois de 180 dias.';
comment on column conversa_anuncio.registrado_em is
  'Quando a linha entrou. Ordena a leitura com cursor e conta o prazo de guarda.';
