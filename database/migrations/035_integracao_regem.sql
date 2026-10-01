-- 035_integracao_regem.sql — O Regem como fonte de clientes e compras, como o Cardápio Web.
--
-- O Regem (o sistema de gestão da loja) é o ponto central: por ele chegam os clientes e as
-- vendas do cardápio próprio, do Anota Aí, do delivery direto e — só com a autorização do dono,
-- sob a responsabilidade dele — da 99Food (decisões do dono, 30/09/2026). Uma linha por conta:
-- a conta liga à EMPRESA do Regem, com todas as lojas.
--
-- A credencial é o token `rgm_it_…` da API de integração do Regem, ligado pelo console da
-- distribuição (a loja não copia nada), guardado CIFRADO com INTEGRACOES_CHAVE.
--
-- Clientes e vendas andam por CURSOR (a API do Regem carimba cada mudança): o ponto em que
-- parou fica aqui, e reinício ou deploy não perde nada.
--
-- `integracao_regem_cliente` liga o cliente do Regem ao contato: é por ela que o pedido de
-- esquecimento que o Regem manda (a lápide) apaga o que veio de lá, e que desfazer a
-- autorização da 99 tira quem entrou só por ela.
--
-- Idempotente: pode rodar duas vezes sem efeito diferente.

create table if not exists integracao_regem (
  id                        uuid primary key default gen_random_uuid(),
  conta_id                  uuid not null references conta(id) on delete cascade,

  -- A conexão: o token cifrado e o que a API do Regem diz que ele abre.
  credencial_cifrada        text,
  empresa_id                text,
  empresa_nome              text,
  lojas                     jsonb not null default '[]'::jsonb,
  escopos                   text[] not null default '{}',
  ligada_em                 timestamptz,
  ligada_por                text,

  -- A 99Food: a autorização do dono, com a responsabilidade dele sobre o CNPJ.
  incluir_99                boolean not null default false,
  autorizacao_99_por        uuid references usuario(id) on delete set null,
  autorizacao_99_em         timestamptz,
  autorizacao_99_texto      text,

  -- A declaração de consentimento do dono (como no Cardápio Web).
  consentimento_por         uuid references usuario(id) on delete set null,
  consentimento_em          timestamptz,
  consentimento_evidencia   text,
  lista_id                  uuid references contato_lista(id) on delete set null,
  importacao_id             uuid references importacao(id) on delete set null,

  -- ---- clientes (cursor)
  clientes_status           text not null default 'parado'
                            check (clientes_status in ('parado','carga','em_dia','falhou')),
  clientes_cursor           text,
  clientes_lidos            integer not null default 0,
  clientes_novos            integer not null default 0,
  clientes_bloqueados       integer not null default 0,
  clientes_ignorados        integer not null default 0,
  clientes_invalidos        integer not null default 0,
  clientes_removidos        integer not null default 0,
  clientes_ultima_consulta  timestamptz,
  clientes_erro             text,

  -- ---- vendas (cursor)
  pedidos_status            text not null default 'parado'
                            check (pedidos_status in ('parado','carga','em_dia','falhou')),
  pedidos_cursor            text,
  pedidos_lidos             integer not null default 0,
  pedidos_gravados          integer not null default 0,
  pedidos_ignorados         integer not null default 0,
  pedidos_ultima_consulta   timestamptz,
  pedidos_erro              text,

  -- O revezamento: um passo por vez (trava de 5 min) e quando pode sair o próximo.
  trava_ate                 timestamptz,
  proximo_em                timestamptz,

  criado_em                 timestamptz not null default now(),
  atualizado_em             timestamptz not null default now()
);

create unique index if not exists idx_integracao_regem_conta
  on integracao_regem (conta_id);

comment on table integracao_regem is
  'Conexao com a empresa no Regem (token cifrado), a autorizacao da 99 e o andamento de clientes e vendas por cursor.';
comment on column integracao_regem.incluir_99 is
  'O dono autorizou usar os clientes da 99Food, sob a responsabilidade dele (autorizacao_99_*).';

select rc_rls_conta('integracao_regem');

drop trigger if exists tg_integracao_regem_touch on integracao_regem;
create trigger tg_integracao_regem_touch before update on integracao_regem
  for each row execute function rc_touch();

-- ---------------------------------------------------------------- cliente do Regem → contato

create table if not exists integracao_regem_cliente (
  conta_id        uuid not null references conta(id) on delete cascade,
  regem_id        text not null,
  contato_id      uuid references contato(id) on delete set null,
  telefone_e164   text,
  canais          text[] not null default '{}',
  -- Entrou na base SÓ pela 99 (criado por esta conexão): sai se a autorização for desfeita.
  so_99           boolean not null default false,
  atualizado_em   timestamptz not null default now(),
  primary key (conta_id, regem_id)
);

create index if not exists idx_integracao_regem_cliente_contato
  on integracao_regem_cliente (contato_id);

comment on table integracao_regem_cliente is
  'Cliente do Regem ligado ao contato: apaga o que veio de la no esquecimento e tira quem entrou so pela 99.';

select rc_rls_conta('integracao_regem_cliente');

-- ---------------------------------------------------------------- importação
--
-- A importação vinda do Regem também deixa registro (quantos, quando, quem).

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'importacao_formato_check') then
    alter table importacao drop constraint importacao_formato_check;
  end if;
  alter table importacao add constraint importacao_formato_check
    check (formato in ('vcard','csv','xlsx','texto','cardapioweb','whatsapp_business','regem'));
end $$;
