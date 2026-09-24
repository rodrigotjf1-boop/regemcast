-- 024_conversas.sql — As conversas do WhatsApp dentro do Regemcast.
--
-- A Meta não guarda conversa para nós: entrega cada mensagem uma vez, pelo
-- webhook, e esquece. Para o lojista ver e responder pelo painel, cada
-- mensagem precisa ficar aqui. Só há conversa para número em coexistência
-- cujo dono respondeu "sim" (migration 023): número dedicado não tem o que
-- mostrar, e quem respondeu "não" não tem nada guardado.
--
-- DECISÕES:
--
-- * Conversa = número da empresa × pessoa. A mesma pessoa falando com dois
--   números da conta são duas conversas: a resposta tem de sair pelo número
--   certo.
-- * `telefone_e164` no MESMO formato do `contato` (sem o '+', com o 55 e com
--   o 9º dígito). Celular antigo do Brasil chega da Meta sem o 9; o código
--   acrescenta antes de gravar — senão a conversa não acharia o contato, e a
--   mesma pessoa viraria duas conversas.
-- * `mensagem.wamid` é único por conta: a Meta reentrega o webhook, e o
--   histórico pode repetir mensagens que também chegaram ao vivo.
-- * `criada_em` é a data ORIGINAL da mensagem, não a da gravação. O histórico
--   de 6 meses chega hoje com datas antigas, e a conversa precisa sair em
--   ordem.
-- * Os totais da conversa (última mensagem, não lidas, janela de 24h) são
--   mantidos pelo código, uma vez por lote, SEM gatilho. Gatilho por linha
--   faria o histórico de milhares de mensagens atualizar a mesma conversa
--   milhares de vezes — e dois mecanismos mantendo o mesmo total acabam
--   contando em dobro.
-- * `ultima_entrada_em` é a última mensagem DO CLIENTE. É dela que conta a
--   janela de 24 horas em que a Meta aceita texto livre; fora da janela, só
--   modelo aprovado.
-- * `origem = 'campanha'`: a mensagem de campanha só é copiada para a conversa
--   quando o cliente responde a ela. Copiar todo disparo multiplicaria o
--   banco sem ninguém olhar.
-- * Retenção por conta (`conta.conversas_retencao_dias`, 0 = manter tudo). Um
--   job apaga o que passou do prazo, pela data original da mensagem.
--
-- Idempotente: pode rodar duas vezes sem efeito diferente.

-- ---------------------------------------------------------------- conversa

create table if not exists conversa (
  id                  uuid primary key default gen_random_uuid(),
  conta_id            uuid not null references conta(id) on delete cascade,
  wa_numero_id        uuid not null references wa_numero(id) on delete cascade,

  -- A pessoa, no formato do `contato` (ver DECISÕES). É por ele que a tela
  -- encontra o contato: (conta_id, telefone_e164) já é índice único lá.
  telefone_e164       text not null,
  -- Nome do perfil no WhatsApp, para quem ainda não é contato da base.
  nome_perfil         text,

  ultima_mensagem_em  timestamptz,
  -- Trecho da última mensagem, para a lista ("[foto]", "Oi, o pedido…").
  ultima_mensagem     text,
  -- Última mensagem do cliente: a janela de 24h conta daqui.
  ultima_entrada_em   timestamptz,
  -- Mensagens do cliente depois da última resposta ou da última leitura no painel.
  nao_lidas           integer not null default 0 check (nao_lidas >= 0),
  lida_em             timestamptz,

  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

create unique index if not exists conversa_numero_telefone_uq
  on conversa (wa_numero_id, telefone_e164);

-- A lista da tela: as conversas da conta, a mais recente primeiro.
create index if not exists conversa_lista_idx
  on conversa (conta_id, ultima_mensagem_em desc nulls last);

comment on table conversa is
  'Numero da empresa x pessoa. Totais mantidos pelo codigo, uma vez por lote, sem gatilho (ver 024_conversas.sql).';

select rc_rls_conta('conversa');

drop trigger if exists tg_conversa_touch on conversa;
create trigger tg_conversa_touch before update on conversa
  for each row execute function rc_touch();

-- ---------------------------------------------------------------- mensagem

create table if not exists mensagem (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references conta(id) on delete cascade,
  conversa_id   uuid not null references conversa(id) on delete cascade,

  -- Identificador da mensagem na Meta. Liga o webhook de status a esta linha
  -- e impede a mesma mensagem de entrar duas vezes.
  wamid         text not null,

  direcao       text not null check (direcao in ('entrada','saida')),
  -- cliente   — a pessoa escreveu (webhook `messages`)
  -- celular   — o lojista respondeu pelo app do celular (webhook `smb_message_echoes`)
  -- painel    — o lojista respondeu por aqui
  -- historico — veio da cópia dos 6 meses (webhook `history`)
  -- campanha  — disparo de campanha que o cliente respondeu (ver DECISÕES)
  origem        text not null
                check (origem in ('cliente','celular','painel','historico','campanha')),

  -- text, image, audio, video, document, sticker, location, reaction… como a Meta manda.
  tipo          text not null default 'text',
  texto         text,
  -- Mídia fica na Meta; guardamos o identificador e baixamos só quando alguém abre.
  midia_id      text,
  midia_mime    text,
  midia_nome    text,

  -- Só para saída. enviando = a Meta aceitou; enviada/entregue/lida vêm do webhook.
  status        text check (status in ('enviando','enviada','entregue','lida','falhou')),
  -- O motivo REAL da falha, do catálogo de erros da Meta.
  erro_codigo   integer,
  erro_titulo   text,

  -- Quem respondeu pelo painel. `set null`: remover o usuário não apaga o que ele disse.
  enviada_por   uuid references usuario(id) on delete set null,

  -- Data ORIGINAL da mensagem (ver DECISÕES).
  criada_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists mensagem_wamid_uq
  on mensagem (conta_id, wamid);

-- Abrir uma conversa: as mensagens dela, das mais novas para trás.
create index if not exists mensagem_conversa_idx
  on mensagem (conversa_id, criada_em desc);

-- O job de retenção apaga por conta e por data.
create index if not exists mensagem_retencao_idx
  on mensagem (conta_id, criada_em);

comment on column mensagem.criada_em is
  'Data original da mensagem no WhatsApp, nao a da gravacao. O historico chega hoje com datas de ate 6 meses atras.';

select rc_rls_conta('mensagem');

drop trigger if exists tg_mensagem_touch on mensagem;
create trigger tg_mensagem_touch before update on mensagem
  for each row execute function rc_touch();

-- ---------------------------------------------------------------- retenção

-- Por quanto tempo guardar as mensagens. 0 = manter tudo.
alter table conta add column if not exists conversas_retencao_dias integer not null default 0
  check (conversas_retencao_dias >= 0);

-- ---------------------------------------------------------------- grants

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'regemcast_app') then
    execute 'grant select, insert, update, delete on conversa to regemcast_app';
    execute 'grant select, insert, update, delete on mensagem to regemcast_app';
  end if;
end $$;
