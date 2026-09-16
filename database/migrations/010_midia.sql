-- 010_midia.sql — Arquivos que o cliente envia do computador.
--
-- Existe por causa de um detalhe da Meta que muda a arquitetura: **ela não
-- busca a URL da imagem — ela recebe os bytes**. Antes de submeter um modelo
-- com cabeçalho de imagem, é preciso abrir uma sessão de upload na Graph,
-- empurrar o arquivo e receber de volta um `header_handle`. Só o handle vai no
-- componente do modelo.
--
-- Ou seja: para o cliente poder escolher um arquivo do computador dele, nós
-- precisamos guardar esse arquivo em algum lugar até a hora da submissão.
--
-- POR QUE `bytea` E NÃO UM SERVIÇO DE ARQUIVOS:
--
-- O volume aqui é pequeno e efêmero por natureza — algumas imagens por conta,
-- necessárias só até o handle ser obtido. Um bucket resolveria o mesmo problema
-- somando uma credencial poderosa a mais no ambiente, um serviço a mais para
-- cair e um caminho a mais para vazar arquivo de cliente. Para este tamanho, o
-- banco que já temos é a escolha mais simples e a que menos aumenta superfície.
--
-- Se o volume crescer, a migração é direta: a coluna `conteudo` vira nula e o
-- arquivo passa a viver fora, sem mexer em quem consome esta tabela.
--
-- Idempotente: pode rodar duas vezes sem efeito diferente.

create table if not exists midia (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references conta(id) on delete cascade,

  nome_arquivo  text not null,
  tipo_mime     text not null,
  tamanho_bytes integer not null,

  -- Os bytes. Nulo depois que o arquivo deixa de ser necessário — ver o
  -- comentário sobre expurgo abaixo.
  conteudo      bytea,

  -- O `header_handle` que a Meta devolveu. É o que de fato vai no modelo.
  -- Guardado para que reenviar um modelo não exija subir o arquivo de novo.
  meta_handle   text,
  meta_handle_em timestamptz,

  -- `set null` e não `cascade`: apagar quem subiu não pode apagar a imagem que
  -- um modelo aprovado ainda usa.
  criado_por    uuid references usuario(id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table midia is
  'Arquivo enviado pelo cliente. A Meta NAO busca URL: ela recebe os bytes e devolve um header_handle.';

comment on column midia.conteudo is
  'Os bytes. Podem ser expurgados depois que meta_handle existe - o modelo usa o handle, nao o arquivo.';

select rc_rls_conta('midia');

drop trigger if exists tg_midia_touch on midia;
create trigger tg_midia_touch before update on midia
  for each row execute function rc_touch();

-- A tela lista as mídias da conta, mais recentes primeiro.
create index if not exists idx_midia_conta
  on midia (conta_id, criado_em desc);

-- Quais ainda ocupam espaço. É a consulta do expurgo: arquivo que já virou
-- handle não precisa mais existir em bytes.
create index if not exists idx_midia_com_conteudo
  on midia (conta_id)
  where conteudo is not null;
