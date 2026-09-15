# Banco de dados — do zero ao primeiro `npm run migrate`

Este arquivo é o passo a passo literal. Siga na ordem: cada passo depende do
anterior. Se algo falhar no meio, o erro aparece inteiro no terminal — leia a
mensagem antes de repetir o comando.

Há dois caminhos, e você vai usar os dois:

- **Nuvem (Supabase)** — o banco de verdade, do produto. Quem aplica migration
  lá é você, à mão, pelo SQL Editor e pelo `npm run migrate`.
- **Local (Docker)** — o banco de desenvolvimento, descartável. É onde a
  migration é testada antes de subir.

---

## Parte 1 — Nuvem (Supabase)

### Passo 1. Criar o projeto, **na região de São Paulo**

1. Entre em <https://supabase.com/dashboard> e clique em **New project**.
2. Preencha:
   - **Name**: `regemcast` (ou `regemcast-prod`).
   - **Database Password**: gere uma senha forte e **guarde** — é a senha do
     usuário `postgres`, o dono do banco. Você vai usá-la no passo 4.
   - **Region**: **South America (São Paulo) · `sa-east-1`**.
3. Clique em **Create new project** e espere terminar de provisionar (1 a 2
   minutos).

> **Não escolha Oregon (`us-west-1`).** No Regem o banco ficou em Oregon e cada
> ida e volta até o banco custa ~200 ms. Para uma tela de ERP isso é lentidão;
> para disparo em massa é fatal, porque o custo se paga **por mensagem**: um
> lote de 10 mil contatos com 3 consultas por mensagem vira ~100 minutos só de
> viagem de rede, sem contar o trabalho de fato. Com o banco em São Paulo a
> mesma ida custa ~10 ms. A região **não pode ser trocada depois** — só
> migrando o projeto inteiro (foi o que ficou pendente no Regem).

### Passo 2. Rodar `000_roles.sql` como `postgres`

Este arquivo cria o usuário que a API usa. Ele é separado das demais migrations
porque criar role exige privilégio que a aplicação não tem — e não deve ter.

1. No painel do projeto, menu da esquerda, abra **SQL Editor** → **New query**.
   O SQL Editor já está logado como `postgres` (dono do banco).
2. Abra `database/migrations/000_roles.sql` no seu editor e **copie o conteúdo**.
3. Cole no SQL Editor e **troque a senha**: na linha

   ```sql
   create role regemcast_app login password 'TROQUE_ESTA_SENHA'
   ```

   substitua `TROQUE_ESTA_SENHA` por uma senha forte, diferente da senha do
   `postgres`. **Guarde essa senha** — ela vai para a `DATABASE_URL` no passo 3.
   Use só letras e números se quiser evitar dor de cabeça com URL-encoding
   (`@`, `:`, `/` e `#` precisam ser escapados dentro da URL de conexão).
4. Clique em **Run**. A resposta esperada é `Success. No rows returned`.
5. Confira na mesma janela, com uma query nova:

   ```sql
   select rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
     from pg_roles
    where rolname = 'regemcast_app';
   ```

   Tem que voltar **uma linha**, e as quatro colunas booleanas todas `false`.
   Se `rolbypassrls` vier `true`, pare: esse role ignora RLS e o isolamento
   entre contas deixa de existir. Apague o role e rode o arquivo de novo.

> Por que isso importa: no Regem a migration de RLS abre com um guard que faz
> `return` quando o role não existe. Criar o role era passo manual — nunca foi
> feito — então a migration rodou, "passou", e **a RLS nunca chegou a ser
> criada**. Aqui o role vem primeiro e o runner de migration se **recusa** a
> aplicar a `001` sem ele.

### Passo 3. Montar a `DATABASE_URL`

No painel: **Project Settings** (engrenagem) → **Database** → seção
**Connection string** → aba **URI**.

O Supabase mostra a string do usuário `postgres`. Você precisa de **duas** URLs:

| Variável                  | Usuário          | Para quê                                  |
| ------------------------- | ---------------- | ----------------------------------------- |
| `DATABASE_URL`            | `regemcast_app`  | a API, o tempo todo. Sem `bypassrls`.     |
| `MIGRATION_DATABASE_URL`  | `postgres`       | só para rodar `npm run migrate`.          |

