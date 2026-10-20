-- 047_autorizacao_por_clique.sql
--
-- A autorizacao por clique do Hub DMS (F2, etapa B1): o dono da conta liga um
-- aplicativo de outro produto da DMS (o Liame) confirmando com a senha dele, sem
-- token emitido pela distribuicao. E a tela unica do Padrao DMS (§3, ajustado em
-- 20/10/2026), com o prototipo aprovado pelo dono no mesmo dia.
--
-- O caminho:
-- 1. o servidor do aplicativo registra o PEDIDO (pedido empurrado, RFC 9126) com
--    o token do DMS ID: endereco de volta, permissoes, state, desafio PKCE e a
--    conta que pede no sistema dele. O navegador leva so o aplicativo e o numero
--    do pedido, entao o que a tela mostra nao se troca no caminho;
-- 2. o dono confere a pagina, decide o opcional e confirma com a senha: nasce a
--    AUTORIZACAO, com o texto mostrado e a versao dele (a prova), e um codigo de
--    uso unico que volta ao aplicativo;
-- 3. o aplicativo troca o codigo pelo segredo da LIGACAO, de servidor para
--    servidor. So ai a ligacao nasce (ou muda): nada nasce no clique.
--
-- Esta migration:
-- * integracao_pedido: o pedido, antes de haver conta (policy rc_sistema). So o
--   resumo do numero do pedido; vale 10 minutos e uma vez so;
-- * integracao_autorizacao: a decisao do dono, por conta (RLS da conta). O texto e
--   a versao ficam para sempre (e a prova): a aplicacao nao apaga linha daqui. O
--   codigo vai so em resumo;
-- * integracao_ligacao.autorizacao_id: a autorizacao de onde a ligacao veio; e um
--   indice unico, uma ligacao ATIVA por conta e aplicativo (duas trocas ao mesmo
--   tempo nao deixam duas ligacoes valendo). Conferido na producao em 20/10/2026:
--   nenhuma conta com duas ligacoes ativas;
-- * usuario.autorizacao_erros, autorizacao_erro_em e autorizacao_travada_ate: a
--   trava da senha na autorizacao (5 erradas em 15 minutos travam por 15 minutos),
--   separada da trava da entrada na conta.
--
-- Nada usa estas tabelas enquanto AUTORIZACAO_POR_CLIQUE estiver desligada.
-- Sem instrucao destrutiva. Idempotente: pode rodar de novo.

set local lock_timeout = '10s';

create table if not exists integracao_pedido (
  id              uuid primary key default gen_random_uuid(),
  -- O client_id do aplicativo no DMS ID e o produto dele (o par de DMS_ID_APLICATIVOS).
  aplicativo      text not null,
  produto         text not null,
  -- sha-256 hex do numero do pedido (o request_uri inteiro). O numero em claro so sai na resposta do pedido.
  numero_hash     text not null,
  redirect_uri    text not null,
  -- O que o aplicativo pediu: as necessarias (sem chave na tela) e as opcionais (o dono decide).
  necessarias     jsonb not null default '[]'::jsonb,
  opcionais       jsonb not null default '[]'::jsonb,
  state           text not null,
  desafio         text not null,
  -- A conta que pede, no sistema do aplicativo: { nome, cnpj, email, marca }.
  conta_que_pede  jsonb not null,
  criado_em       timestamptz not null default now(),
  vence_em        timestamptz not null,
  -- Quando a pessoa decidiu (autorizou ou recusou): o pedido vale uma vez so.
  usado_em        timestamptz,
  constraint ck_integracao_pedido_aplicativo check (length(aplicativo) between 1 and 200),
  constraint ck_integracao_pedido_produto check (produto ~ '^[a-z][a-z0-9_-]{1,39}$'),
  constraint ck_integracao_pedido_necessarias check (jsonb_typeof(necessarias) = 'array'),
  constraint ck_integracao_pedido_opcionais check (jsonb_typeof(opcionais) = 'array'),
  constraint ck_integracao_pedido_conta check (jsonb_typeof(conta_que_pede) = 'object'),
  constraint ck_integracao_pedido_state check (length(state) between 16 and 200),
  constraint ck_integracao_pedido_desafio check (desafio ~ '^[A-Za-z0-9_-]{43}$')
);

create unique index if not exists idx_integracao_pedido_numero on integracao_pedido (numero_hash);
create index if not exists idx_integracao_pedido_vence on integracao_pedido (vence_em);

select rc_rls_sistema('integracao_pedido');

