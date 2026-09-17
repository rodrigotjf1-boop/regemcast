-- 017_recuperar_senha_campanha_lista.sql — Recuperar senha, código do app que não
-- vale duas vezes, e campanha montada a partir de uma lista de contatos.
--
--   1. `codigo_verificacao` aceita a finalidade `recuperar_senha`: o código que
--      chega por e-mail em "Esqueci minha senha".
--
--   2. O código de 6 dígitos do aplicativo autenticador passa a valer UMA vez.
--      O último passo de tempo aceito fica gravado; um código do mesmo passo (ou
--      de antes) é recusado. Sem isto, quem vê o código por cima do ombro entra
--      nos mesmos 30 a 90 segundos. Vale para clientes e operadores do console.
--
--   3. A campanha lembra de qual lista saiu, para a tela mostrar o público.
--      `on delete set null`: apagar a lista não apaga o histórico da campanha,
--      cujos destinatários já estão gravados em `campanha_destinatario`.
--
-- Idempotente: pode rodar duas vezes sem efeito diferente.

-- --------------------------------------------------------- codigo_verificacao

do $$
declare
  v_nome text;
begin
  -- A checagem da 014 foi criada sem nome: procura qualquer check que fale
  -- de finalidade e troca pela lista nova.
  for v_nome in
    select conname from pg_constraint
     where conrelid = 'codigo_verificacao'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%finalidade%'
  loop
    execute format('alter table codigo_verificacao drop constraint %I', v_nome);
  end loop;

  alter table codigo_verificacao add constraint ck_codigo_verificacao_finalidade
    check (finalidade in ('convite', 'login', 'ativar_email', 'recuperar_senha'));
end $$;

-- ------------------------------------------------------- passo do app (TOTP)

alter table usuario add column if not exists totp_ultimo_passo bigint;
alter table operador_distribuicao add column if not exists totp_ultimo_passo bigint;

comment on column usuario.totp_ultimo_passo is
  'Ultimo passo de tempo (30s) aceito do app autenticador. Codigo do mesmo passo ou anterior e recusado.';
comment on column operador_distribuicao.totp_ultimo_passo is
  'Ultimo passo de tempo (30s) aceito do app autenticador. Codigo do mesmo passo ou anterior e recusado.';

-- ------------------------------------------------------------------ campanha

alter table campanha add column if not exists lista_id uuid references contato_lista(id) on delete set null;

create index if not exists idx_campanha_lista on campanha (lista_id) where lista_id is not null;