Pegue o host e a porta da string que o Supabase mostrou e troque usuário e
senha. O formato é:

```
postgres://<usuario>:<senha>@<host>:<porta>/postgres
```

Exemplo. **Troque `SEU_ID_DO_PROJETO` e as senhas** — copiar esta linha como está resulta em `ENOTFOUND` no primeiro acesso ao banco:

```
DATABASE_URL=postgres://regemcast_app:SENHA_DO_APP@db.SEU_ID_DO_PROJETO.supabase.co:5432/postgres
MIGRATION_DATABASE_URL=postgres://postgres:SENHA_DO_POSTGRES@db.SEU_ID_DO_PROJETO.supabase.co:5432/postgres
```

Coloque as duas em `backend/.env` (copie de `backend/.env.example` se ainda não
existir) e deixe `DATABASE_SSL=require` — em produção o certificado é conferido
de verdade.

Duas variáveis porque `regemcast_app` **não tem `CREATE` no schema public**: ele
lê e escreve nas tabelas, e é só. Quem cria tabela é o dono do banco. O runner
detecta isso e diz exatamente o que fazer se você esquecer.

> **Nunca** comite o `.env`. Ele está no `.gitignore`; confira com
> `git status --short` antes de commitar.

> Se for usar o **pooler** do Supabase (porta `6543`, "Transaction pooler"),
> use-o apenas na `DATABASE_URL` da API — e saiba que o pooler em modo
> transaction não mantém `SET` fora de transação. O Regemcast define o GUC
> `app.conta_id` com `set_config(..., true)`, que vive dentro da transação, então
> funciona nos dois modos. Para migration, use a conexão direta (porta `5432`).

### Passo 4. Aplicar as migrations

Na raiz do repositório:

```bash
cd backend
npm ci          # só na primeira vez
npm run migrate -- --status   # mostra o que já está aplicado e o que falta
npm run migrate -- --dry      # mostra o que ele aplicaria, sem tocar no banco
npm run migrate               # aplica
```

O que esperar na primeira execução:

```
banco: postgres · usuário: postgres
Aplicando 1 migration(s).
  ✓ 001_fundacao.sql  (412 ms)

Pronto — 1 migration(s) aplicada(s).
```

Como o runner se comporta:

- ele cria a tabela `schema_migrations (arquivo, hash, aplicada_em)` sozinho;
- aplica **só o que ainda não está no ledger**, em ordem alfabética, **cada
  arquivo na própria transação** — se a terceira falhar, as duas primeiras
  continuam aplicadas e a terceira volta atrás inteira;
- guarda o `sha256` de cada arquivo. Se um arquivo **já aplicado** for editado,
  ele **aborta** dizendo qual é. Migration aplicada não se edita: o banco que já
  rodou a versão antiga nunca veria a mudança. Corrija criando **outra**
  migration com o próximo número;
- `000_roles.sql` **não** entra no ledger e **não** é aplicado por ele (exige
  superusuário);
- quando algo falha, imprime `SQLSTATE`, mensagem, `detail`, `hint` e a
  **linha e coluna** exatas dentro do arquivo.

Erros comuns e o que significam:

| O que aparece | O que fazer |
| --- | --- |
| `o role regemcast_app não existe neste banco.` | Você pulou o passo 2. Rode `000_roles.sql` no SQL Editor como `postgres`. |
| `o usuário regemcast_app não pode criar objetos no schema public.` | Falta a `MIGRATION_DATABASE_URL` com o usuário `postgres` (passo 3). |
| `não consegui conectar no banco (ENOTFOUND)` | Host errado na URL, ou senha com caractere especial não escapado. |
| `migration já aplicada foi alterada` | Alguém editou um `.sql` que já rodou. Reverta a edição e crie uma migration nova. |

### Passo 5. Conferir que a RLS está valendo

Este passo não é opcional. RLS que não está ligada não dá erro — ela só deixa
de isolar, em silêncio.

No **SQL Editor** do Supabase, rode as três verificações:

**5.1 — o usuário da aplicação não ignora RLS**

```sql
select rolbypassrls from pg_roles where rolname = 'regemcast_app';
```

