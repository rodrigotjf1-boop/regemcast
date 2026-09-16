-- 012_telemetria.sql — Erros gravados onde dá para consultar.
--
-- Esta migration nasce de uma auditoria, e vale registrar o que ela encontrou.
--
-- O tratamento de erro do produto está bom: existe filtro global, a mensagem ao
-- cliente é traduzida, o 500 ganha uma referência curta e a causa real vai para
-- o log. O problema não é o tratamento — é **onde o erro para**.
--
-- Hoje ele para no log do contêiner. Isso funciona quando alguém já sabe que
-- houve um problema e vai procurar; não funciona para responder "quantas contas
-- bateram no erro 131049 esta semana?" ou "esta conta está quebrando há quanto
-- tempo?". Um console de distribuição lendo `docker logs` não é um console.
--
-- Por isso a tabela. Ela guarda o que o log já dizia, num lugar consultável.
--
-- ESCOPO DE SISTEMA, NÃO DE CONTA. A regra do projeto é explícita: telemetria,
-- lógica interna e dados de outras contas são da DISTRIBUIÇÃO, e nunca ficam
-- visíveis ao cliente. Por isso `rc_rls_sistema` e não `rc_rls_conta`: mesmo
-- que uma rota do cliente consultasse esta tabela por engano, a policy devolve
-- vazio. O `conta_id` existe para AGRUPAR, não para dar acesso.
--
-- Idempotente: pode rodar duas vezes sem efeito diferente.

create table if not exists evento_erro (
  id            uuid primary key default gen_random_uuid(),

  -- Qual conta bateu no erro. Nulo quando aconteceu fora de sessão — login,
  -- webhook, rota pública. Serve para agrupar; não dá acesso a ninguém.
  conta_id      uuid references conta(id) on delete set null,

  -- A referência curta que o cliente vê na tela ("informe a referência ab12cd34
  -- ao suporte"). É por ela que o atendimento acha a linha.
  referencia    text,

  -- Onde aconteceu.
  rota          text,
  metodo        text,
  status        integer,

  -- De onde veio: nosso defeito, recusa da Meta, erro do cliente, banco.
  origem        text not null default 'api'
                check (origem in ('api','meta','banco','fila','webhook')),

  -- A classe do erro, quando há — `credencial`, `limite`, `config`, `parametro`.
  -- É o que permite contar "quantas contas estão com token vencido" sem ler
  -- mensagem livre.
  classe        text,

  -- O código da Meta, quando veio de lá (190, 131049, 132000…).
  codigo        integer,

  -- A mensagem técnica. NUNCA a mensagem traduzida ao cliente: essa já está na
  -- tela dele, e não ajuda a diagnosticar.
  mensagem      text,

  -- Contexto extra. Sem telefone inteiro, sem token, sem corpo de mensagem —
  -- a regra de não registrar dado pessoal vale aqui como vale no log.
  detalhe       jsonb not null default '{}'::jsonb,

  criado_em     timestamptz not null default now()
);

comment on table evento_erro is
  'Telemetria de erro, escopo de DISTRIBUICAO. O cliente nunca le esta tabela.';

comment on column evento_erro.mensagem is
  'Mensagem tecnica. Nunca a traduzida ao cliente - essa ja esta na tela dele.';

comment on column evento_erro.detalhe is
  'Contexto. Sem telefone inteiro, sem token, sem corpo de mensagem.';

select rc_rls_sistema('evento_erro');

-- O painel lê por janela de tempo, quase sempre "os últimos dias".
create index if not exists idx_evento_erro_tempo
  on evento_erro (criado_em desc);

-- "Esta conta está quebrando há quanto tempo?"
create index if not exists idx_evento_erro_conta
  on evento_erro (conta_id, criado_em desc)
  where conta_id is not null;

-- "Quantas contas bateram neste código?" — o agrupamento do painel.
create index if not exists idx_evento_erro_codigo
  on evento_erro (codigo, criado_em desc)
  where codigo is not null;

-- O suporte busca pela referência que o cliente informou.
create index if not exists idx_evento_erro_referencia
  on evento_erro (referencia)
  where referencia is not null;
