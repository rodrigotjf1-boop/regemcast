-- 037_envio_do_modelo.sql — O disparo manda o que o modelo exige, não só as variáveis do texto.
--
-- Achado do roteiro da IA (01/10/2026, etapa Base). O envio só preenchia as
-- variáveis do corpo. Modelo com imagem, vídeo ou documento no cabeçalho, com
-- botão de copiar código ou em carrossel era aceito na campanha e recusado
-- pela Meta em TODAS as mensagens (132000 / 132012) — e cada destinatário
-- virava "falhou", um por um, até a fila acabar. Decisões do dono (01/10/2026):
-- a mídia e o cupom saem do próprio modelo; a oferta por tempo limitado vale
-- por N horas a partir do envio (padrão 3), guardadas no modelo; a variável do
-- título é um campo da campanha, como as do texto.
--
-- * `campanha.envio` — o que este modelo exige no envio, com os valores já
--   resolvidos (a mídia do cabeçalho, o código do cupom, a imagem de cada
--   cartão, as horas da oferta, de onde sai a variável do título). É uma FOTO
--   tirada ao criar a campanha, como o público: editar o modelo depois não
--   muda campanha montada. Nulo = só as variáveis do corpo (toda campanha
--   antiga, e todo modelo só de texto).
-- * `campanha_destinatario.variavel_cabecalho` — o valor da variável do título
--   para esta pessoa, resolvido na montagem como as variáveis do corpo.
-- * `modelo.lto_horas` — por quantas horas a oferta vale depois de enviada.
--   Horas, e não uma data: o modelo aprovado serve para sempre; data fixa o
--   queimaria no dia em que vencesse. Nulo = 3 horas.
-- * `midia_envio` — a mesma mídia, já entregue à Meta para ENVIO
--   (`POST /{numero}/media`). A Meta guarda o arquivo por 30 dias e devolve um
--   id; ele fica aqui para a campanha de 5 mil pessoas subir a imagem uma vez,
--   não 5 mil. Por número: o id é de quem subiu.
-- * `campanha.pausa_motivo` aceita `modelo` — a Meta recusou o MODELO (132000 a
--   132016) ou o arquivo dele sumiu: a campanha para na primeira recusa e o
--   resto da fila fica intacto, em vez de queimar um por um.
--
-- Idempotente.

set local lock_timeout = '10s';

-- ---------------------------------------------------------------- campanha
alter table campanha add column if not exists envio jsonb;

comment on column campanha.envio is
  'O que o modelo exige no envio alem das variaveis do corpo, com os valores resolvidos ao criar a campanha (midia do cabecalho, cupom, cartoes). Nulo = so o corpo.';

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'ck_campanha_pausa_motivo') then
    alter table campanha drop constraint ck_campanha_pausa_motivo;
  end if;
  alter table campanha add constraint ck_campanha_pausa_motivo
    check (pausa_motivo is null or pausa_motivo in ('conexao', 'teto_plano', 'inadimplencia', 'manual', 'modelo'));
end $$;

-- ---------------------------------------------------------------- destinatário
-- Tabela quente (disparo e webhook): coluna nula, sem reescrever nada.
alter table campanha_destinatario add column if not exists variavel_cabecalho text;

comment on column campanha_destinatario.variavel_cabecalho is
  'O valor da variavel do titulo (cabecalho de texto) para este destinatario, resolvido na montagem. Nulo = o modelo nao tem.';

-- ---------------------------------------------------------------- modelo
alter table modelo add column if not exists lto_horas integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_modelo_lto_horas') then
    alter table modelo add constraint ck_modelo_lto_horas
      check (lto_horas is null or lto_horas between 1 and 720);
  end if;
end $$;

comment on column modelo.lto_horas is
  'Oferta por tempo limitado: por quantas horas vale depois de enviada (1 a 720). Nulo = 3 horas.';

-- ---------------------------------------------------------------- midia_envio
create table if not exists midia_envio (
  id               uuid primary key default gen_random_uuid(),
  conta_id         uuid not null references conta(id) on delete cascade,
  midia_id         uuid not null references midia(id) on delete cascade,
  -- O número (da Meta) que subiu o arquivo: o id devolvido é dele.
  phone_number_id  text not null,
  -- O id que a Meta devolveu. Vale 30 dias; `expira_em` é marcado antes disso.
  media_id         text not null,
  expira_em        timestamptz not null,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

create unique index if not exists idx_midia_envio_unico
  on midia_envio (midia_id, phone_number_id);

select rc_rls_conta('midia_envio');

drop trigger if exists tg_midia_envio_touch on midia_envio;
create trigger tg_midia_envio_touch before update on midia_envio
  for each row execute function rc_touch();

comment on table midia_envio is
  'A midia do modelo ja entregue a Meta para ENVIO (POST /{numero}/media): o id que ela devolveu, por numero, ate vencer.';
