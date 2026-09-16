-- 013_operador_distribuicao.sql — Quem opera a distribuição, e o que cada um viu.
--
-- Até aqui a distribuição era protegida por UMA chave estática (`DIST_TOKEN`),
-- e o próprio código dizia por quê: "como ainda não existe sessão de
-- distribuição". Uma chave única resolve o acesso de uma pessoa. Para um
-- console que mostra dados de TODAS as contas, ela falha em três pontos:
--
--   1. não dá para saber QUEM olhou o quê — todo acesso é "a chave";
--   2. tirar o acesso de uma pessoa exige trocar a chave de todas;
--   3. se ela vazar, vaza o acesso total, sem segunda barreira.
--
-- Esta migration cria o operador com login próprio e verificação em duas
-- etapas, e o registro de cada acesso. A chave estática continua existindo,
-- mas passa a servir para UMA coisa: criar o primeiro operador.
--
-- ESCOPO DE SISTEMA NAS DUAS TABELAS. Operador não pertence a conta nenhuma, e o
-- que ele viu é assunto da distribuição — a regra do projeto é que nada disso
-- fica visível ao cliente. Por isso `rc_rls_sistema`, e não a `auditoria`
-- existente: ela é por conta, e o cliente leria nela "a distribuição olhou sua
-- conta às 14h".
--
-- Idempotente: pode rodar duas vezes sem efeito diferente.

-- ------------------------------------------------------ operador_distribuicao

create table if not exists operador_distribuicao (
  id              uuid primary key default gen_random_uuid(),

  nome            text not null,
  email           citext not null unique,

  -- argon2id, mesmos parâmetros do login do cliente.
  senha_hash      text not null,

  -- Verificação em duas etapas (TOTP, o código de 6 dígitos do aplicativo
  -- autenticador). O segredo é CIFRADO: com ele em claro, quem lê o banco gera
  -- os códigos e a segunda etapa deixa de existir.
  totp_segredo_cifrado text,
  -- Só vira verdade depois que o operador confirma um código válido. Segredo
  -- gerado e nunca confirmado não protege nada — e ativar antes da confirmação
  -- trancaria para fora quem escaneou errado.
  totp_ativo      boolean not null default false,

  -- ativo    — entra normalmente
  -- suspenso — não entra; as sessões abertas caem no próximo request
  status          text not null default 'ativo'
                  check (status in ('ativo','suspenso')),

  -- Sobe a cada troca de senha, suspensão ou reset de duas etapas. A sessão
  -- carrega a versão com que foi emitida; versão diferente = sessão morta. É o
  -- que permite derrubar um acesso NA HORA, sem esperar o cookie expirar.
  token_versao    integer not null default 1,

  -- Tentativas de login seguidas que falharam. Zera no acerto. Serve para travar
  -- adivinhação de senha e de código.
  tentativas_falhas integer not null default 0,
  bloqueado_ate   timestamptz,

  ultimo_login_em timestamptz,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

comment on table operador_distribuicao is
  'Quem opera a distribuicao. Nao pertence a conta nenhuma. Escopo de sistema.';

comment on column operador_distribuicao.totp_segredo_cifrado is
  'Cifrado. Em claro, quem le o banco gera os codigos e a segunda etapa deixa de existir.';

comment on column operador_distribuicao.token_versao is
  'Sobe a cada troca de senha ou suspensao: derruba as sessoes abertas NA HORA.';

select rc_rls_sistema('operador_distribuicao');

drop trigger if exists tg_operador_distribuicao_touch on operador_distribuicao;
create trigger tg_operador_distribuicao_touch before update on operador_distribuicao
  for each row execute function rc_touch();

-- -------------------------------------------------------- acesso_distribuicao

-- Cada coisa que um operador viu ou fez. Append-only, como a auditoria.
--
-- "Viu" entra, e não só "alterou". Num console de leitura, quase tudo é ver —
-- e a pergunta que importa depois de um incidente é justamente "quem abriu os
-- dados desta conta?".
create table if not exists acesso_distribuicao (
  id            bigserial primary key,

  -- `set null` e não `cascade`: remover o operador não pode apagar o que ele
  -- fez enquanto existia. O nome fica congelado ao lado, pelo mesmo motivo.
  operador_id   uuid references operador_distribuicao(id) on delete set null,
  operador_nome text,

  -- login, login_negado, codigo_negado, resumo.lido, assinaturas.lidas,
  -- telemetria.lida, conta.lida …
  acao          text not null,

  -- A conta que foi aberta, quando a ação é sobre uma conta específica.
  conta_id      uuid references conta(id) on delete set null,

  detalhe       jsonb not null default '{}'::jsonb,
  ip            inet,
  user_agent    text,
  criado_em     timestamptz not null default now()
);

comment on table acesso_distribuicao is
  'O que cada operador viu ou fez. Append-only. Escopo de sistema.';

select rc_rls_sistema('acesso_distribuicao');

-- Append-only de verdade: nem o escopo de sistema altera ou apaga. Um registro
-- de acesso que o próprio operador pode editar não é registro.
create or replace function rc_acesso_imutavel() returns trigger
language plpgsql as $$
begin
  raise exception 'acesso_distribuicao e append-only: registros nao sao alterados nem apagados';
end $$;

drop trigger if exists tg_acesso_distribuicao_imutavel on acesso_distribuicao;
create trigger tg_acesso_distribuicao_imutavel
  before update or delete on acesso_distribuicao
  for each row execute function rc_acesso_imutavel();

-- "O que este operador fez", do mais recente para trás.
create index if not exists idx_acesso_distribuicao_operador
  on acesso_distribuicao (operador_id, criado_em desc);

-- "Quem abriu esta conta?" — a pergunta de depois de um incidente.
create index if not exists idx_acesso_distribuicao_conta
  on acesso_distribuicao (conta_id, criado_em desc)
  where conta_id is not null;

create index if not exists idx_acesso_distribuicao_tempo
  on acesso_distribuicao (criado_em desc);
