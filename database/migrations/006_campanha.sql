-- 006_campanha.sql — Campanha e destinatários: o disparo e o que aconteceu com ele.
--
-- Estas duas tabelas existem para corrigir, na origem, o defeito mais caro que
-- a auditoria do Regem encontrou: **lá uma campanha marca "100% enviada" com
-- 100% das mensagens em `failed`**. Isso acontece porque o envio guarda apenas
-- "a Meta aceitou o POST" e nunca reconcilia com o que a Meta responde depois,
-- por webhook, sobre cada mensagem.
--
-- A peça que impede isso é o `wa_message_id` (o `wamid`) por destinatário. Sem
-- ele, o evento de entrega chega e não há a quem atribuir. Com ele, o caminho
-- fecha: enviamos, guardamos o wamid, e cada webhook encontra sua linha.
--
-- Por isso o status por destinatário tem SEIS valores e não dois. "Aceito" e
-- "entregue" são fatos diferentes, separados por minutos e, às vezes, por um
-- erro que só aparece depois.
--
-- Idempotente: pode rodar duas vezes sem efeito diferente.

-- ------------------------------------------------------------------ campanha

-- O disparo. Uma linha por campanha, de qualquer tamanho.
--
-- O modelo é gravado por VALOR (nome, idioma, categoria), não só por
-- referência: modelo pode ser editado ou excluído na Meta depois, e o registro
-- do que foi enviado não pode mudar retroativamente. Uma campanha que diz
-- "enviei o modelo X" precisa continuar dizendo isso no ano que vem.
create table if not exists campanha (
  id              uuid primary key default gen_random_uuid(),
  conta_id        uuid not null references conta(id) on delete cascade,

  nome            text not null,

  -- Congelados no momento do disparo. `modelo_id` é o da Meta e pode sumir.
  modelo_id       text,
  modelo_nome     text not null,
  modelo_idioma   text not null,
  modelo_categoria text,

  -- rascunho    — montada, ainda não disparada
  -- enfileirada — mandada para a fila, nenhum envio saiu ainda
  -- enviando    — há envio em andamento
  -- concluida   — todos os destinatários chegaram a um estado final
  -- pausada     — interrompida (por limite, qualidade ou decisão do cliente)
  -- cancelada   — encerrada sem concluir; o que não saiu, não sai mais
  status          text not null default 'rascunho'
                  check (status in ('rascunho','enfileirada','enviando','concluida','pausada','cancelada')),

  -- `set null` e não `cascade`: apagar quem criou não pode apagar o histórico
  -- de envio. O que foi enviado aconteceu, independentemente de quem continua
  -- na empresa.
  criada_por      uuid references usuario(id) on delete set null,

  iniciada_em     timestamptz,
  concluida_em    timestamptz,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

comment on table campanha is
  'Um disparo. O modelo fica gravado por valor porque pode mudar na Meta depois.';

select rc_rls_conta('campanha');

drop trigger if exists tg_campanha_touch on campanha;
create trigger tg_campanha_touch before update on campanha
  for each row execute function rc_touch();

-- A tela lista as campanhas da conta, mais recentes primeiro.
create index if not exists idx_campanha_conta
  on campanha (conta_id, criado_em desc);

-- ----------------------------------------------------- campanha_destinatario

-- Uma linha por pessoa que vai (ou foi) receber.
--
-- Não há contador agregado na tabela `campanha` de propósito. Contador
-- denormalizado precisa ser mantido em dois lugares — no envio e no webhook —
-- e o dia em que um deles falha, o número na tela mente sem ninguém perceber.
-- Contar daqui, com o índice abaixo, é sempre verdade.
create table if not exists campanha_destinatario (
  id              uuid primary key default gen_random_uuid(),
  conta_id        uuid not null references conta(id) on delete cascade,
  campanha_id     uuid not null references campanha(id) on delete cascade,

  -- E.164 sem o '+': país + DDD + número, só dígitos. É o formato que a Cloud
  -- API aceita, e guardar já normalizado evita normalizar em três lugares.
  telefone_e164   text not null,

  -- Valores das variáveis do modelo, em ordem: o primeiro item é `{{1}}`.
  -- Array e não objeto porque a Meta numera por POSIÇÃO.
  variaveis       jsonb not null default '[]'::jsonb,

  -- pendente  — ainda não saiu
  -- enviando  — uma tentativa está em curso (evita envio duplicado)
  -- enviada   — a META ACEITOU. Não significa que chegou.
  -- entregue  — chegou ao aparelho (webhook `delivered`)
  -- lida      — o destinatário abriu (webhook `read`)
  -- falhou    — a Meta recusou, no envio ou depois
  status          text not null default 'pendente'
                  check (status in ('pendente','enviando','enviada','entregue','lida','falhou')),

  -- O identificador da mensagem na Meta. É por ele que o webhook encontra esta
  -- linha — sem ele, o status de entrega chega e não há a quem atribuir.
  wa_message_id   text,

  -- O motivo REAL da falha, do catálogo de erros da Meta. Guardar só "falhou"
  -- obriga a adivinhar depois, e é o que faz o suporte pedir print em vez de
  -- responder.
  erro_codigo     integer,
  erro_titulo     text,
  erro_detalhe    text,

  enviada_em      timestamptz,
  entregue_em     timestamptz,
  lida_em         timestamptz,
  falhou_em       timestamptz,

  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

comment on column campanha_destinatario.status is
  'enviada = a Meta aceitou; entregue = chegou ao aparelho. São fatos diferentes.';

comment on column campanha_destinatario.wa_message_id is
  'wamid. É a chave que liga o webhook de status a esta linha.';

select rc_rls_conta('campanha_destinatario');

drop trigger if exists tg_campanha_destinatario_touch on campanha_destinatario;
create trigger tg_campanha_destinatario_touch before update on campanha_destinatario
  for each row execute function rc_touch();

-- O mesmo número não entra duas vezes na mesma campanha. É a guarda contra o
-- clique duplo e contra o import repetido — barata aqui, cara depois: mensagem
-- duplicada queima o destinatário e cobra duas vezes.
create unique index if not exists idx_campanha_destinatario_unico
  on campanha_destinatario (campanha_id, telefone_e164);

-- Contagem por status na tela da campanha, e a fila do worker ('pendente').
create index if not exists idx_campanha_destinatario_status
  on campanha_destinatario (campanha_id, status);

-- O caminho quente do webhook: chega um wamid, precisa achar a linha.
-- Parcial porque a maioria das linhas nasce sem wamid, e índice sobre nulo é
-- espaço gasto à toa. Único porque wamid não se repete — e se repetisse, era
-- defeito nosso de reenvio, e é melhor estourar do que gravar duas verdades.
create unique index if not exists idx_campanha_destinatario_wamid
  on campanha_destinatario (wa_message_id)
  where wa_message_id is not null;
