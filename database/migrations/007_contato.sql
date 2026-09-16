-- 007_contato.sql — Base de contatos: quem pode receber, e por que pode.
--
-- Esta migration existe para tornar possível uma campanha de verdade. Até aqui
-- o destinatário era digitado à mão, dez por vez; a partir daqui ele vem de uma
-- base que o cliente importou do próprio celular, de uma planilha ou de um CRM.
--
-- A peça que não pode faltar é o CONSENTIMENTO, e ele não é enfeite jurídico:
-- é o que declaramos à Meta na submissão do App Review, com estas palavras —
-- "contacts who have given the customer explicit opt-in, recorded with source,
-- timestamp and evidence". Uma base sem essas três colunas transforma aquela
-- frase em declaração falsa.
--
-- E o opt-out mora aqui, na mesma linha do contato, de propósito. Na auditoria
-- do Regem o descadastro existia numa tabela ao lado e NÃO barrava o envio: o
-- disparo consultava a base de clientes e nunca cruzava com a lista de saída.
-- Guardando os dois juntos, esquecer de cruzar deixa de ser possível.
--
-- Idempotente: pode rodar duas vezes sem efeito diferente.

-- ------------------------------------------------------------- contato_lista

-- Um público. É o que a campanha escolhe no lugar de uma caixa de texto.
--
-- Lista é uma coleção explícita, e não um filtro salvo, porque o cliente
-- precisa saber EXATAMENTE quem vai receber antes de disparar. Filtro salvo
-- muda de tamanho sozinho entre o momento em que ele confere e o momento em
-- que a mensagem sai — e aí a conta da Meta chega maior do que o combinado.
create table if not exists contato_lista (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references conta(id) on delete cascade,

  nome          text not null,
  descricao     text,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table contato_lista is
  'Um publico. Colecao explicita, nao filtro salvo: o cliente precisa saber quem vai receber.';

select rc_rls_conta('contato_lista');

drop trigger if exists tg_contato_lista_touch on contato_lista;
create trigger tg_contato_lista_touch before update on contato_lista
  for each row execute function rc_touch();

create index if not exists idx_contato_lista_conta
  on contato_lista (conta_id, criado_em desc);

-- ---------------------------------------------------------------- importacao

-- O registro de cada importação. Existe por dois motivos práticos.
--
-- Primeiro, rastreio: quando o cliente perguntar "de onde veio este contato?",
-- a resposta precisa existir — e quando ele pedir para desfazer uma importação
-- que entrou errada, precisa haver o que desfazer.
--
-- Segundo, prestação de contas: os totais ficam gravados como foram NO DIA.
-- Recontar depois dá outro número, porque a base muda.
create table if not exists importacao (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references conta(id) on delete cascade,

  -- vcard    — export de contatos de Android/iPhone (.vcf)
  -- csv      — planilha em texto separado por vírgula
  -- xlsx     — planilha do Excel
  -- texto    — números colados na tela, separados por vírgula ou quebra de linha
  formato       text not null
                check (formato in ('vcard','csv','xlsx','texto')),

  arquivo_nome  text,

  -- Os totais como foram no momento da importação.
  total_lidos   integer not null default 0,
  validos       integer not null default 0,
  invalidos     integer not null default 0,
  novos         integer not null default 0,
  ja_existiam   integer not null default 0,

  -- Lista em que os contatos entraram, quando o cliente escolheu uma.
  lista_id      uuid references contato_lista(id) on delete set null,

  -- `set null` e não `cascade`: apagar quem importou não pode apagar o registro
  -- de que a importação aconteceu.
  criado_por    uuid references usuario(id) on delete set null,
  criado_em     timestamptz not null default now()
);

comment on table importacao is
  'Uma importacao de contatos. Os totais ficam como foram no dia - recontar depois da outro numero.';

select rc_rls_conta('importacao');

create index if not exists idx_importacao_conta
  on importacao (conta_id, criado_em desc);

-- ------------------------------------------------------------------- contato

-- Uma pessoa que pode receber mensagem desta conta.
create table if not exists contato (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references conta(id) on delete cascade,

  -- E.164 SEM o '+': país + DDD + número, só dígitos. Mesmo formato de
  -- `campanha_destinatario.telefone_e164`, e pelo mesmo motivo: é o que a Cloud
  -- API aceita.
  --
  -- ATENÇÃO ao portar o import do Regem: lá a normalização REMOVE o 55, porque
  -- aquela base guarda DDD+número. Aqui o 55 fica. Copiar aquela função sem ler
  -- transforma toda a base importada em número inválido de uma vez só.
  telefone_e164 text not null,

  nome          text,

  -- ---- consentimento: as três colunas que a Meta espera ver
  --
  -- declarado  — a empresa declarou, na importação, que tem o aceite
  -- formulario — a pessoa preencheu um formulário da empresa
  -- conversa   — a pessoa falou com a empresa primeiro
  -- api        — veio de um sistema do cliente que declarou o aceite
  consentimento_origem    text
                          check (consentimento_origem in ('declarado','formulario','conversa','api')),
  consentimento_em        timestamptz,
  -- Prova: a URL do formulário, o texto aceito, o nome do arquivo importado.
  consentimento_evidencia text,

  -- ---- descadastro
  --
  -- Mora aqui, e não numa tabela ao lado, para que nenhum caminho de envio
  -- consiga consultar o contato sem enxergar o opt-out.
  opt_out        boolean not null default false,
  opt_out_em     timestamptz,
  opt_out_origem text,

  -- De qual importação este contato veio. `set null` porque apagar o registro
  -- da importação não pode apagar as pessoas.
  importacao_id uuid references importacao(id) on delete set null,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on column contato.telefone_e164 is
  'E.164 sem o +, COM o codigo do pais. O import do Regem remove o 55 - aqui nao.';

comment on column contato.opt_out is
  'Fica na linha do contato de proposito: nenhum caminho de envio consegue ler um sem o outro.';

select rc_rls_conta('contato');

drop trigger if exists tg_contato_touch on contato;
create trigger tg_contato_touch before update on contato
  for each row execute function rc_touch();

-- O mesmo número não entra duas vezes na mesma conta. É a guarda contra a
-- reimportação do mesmo arquivo — barata aqui, cara depois: contato duplicado
-- é mensagem duplicada, que queima o destinatário e cobra duas vezes.
create unique index if not exists idx_contato_unico
  on contato (conta_id, telefone_e164);

-- A tela lista os contatos da conta, mais recentes primeiro.
create index if not exists idx_contato_conta
  on contato (conta_id, criado_em desc);

-- O caminho quente da campanha: quem pode receber. Parcial porque a pergunta é
-- sempre "quem NÃO saiu", e indexar quem saiu é espaço gasto à toa.
create index if not exists idx_contato_elegivel
  on contato (conta_id)
  where opt_out = false;

-- ------------------------------------------------------- contato_lista_item

-- Quem está em qual lista. Tabela de ligação, com conta_id próprio para que a
-- RLS funcione sem precisar de junção.
create table if not exists contato_lista_item (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references conta(id) on delete cascade,

  lista_id      uuid not null references contato_lista(id) on delete cascade,
  contato_id    uuid not null references contato(id) on delete cascade,

  criado_em     timestamptz not null default now()
);

select rc_rls_conta('contato_lista_item');

-- O mesmo contato não entra duas vezes na mesma lista.
create unique index if not exists idx_contato_lista_item_unico
  on contato_lista_item (lista_id, contato_id);

-- Contagem do público e leitura da lista na tela.
create index if not exists idx_contato_lista_item_lista
  on contato_lista_item (conta_id, lista_id);

-- "Em que listas este contato está?" — na tela do contato e no descadastro.
create index if not exists idx_contato_lista_item_contato
  on contato_lista_item (conta_id, contato_id);