Tem que voltar **`false`**. Se vier `true`, a RLS é decorativa para a API.

**5.2 — as policies existem**

```sql
select tablename, policyname
  from pg_policies
 where schemaname = 'public'
 order by tablename;
```

Tem que **listar** as policies. Depois da `001` e da `002`, são **oito linhas**:

| tablename      | policyname          | o que faz |
| -------------- | ------------------- | --------- |
| `assinatura`   | `rc_isolamento`     | só a própria conta |
| `auditoria`    | `rc_isolamento`     | só a própria conta |
| `conta`        | `rc_isolamento`     | só a própria conta |
| `lista_espera` | `rc_sistema`        | só escopo de sistema |
| `plano`        | `rc_sistema`        | escrita só no escopo de sistema |
| `plano`        | `rc_plano_leitura`  | **leitura liberada** — veio da `002` |
| `usuario`      | `rc_isolamento`     | só a própria conta |
| `uso_ciclo`    | `rc_isolamento`     | só a própria conta |

As **duas** linhas de `plano` estão certas. Policies permissivas somam com `OR`,
e elas têm alcances diferentes: `rc_plano_leitura` é `for select`, então libera
só a leitura do catálogo de planos para o escopo do tenant; `rc_sistema` é
`for all` e continua sendo a única que autoriza escrita. O catálogo de planos
não é segredo de ninguém, e sem essa leitura a rota `GET /conta` precisaria
abrir escopo de sistema no meio do request — o que abriria uma transação dentro
da outra e travaria o pool.

Resultado **vazio** significa que a `001` não aplicou a parte de RLS — pare e
investigue antes de colocar qualquer dado real.

**5.3 — RLS ligada e forçada em cada tabela**

```sql
select relname, relrowsecurity, relforcerowsecurity
  from pg_class
 where relnamespace = 'public'::regnamespace
   and relkind = 'r'
 order by relname;
```

Todas as tabelas de negócio têm que ter `relrowsecurity = true` **e**
`relforcerowsecurity = true`. Sem o `force`, o dono da tabela continua
enxergando tudo.

Uma exceção esperada aparece na lista: **`schema_migrations`** vem com `false`
nas duas colunas, e está certo. Ela é o ledger do runner de migration — não tem
`conta_id`, não guarda dado de cliente e não pertence a conta nenhuma. Se
`schema_migrations` for a **única** linha com `false`, está tudo em ordem.

Para o teste que **prova** que a RLS pega — abrir uma transação, apontar para a
conta A e tentar ler linha da conta B — veja [`rls.md`](./rls.md).

---

## Parte 2 — Local

Aqui é onde a migration é testada antes de ir para a nuvem.

São dois caminhos. **Nesta máquina vale o caminho B**: não há Docker instalado,
e existe um PostgreSQL 18 nativo escutando na `5432` — o mesmo que o Regem usa
em dev. O banco do Regemcast é separado (`regemcast`); nada do Regem é tocado.

| | Caminho A — Docker | Caminho B — Postgres nativo |
| --- | --- | --- |
| Quando usar | máquina com Docker | **esta máquina** |
| Postgres | container | serviço do Windows, porta 5432 |
| Redis | container | **não tem** — `/saude/pronto` responde 503 no Redis |
| Apagar e recomeçar | `down -v` + `rm -rf .pgdata` | `drop schema public cascade` |

Redis só vira impeditivo na Fase 4, quando entra a fila de disparo. Até lá a
API sobe e funciona sem ele; o único efeito é `/saude/pronto` acusar `redis:
"falhou"`, que é o comportamento correto e não um defeito.

---

### Caminho B — Postgres nativo (sem Docker)

**B.1 — Criar o banco**, conectado como `postgres`:

```sql
create database regemcast;
```

**B.2 — Criar o role**, já dentro do banco `regemcast`, como `postgres`. Rode o
conteúdo de `database/migrations/000_roles.sql`, trocando a senha do arquivo
por uma de desenvolvimento.

**B.3 — Apontar o `backend/.env`** para ele:

```
DATABASE_URL=postgres://regemcast_app:SUA_SENHA_DEV@localhost:5432/regemcast
MIGRATION_DATABASE_URL=postgres://postgres:SENHA_DO_POSTGRES@localhost:5432/regemcast
DATABASE_SSL=disable
REDIS_URL=redis://localhost:6379
```

