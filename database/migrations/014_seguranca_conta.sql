-- 014_seguranca_conta.sql — CNPJ conferido, e-mail verificado e duas etapas no login.
--
-- Três coisas que o cadastro não garantia:
--
--   1. O CNPJ era um texto opcional, sem conferência. Qualquer número passava, e
--      a mesma empresa podia abrir várias contas.
--   2. O e-mail do login nunca foi confirmado por código.
--   3. O login do cliente era só senha. Senha vazada abria a conta inteira —
--      números conectados, contatos e disparos.
--
-- Esta migration guarda o resultado da consulta do CNPJ na conta, a
-- verificação do e-mail e as duas etapas no usuário, e cria a tabela dos códigos
-- de 6 dígitos enviados por e-mail.
--
-- Idempotente: pode rodar duas vezes sem efeito diferente.

-- ---------------------------------------------------------------------- conta

-- O que a Receita disse sobre o CNPJ, no momento do cadastro. Guardado para
-- responder "quem é esta conta?" sem consultar de novo.
alter table conta add column if not exists cnpj_razao_social text;
alter table conta add column if not exists cnpj_situacao     text;
alter table conta add column if not exists cnpj_conferido_em timestamptz;

comment on column conta.cnpj_conferido_em is
  'Quando o CNPJ foi conferido como ATIVO na Receita. Nulo = nunca conferido.';

-- Um CNPJ, uma conta. Na Meta é uma empresa, um WhatsApp Business: duas contas
-- do mesmo CNPJ disputariam o mesmo limite de envio sem saber uma da outra.
--
-- Com guarda: se já houver CNPJ repetido na base, o índice único não pode
-- nascer — e um erro aqui desfaria a migration inteira. Nesse caso ela avisa e
-- segue; o código também confere a duplicidade antes de gravar.
do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'uq_conta_cnpj') then
    if exists (
      select cnpj from conta where cnpj is not null group by cnpj having count(*) > 1
    ) then
      raise notice 'uq_conta_cnpj NAO criado: ha CNPJ repetido em conta. Resolva e rode de novo.';
    else
      create unique index uq_conta_cnpj on conta (cnpj) where cnpj is not null;
    end if;
  end if;
end $$;

-- -------------------------------------------------------------------- usuario

-- Quando o e-mail foi confirmado por código. Nulo = nunca confirmado.
alter table usuario add column if not exists email_verificado_em timestamptz;

-- nenhum — só senha
-- email  — código de 6 dígitos enviado por e-mail a cada login
-- app    — código do aplicativo autenticador (Google Authenticator e afins)
alter table usuario add column if not exists dois_fatores text not null default 'nenhum';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_usuario_dois_fatores') then
    alter table usuario add constraint ck_usuario_dois_fatores
      check (dois_fatores in ('nenhum', 'email', 'app'));
  end if;
end $$;

-- Segredo do aplicativo autenticador, CIFRADO. Em claro, quem lê o banco gera os
-- códigos e a segunda etapa deixa de existir. Pode estar preenchido com
-- `dois_fatores` diferente de 'app': é o cadastro iniciado e ainda não
-- confirmado.
alter table usuario add column if not exists totp_segredo_cifrado text;

-- Erros seguidos no código da segunda etapa. Cinco travam por 15 minutos: o
-- código tem só um milhão de combinações.
alter table usuario add column if not exists tentativas_falhas integer not null default 0;
alter table usuario add column if not exists bloqueado_ate     timestamptz;

comment on column usuario.totp_segredo_cifrado is
  'Cifrado. Em claro, quem le o banco gera os codigos e a segunda etapa deixa de existir.';

-- Donos que já existem entraram pelo link do convite, que só chega ao próprio
-- e-mail: o endereço está provado. Operadores foram criados pelo dono digitando
-- o e-mail, e ficam como não verificados.
update usuario
   set email_verificado_em = criado_em
 where papel = 'dono' and email_verificado_em is null;

-- --------------------------------------------------------- codigo_verificacao

-- Os códigos de 6 dígitos enviados por e-mail.
--
-- Guarda só o HMAC do código, com segredo do servidor. Um sha256 simples não
-- protegeria nada: são só um milhão de combinações, e quem lesse a tabela
-- acharia o código em um segundo.
create table if not exists codigo_verificacao (
  id               uuid primary key default gen_random_uuid(),

  -- convite      — confirmar o e-mail antes de criar a conta
  -- login        — segunda etapa do login por e-mail
  -- ativar_email — ligar a segunda etapa por e-mail nas configurações
  finalidade       text not null
                   check (finalidade in ('convite', 'login', 'ativar_email')),

  email            citext not null,
  usuario_id       uuid references usuario(id) on delete cascade,
  lista_espera_id  uuid references lista_espera(id) on delete cascade,

  codigo_hash      text not null,
  -- Erros neste código. No quinto ele morre, mesmo dentro da validade.
  tentativas       integer not null default 0,
  expira_em        timestamptz not null,
  -- Preenchido quando o código é aceito: não vale duas vezes.
  usado_em         timestamptz,
  criado_em        timestamptz not null default now()
);

comment on table codigo_verificacao is
  'Codigos de 6 digitos enviados por e-mail. So o HMAC do codigo. Escopo de sistema.';

-- Escopo de sistema: o código é conferido antes de existir sessão (convite,
-- login), e o cliente nunca lê esta tabela.
select rc_rls_sistema('codigo_verificacao');

-- "O último código desta finalidade para este e-mail" — a consulta de toda
-- conferência e do limite de reenvio.
create index if not exists idx_codigo_verificacao_email
  on codigo_verificacao (finalidade, email, criado_em desc);