create table if not exists integracao_autorizacao (
  id                    uuid primary key default gen_random_uuid(),
  conta_id              uuid not null references conta(id) on delete cascade,
  -- O pedido de onde veio. Some quando a limpeza apaga o pedido vencido: a prova fica aqui, inteira.
  pedido_id             uuid references integracao_pedido(id) on delete set null,
  aplicativo            text not null,
  produto               text not null,
  -- Quem autorizou: o dono, confirmando com a senha.
  usuario_id            uuid references usuario(id) on delete set null,
  usuario_nome          text not null,
  -- O que foi liberado e as opcionais que ficaram desligadas.
  escopos               jsonb not null default '[]'::jsonb,
  opcionais_desligados  jsonb not null default '[]'::jsonb,
  conta_que_pede        jsonb not null,
  -- O CNPJ da conta que pede era outro (ou nenhum): o dono confirmou ligar a conta de outra empresa.
  outra_empresa         boolean not null default false,
  -- A prova: o texto que a tela mostrou e a versao dele.
  texto_versao          integer not null,
  texto                 jsonb not null,
  -- O codigo de uso unico: so o resumo, o desafio PKCE e o endereco que a troca confere.
  codigo_hash           text not null,
  codigo_vence_em       timestamptz not null,
  codigo_usado_em       timestamptz,
  redirect_uri          text not null,
  desafio               text not null,
  -- A ligacao que nasceu (ou mudou) na troca do codigo.
  ligacao_id            uuid references integracao_ligacao(id) on delete set null,
  criado_em             timestamptz not null default now(),
  constraint ck_integracao_autorizacao_aplicativo check (length(aplicativo) between 1 and 200),
  constraint ck_integracao_autorizacao_produto check (produto ~ '^[a-z][a-z0-9_-]{1,39}$'),
  constraint ck_integracao_autorizacao_escopos check (jsonb_typeof(escopos) = 'array'),
  constraint ck_integracao_autorizacao_desligados check (jsonb_typeof(opcionais_desligados) = 'array'),
  constraint ck_integracao_autorizacao_conta check (jsonb_typeof(conta_que_pede) = 'object'),
  constraint ck_integracao_autorizacao_texto check (jsonb_typeof(texto) = 'object' and texto_versao >= 1),
  constraint ck_integracao_autorizacao_desafio check (desafio ~ '^[A-Za-z0-9_-]{43}$')
);

create unique index if not exists idx_integracao_autorizacao_codigo on integracao_autorizacao (codigo_hash);
create index if not exists idx_integracao_autorizacao_conta on integracao_autorizacao (conta_id, criado_em desc);

select rc_rls_conta('integracao_autorizacao');

alter table integracao_ligacao
  add column if not exists autorizacao_id uuid references integracao_autorizacao(id) on delete set null;

-- Uma ligacao ATIVA por conta e aplicativo: a troca que encontra outra ativa gira o segredo dela em vez de criar
-- outra, e a corrida de duas trocas ao mesmo tempo cai no 23505 em vez de deixar duas valendo.
create unique index if not exists uq_integracao_ligacao_ativa
  on integracao_ligacao (conta_id, aplicativo) where revogado_em is null;

alter table usuario add column if not exists autorizacao_erros integer not null default 0;
-- A ultima senha errada: erro mais velho que 15 minutos nao conta para a trava.
alter table usuario add column if not exists autorizacao_erro_em timestamptz;
alter table usuario add column if not exists autorizacao_travada_ate timestamptz;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'regemcast_app') then
    execute 'grant select, insert, update, delete on integracao_pedido to regemcast_app';
    -- Sem delete: a autorizacao e a prova do que o dono aceitou. O revoke tira o delete que o privilegio padrao
    -- do 001 da a toda tabela nova (o mesmo cuidado da auditoria). O "on delete cascade" da conta segue valendo:
    -- a acao da chave estrangeira roda com o dono da tabela.
    execute 'grant select, insert, update on integracao_autorizacao to regemcast_app';
    execute 'revoke delete on integracao_autorizacao from regemcast_app';
  end if;
end $$;

comment on table integracao_pedido is
  'Pedidos de autorizacao por clique (pedido empurrado, RFC 9126), antes de haver conta: o que o aplicativo pediu e a conta que pede no sistema dele. So o resumo do numero do pedido; vale 10 minutos e uma vez so.';
comment on table integracao_autorizacao is
  'Autorizacoes por clique: o que o dono liberou, confirmando com a senha, com o texto mostrado e a versao dele (a prova, que nao se apaga). O codigo de uso unico vai so em resumo.';
comment on column integracao_ligacao.autorizacao_id is
  'A autorizacao por clique de onde a ligacao veio (ou a ultima que a mudou). Nulo na ligacao que veio de um token de integracao.';
comment on column usuario.autorizacao_erros is
  'Senhas erradas seguidas na autorizacao por clique. Na quinta, a autorizacao trava por 15 minutos (a entrada na conta nao).';
