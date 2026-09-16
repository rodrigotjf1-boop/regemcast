-- 008_modelo.sql — Modelos de mensagem: o que o cliente cria, e o que a Meta respondeu.
--
-- Até aqui o Regemcast só LIA os modelos da Meta. O cliente que quisesse um
-- modelo novo precisava sair do nosso painel e criá-lo no WhatsApp Manager — o
-- que contradiz a regra do produto de que o usuário informa e nós concluímos.
--
-- Esta tabela é o espelho local do modelo, e existe por três motivos que só
-- aparecem depois:
--
-- 1. RASCUNHO. Um modelo leva minutos para ser escrito e a Meta o recusa por
--    detalhes (variável colada no fim do corpo, rodapé junto de oferta por
--    tempo limitado). Sem rascunho, cada recusa apaga o trabalho.
--
-- 2. MOTIVO DA RECUSA. A Meta devolve o motivo UMA vez, na resposta do POST.
--    Quem não grava naquele instante nunca mais sabe por que o modelo foi
--    recusado — e o cliente fica tentando de novo às cegas.
--
-- 3. HISTÓRICO. O modelo pode ser editado ou apagado na Meta depois. A campanha
--    grava o modelo por valor justamente porque o registro do que foi enviado
--    não pode mudar retroativamente; aqui guardamos a versão que submetemos.
--
-- Idempotente: pode rodar duas vezes sem efeito diferente.

create table if not exists modelo (
  id              uuid primary key default gen_random_uuid(),
  conta_id        uuid not null references conta(id) on delete cascade,

  -- Nome técnico da Meta: minúsculas, números e '_'. É o que identifica o
  -- modelo no envio, e não muda depois de aprovado.
  nome            text not null,
  idioma          text not null default 'pt_BR',

  -- MARKETING     — promoção, novidade, oferta
  -- UTILITY       — confirmação, atualização de pedido, lembrete
  -- AUTHENTICATION — código de verificação
  --
  -- A categoria decide o preço e as regras. A Meta pode RECLASSIFICAR um modelo
  -- que ela considere marketing disfarçado de utilidade — por isso o valor aqui
  -- é o que pedimos, e `categoria_meta` é o que ela devolveu.
  categoria       text not null default 'MARKETING'
                  check (categoria in ('MARKETING','UTILITY','AUTHENTICATION')),
  categoria_meta  text,

  -- ---- cabeçalho (opcional)
  --
  -- TEXT | IMAGE | VIDEO | DOCUMENT. Nulo = sem cabeçalho.
  cabecalho_formato text
                    check (cabecalho_formato in ('TEXT','IMAGE','VIDEO','DOCUMENT')),
  cabecalho_texto   text,
  -- Exemplo do valor de {{1}} no cabeçalho de texto. A Meta EXIGE o exemplo
  -- quando há variável, e num array SIMPLES (["João"]) — diferente do corpo,
  -- que usa array ANINHADO ([["João"]]). Trocar os dois é a recusa mais comum.
  cabecalho_exemplo text,
  -- Referência da mídia no nosso storage, antes de virar `header_handle`.
  cabecalho_midia   text,

  -- ---- corpo (obrigatório)
  corpo           text not null,
  -- Exemplos das variáveis do corpo, em ordem: o primeiro item é {{1}}.
  corpo_exemplos  jsonb not null default '[]'::jsonb,

  -- ---- rodapé (opcional)
  --
  -- Proibido pela Meta em modelo com oferta por tempo limitado.
  rodape          text,

  -- ---- botões
  --
  -- Array de objetos, cada um com tipo e rótulo. Guardado como JSON porque a
  -- forma muda conforme o tipo (URL tem link, telefone tem número, resposta
  -- rápida não tem nada além do texto) e normalizar isso em colunas criaria
  -- cinco colunas nulas em cada linha.
  botoes          jsonb not null default '[]'::jsonb,

  -- ---- oferta por tempo limitado
  --
  -- Só existe em MARKETING. Quando ativa, a Meta proíbe rodapé e proíbe
  -- cabeçalho de TEXTO — o cabeçalho tem que ser imagem, vídeo, ou nenhum.
  lto_ativo       boolean not null default false,
  lto_texto       text,

  -- rascunho   — escrito aqui, ainda não submetido
  -- enviado    — submetido, aguardando a Meta
  -- aprovado   — pode ser usado numa campanha
  -- rejeitado  — a Meta recusou; o motivo está em `motivo`
  -- pausado    — a Meta pausou por qualidade baixa
  -- desativado — removido na Meta
  status          text not null default 'rascunho'
                  check (status in ('rascunho','enviado','aprovado','rejeitado','pausado','desativado')),

  -- O que a Meta respondeu quando recusou. Ela diz UMA vez; não gravar aqui
  -- significa nunca mais saber o motivo.
  motivo          text,

  -- Id do modelo na Meta. Nulo enquanto é rascunho.
  meta_template_id text,

  -- `set null` e não `cascade`: apagar quem criou não pode apagar o modelo que
  -- campanhas já usaram.
  criado_por      uuid references usuario(id) on delete set null,

  enviado_em      timestamptz,
  respondido_em   timestamptz,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

comment on table modelo is
  'Espelho local do modelo de mensagem. Guarda o rascunho e o motivo da recusa, que a Meta diz uma vez so.';

comment on column modelo.cabecalho_exemplo is
  'Vai para a Meta como array SIMPLES (header_text). O corpo usa array ANINHADO. Trocar os dois e a recusa mais comum.';

comment on column modelo.categoria_meta is
  'A categoria que a Meta devolveu. Ela reclassifica marketing disfarcado de utilidade, e o preco muda junto.';

select rc_rls_conta('modelo');

drop trigger if exists tg_modelo_touch on modelo;
create trigger tg_modelo_touch before update on modelo
  for each row execute function rc_touch();

-- A Meta exige nome único por idioma dentro da WABA. Barrar aqui devolve uma
-- mensagem que o cliente entende, em vez do erro da Meta depois de ele ter
-- escrito o modelo inteiro.
create unique index if not exists idx_modelo_unico
  on modelo (conta_id, nome, idioma);

-- A tela lista os modelos da conta, mais recentes primeiro.
create index if not exists idx_modelo_conta
  on modelo (conta_id, criado_em desc);

-- O caminho do webhook de status do modelo: chega um id da Meta, precisa achar
-- a linha. Parcial porque rascunho nasce sem id, e índice sobre nulo é espaço
-- gasto à toa.
create unique index if not exists idx_modelo_meta_id
  on modelo (meta_template_id)
  where meta_template_id is not null;