As duas URLs são necessárias e **têm papéis diferentes**: a API roda como
`regemcast_app`, que não tem permissão de DDL (é o que garante que ela não possa
alterar o próprio schema); o runner de migration precisa de um usuário que
tenha. Sem a `MIGRATION_DATABASE_URL`, `npm run migrate` para e explica isso.

**B.4 — Aplicar e subir**:

```bash
cd backend
npm run migrate          # cria o ledger e aplica 001 e 002
npm run migrate -- --status
npm run build && npm start
```

Para começar do zero (apaga tudo do banco `regemcast`, como `postgres`):

```sql
drop schema public cascade;
create schema public;
```

Depois disso, repita B.2 e B.4 — o ledger some junto com o schema, então as
migrations rodam de novo desde a `001`.

---

### Caminho A — Docker

### Passo 1. Subir Postgres e Redis

Na raiz do repositório:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Sobem dois containers:

| Serviço    | Porta local | Credencial               |
| ---------- | ----------- | ------------------------ |
| `postgres` | `5432`      | `postgres` / `postgres`  |
| `redis`    | `6379`      | sem senha                |

Confira que ficaram saudáveis:

```bash
docker compose -f docker-compose.dev.yml ps
```

A coluna de status precisa dizer `healthy` nos dois. Se a porta `5432` já
estiver ocupada por um Postgres instalado na máquina, pare o serviço local ou
troque a porta publicada no `docker-compose.dev.yml`.

Os dados ficam em `./.pgdata`, que está no `.gitignore`. Para começar do zero:

```bash
docker compose -f docker-compose.dev.yml down -v
rm -rf .pgdata
```

### Passo 2. Criar o role local

O banco local também roda com RLS — senão você testa num ambiente que não
parece com produção e a surpresa aparece no cliente.

```bash
docker compose -f docker-compose.dev.yml exec -T postgres \
  psql -U postgres -d regemcast < database/migrations/000_roles.sql
```

No PowerShell, o redirecionamento com `<` não funciona igual; use:

```powershell
Get-Content database/migrations/000_roles.sql | docker compose -f docker-compose.dev.yml exec -T postgres psql -U postgres -d regemcast
```

Em dev pode deixar a senha padrão do arquivo — ela não sai da sua máquina. Em
produção, não.

### Passo 3. Apontar o `.env` para o banco local

Em `backend/.env`:

```
DATABASE_URL=postgres://regemcast_app:TROQUE_ESTA_SENHA@localhost:5432/regemcast
MIGRATION_DATABASE_URL=postgres://postgres:postgres@localhost:5432/regemcast
DATABASE_SSL=disable
REDIS_URL=redis://localhost:6379
```

`DATABASE_SSL=disable` porque o Postgres do compose não fala TLS. Em produção é
`require`.

### Passo 4. Aplicar e subir

```bash
cd backend
npm run migrate
npm run start:dev
```

A API sobe em <http://localhost:3010/api/v1> e, com `SWAGGER_ENABLED=true`, a
documentação fica em <http://localhost:3010/api/v1/docs>.

O front:

```bash
cd frontend
npm ci
npm run dev      # http://localhost:3011
```

---

## Criando uma migration nova

1. Olhe o **último número** existente em `database/migrations/` e use o
   **próximo** na sequência, sem pular nem repetir: `002_...`, `003_...`.
2. Escreva SQL idempotente (`create table if not exists`, `create index if not
   exists`, guardas em `do $$ ... $$`).
3. **Toda tabela com `conta_id` liga a RLS na mesma migration**, com
   `select rc_rls_conta('nome_da_tabela');`. Tabela da distribuição usa
   `rc_rls_sistema`.
4. Teste no banco local (`npm run migrate`), confira o resultado, e só então
   aplique na nuvem.
5. **Aplicado na nuvem, o arquivo está congelado.** Correção vira migration
   nova. O runner recusa rodar se o conteúdo mudar.

Divisão de responsabilidade: **o dono aplica na nuvem; o agente testa no
local.** Nunca aplicar direto na nuvem algo que não rodou limpo no local antes.
