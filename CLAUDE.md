# Regemcast — disparo de WhatsApp pela API oficial da Meta

> **Leia este arquivo inteiro antes de qualquer tarefa.** São as regras
> permanentes do projeto. Se uma instrução pontual conflitar com o que está
> aqui, **pergunte antes de agir**. Tarefa grande: plano primeiro, aprovação
> depois, código por último.

## O que é o produto

SaaS de **disparo de mensagens em massa pelo WhatsApp, usando a Cloud API
oficial da Meta**, para empresas externas. O cliente cadastra a base de
contatos, monta o modelo (template), agenda a campanha e acompanha entrega,
leitura e clique.

**O que o Regemcast NÃO é:** não é ERP, não tem pedido, cardápio, entregador,
loja, estoque, comanda nem PDV. Se uma tarefa pedir qualquer uma dessas coisas,
o pedido está no projeto errado — pergunte.

**Relação com o Regem:** o Regem (`C:\Regen`) é outro produto, separado. O
Regemcast nasceu das lições aprendidas lá, mas **não compartilha código, banco
nem deploy**. Nunca copie arquivo do Regem para cá e nunca altere nada lá.

## Stack e estrutura

Monorepo em `C:\RegemCast`.

- **`backend/`** — NestJS 10 + TypeScript estrito + Drizzle ORM + `pg`
  (Postgres/Supabase) + BullMQ/Redis para a fila de disparo. Prefixo da API:
  `/api/v1`. Um módulo por domínio em `src/modules/<dominio>/`
  (`*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`). Schema Drizzle em
  `src/db/schema.ts`. Swagger em `/api/v1/docs` (só com `SWAGGER_ENABLED=true`).
- **`frontend/`** — Next.js 14 (App Router) + Tailwind. `output: 'standalone'`.
  Roda na porta 3011 (a 3001 é do Regem, nesta máquina).
- **`database/migrations/`** — SQL escrito à mão, `NNN_nome.sql`. Aplicado por
  `backend/scripts/migrate.mjs` (`npm run migrate`), que mantém **ledger** em
  `schema_migrations`.
- **`docs/`** — [`banco.md`](docs/banco.md) (preparar o banco, passo a passo),
  [`rls.md`](docs/rls.md) (como o isolamento funciona e como provar que pega) e
  [`whatsapp.md`](docs/whatsapp.md) (os dois caminhos de conexão, coexistência,
  prazos e erros da Meta — com as fontes).
- **Infra** — `docker-compose.dev.yml` (Postgres + Redis local),
  `backend/Dockerfile`, `frontend/Dockerfile` (os dois com contexto na **raiz**
  do repositório), `.github/workflows/ci.yml`.

## Fontes da verdade

1. `docs/banco.md` e `docs/rls.md` — banco, migrations e isolamento.
   `docs/whatsapp.md` — o que a Meta exige em cada caminho de conexão. **Antes
   de afirmar qualquer regra da Meta, confira lá e nas fontes que ele cita** —
   caminho de menu ou prazo lembrado de cabeça já custou tempo mais de uma vez.
   `docs/deploy.md` — EasyPanel, Cloudflare e a armadilha do subdomínio de
   segundo nível (o Universal SSL não cobre, e a falha é de TLS, não de HTTP).
2. `database/migrations/*.sql` — o schema real. Antes de escrever query, **leia
   a migration**, não confie na memória.
3. `backend/src/db/schema.ts` — o espelho do schema em Drizzle.
4. `kit/LEIA-ME.md` — a marca (cores, logo, tipografia, regras da Meta).
   Resumo operacional em `docs/marca.md`. Onde divergirem, o **kit** vence.
5. Este arquivo — as regras.

## Regras invioláveis

### Marca

Detalhe e o porquê em `docs/marca.md`; fonte da verdade em `kit/LEIA-ME.md`.

- **O nome se escreve `Regemcast`** — um `R` maiúsculo, resto minúsculo. No
  logo, o wordmark é todo minúsculo.
- **Nunca** use "WhatsApp", "WA" ou "Zap" no **nome do produto**, no **ícone**,
  no **domínio** ou combinado ao logo. Em descrição, use o descritor exato:
  **"Integração via API Oficial do WhatsApp Business"** (constante `DESCRITOR`
  em `frontend/src/app/layout.tsx`). Na interface, nomeie a ação ("Conectar o
  número"), não a plataforma alheia.
- **Nunca** prometa "selo verificado": a Meta concede à conta do cliente, não
  o app concede.
- **Sobre lima `#A3E635`, texto sempre em ameixa `#2B1B3D` — nunca branco**
  (lima com branco dá 1,36:1). Logo, lima é **preenchimento**, não cor de
  texto sobre fundo claro. Não escureça nem esverdeie o lima, nem em *hover*:
  ele precisa manter distância do verde do WhatsApp `#25D366`.
- Cor nova entra como token em `globals.css`. **Nenhum componente usa cor
  crua.**

### Canal e conformidade

- **Só a Cloud API oficial da Meta.** Nada de Evolution, Baileys, WPPConnect,
  automação de WhatsApp Web ou qualquer biblioteca não oficial. O produto vende
  entrega confiável; canal não oficial é banimento a prazo.
- **1 conta = 1 WABA do cliente.** Cada conta conecta o **próprio** WhatsApp
  Business Account, pelo Embedded Signup. Número nosso não dispara em nome de
  cliente: a conformidade, a qualidade e o histórico ficam na WABA de quem
  envia. Um número compartilhado derrubaria todos os clientes de uma vez.
- **Opt-in provado, por contato.** Nenhum envio sai para contato sem opt-in
  registrado: **origem, data/hora e prova** (formulário, checkbox, importação
  declarada). Importação de lista sem origem declarada é bloqueada, não avisada.
- **Opt-out honrado no serviço de envio**, não na tela. Quem pediu para sair
  entra em bloqueio permanente e o **serviço de envio** recusa o disparo, venha
  de onde vier — campanha, teste, reenvio, API. Checagem no front ou no momento
  de montar a lista não conta: a lista pode ser montada antes do opt-out chegar.
- **Modelo (template) aprovado é obrigatório** para iniciar conversa. Texto
  livre só dentro da janela de 24h aberta pelo contato. A categoria declarada
  (marketing / utilidade / autenticação) precisa corresponder ao conteúdo —
  marketing disfarçado de utilidade derruba a qualidade da WABA do cliente.
- **Respeitar limite e qualidade.** Tier de mensagens (1k / 10k / 100k /
  ilimitado) e nota de qualidade são da WABA do cliente. O disparo respeita o
  teto do tier e **pausa** quando a Meta responde limite atingido — nunca insiste
  em cima do erro.

### Dados e acesso

- **RLS ligada, sempre.** Toda tabela com `conta_id` liga RLS **na mesma
  migration** que a cria (`select rc_rls_conta('tabela')`). A API conecta como
  `regemcast_app`, sem `bypassrls`. Detalhes em [`docs/rls.md`](docs/rls.md).
- **Toda consulta roda dentro de um contexto** (`comConta` ou
  `comEscopoSistema`). Fora de contexto, `ContextoDb.db` estoura de propósito.
- **`comEscopoSistema` só é autorizado por dois motivos:** (A) a conta ainda não
  é conhecida ou ainda não existe — login, revalidação de sessão no guard,
  convite, lista de espera, e depois webhook da Meta e jobs da fila; (B) o
  registro precisa sobreviver ao rollback da operação — hoje só a auditoria fora
  de contexto. Um uso que não caiba em (A) nem em (B) é decisão de arquitetura:
  discuta antes. A tabela com os usos atuais está em
  [`docs/rls.md`](docs/rls.md) e precisa crescer junto com o código.
- **Token da Meta é por conta, cifrado em repouso** (AES-256-GCM, chave em
  `META_TOKEN_CHAVE`). Nunca em log, nunca no front, nunca em resposta de API,
  nem parcialmente.
- **Usuário informa o mínimo; a distribuição conclui.** O cliente não cria app
  de desenvolvedor, não manuseia segredo, não vê `app secret` nem token. Ele
  autoriza pelo Embedded Signup e o resto é nosso, nos bastidores.
- **Auditoria append-only.** Toda mutação relevante registra quem, o quê, sobre
  qual entidade, de onde e quando. A tabela `auditoria` não aceita `update` nem
  `delete` — por trigger **e** por permissão.
- **RBAC no servidor.** Papéis: `dono` > `operador`. O front apenas esconde; a
  API não pode sequer devolver dado de quem não tem acesso.

### Disparo

- **Disparo é fila, não request.** Campanha enfileira; o request devolve na
  hora. Nada de laço de envio dentro de um controller.
- **Idempotência obrigatória.** Todo job carrega chave idempotente
  (`campanha_id + contato_id`). Retentativa **não** pode mandar a mesma mensagem
  duas vezes — cobrança dupla para o cliente e reclamação para o contato.
- **Retentativa com recuo exponencial** e classificação: erro permanente (número
  inválido, template reprovado) não se retenta; erro transitório (rate limit,
  5xx da Meta) sim.
- **Erro da Meta é traduzido pelo código numérico**, e o código real vai para o
  log e para a tela. `"Erro ao enviar"` é resposta proibida.

  | Código | O que é | O que o sistema faz |
  | --- | --- | --- |
  | `131026` | mensagem não entregável (número sem WhatsApp) | falha permanente, marca o contato |
  | `131047` | fora da janela de 24h | exige modelo aprovado |
  | `131049` | entrega contida pela Meta (saúde do ecossistema) | falha permanente do envio |
  | `130429` / `80007` | limite de taxa | pausa e reagenda com recuo |
  | `131031` | conta bloqueada | para a campanha e alerta a conta |
  | `132000` a `132015` | problema no modelo (parâmetro, pausa, reprovação) | para a campanha, aponta o modelo |
  | `133010` | número não registrado na Cloud API | bloqueia o envio, manda concluir a conexão |
  | `190` | token expirado ou revogado | pede reconexão da WABA |
  | `100` | parâmetro inválido | bug nosso — 5xx, não 4xx para o cliente |

  Código desconhecido **também** é registrado com número, título, mensagem e
  detalhe. Nunca engula o corpo do erro da Meta.
- **Assíncrono aceito ≠ entregue.** A Meta aceitar o envio significa só que ela
  aceitou. Entrega, leitura e falha chegam depois, pelo webhook — o status final
  vem de lá, e o que ficou sem status precisa ser reconciliado.
- **Webhook verifica assinatura** (`X-Hub-Signature-256`, HMAC sobre o corpo
  **cru**) e é **idempotente**: a Meta reentrega o mesmo evento.
- **Sem edge, sem servidor local, sem instalador.** O Regemcast é 100% nuvem.
  Se a tarefa falar em `.exe`, sync local ou appliance, é do Regem, não daqui.

### Escala

- **Multi-conta desde sempre.** Nenhuma query sem filtro de conta (e a RLS é a
  rede de proteção, não a única trava).
- **Operação em massa = 1 request + query set-based.** Nunca laço de N
  requisições nem de N queries. Importar 50 mil contatos é `insert ... select` /
  `copy`, não 50 mil `insert`.
- **Sem estado global mutável entre requisições.** Nada de singleton que guarda
  a conta do último request.
- **Nenhum caminho serializa os outros clientes.** Campanha grande de uma conta
  não pode travar a fila das demais.

## Convenções de código

- **DTO com `class-validator` em toda rota de escrita.** Nunca `@Body() dto:
  any` — o `ValidationPipe` é `whitelist + forbidNonWhitelisted + transform`, e
  sem classe DTO ele não valida nada.
- **`@Param('id', ParseUUIDPipe)`** em todo parâmetro uuid. Sem isso, id
  inválido vira 500 do Postgres em vez de 400.
- **TypeScript estrito.** Sem `any`: use o tipo certo, ou `unknown` com
  narrowing.
- **Senha com argon2id** (`argon2`). Nunca bcrypt, nunca hash próprio.
- **Telefone sempre E.164, com `+`** (`libphonenumber-js` valida e normaliza na
  entrada, uma vez).
- **Dinheiro em centavos, inteiro.** Nada de `float` para valor.
- **Data/hora em `timestamptz`**, e toda janela de envio e todo teto de período
  respeitam o `timezone` da conta — nunca `'America/Sao_Paulo'` cravado no SQL.
- **Nunca logar** segredo, senha, token, corpo de mensagem ou telefone completo.
  Telefone em log vai mascarado.
- **Status HTTP honesto:** erro do cliente é 4xx, erro nosso é 5xx. Configuração
  ausente no servidor **não** é 400.
- **Texto ao usuário em pt-BR, sentence case, voz ativa**, dizendo o que fazer
  ("Conecte o WhatsApp da empresa para enviar"). Nada de "Bad Request".
- **Responsividade é padrão** em toda tela: `grid-cols-1 sm:… lg:…`, `<table>`
  dentro de `overflow-x-auto`, nada de largura fixa. Testar em ~375px.
- **Acessibilidade:** `aria-pressed` em toggle, `aria-expanded` em dropdown,
  foco visível, `prefers-reduced-motion`.
- Componentes pequenos, um por arquivo. Comentário só onde o **porquê** não é
  óbvio, em pt-BR.

## O que NÃO fazer

- Não usar biblioteca não oficial de WhatsApp, em hipótese nenhuma.
- Não enviar para contato sem opt-in, nem ignorar opt-out "só neste teste".
- Não expor token, `app secret` ou qualquer credencial da Meta ao cliente.
- Não criar tabela com `conta_id` sem RLS na mesma migration.
- Não editar migration já aplicada — o runner recusa. Crie a próxima.
- Não implementar RBAC só no front.
- Não guardar dado de negócio em `localStorage`.
- Não engolir erro: `catch` vazio, ou `catch` que registra "erro ao enviar" sem
  o motivo real, é proibido.
- Não inventar tela ou fluxo sem combinar antes — pergunte.
- Não fazer push com build quebrado.

## Fluxo de trabalho

1. **Tarefa grande: plano antes do código.** Apresente, espere aprovação,
   destaque as migrations.
2. **Migration: o SQL vai para o dono ANTES do merge.** A ordem é rígida e não
   se inverte:

   1. o agente escreve a migration e a testa no banco **local**;
   2. **entrega o SQL ao dono e para** — sem push, sem merge do código que
      depende dela;
   3. o dono aplica na **nuvem** e confirma;
   4. só então o código é mesclado e deployado.

   O motivo é concreto: o Drizzle traduz `select()` para a lista explícita de
   colunas do schema. Entre um deploy que já pede a coluna nova e a migration
   que ainda não rodou, **toda consulta àquela tabela quebra e os dados somem
   da tela** — sem erro que aponte a causa. Foi incidente real no Regem.

   Antes de criar, confira o **último número** em `database/migrations/` e use
   o **próximo**, sem pular nem repetir. SQL idempotente sempre.
3. **Branch → PR → CI verde → merge.** Nada de commit direto na `main`. O CI
   roda `npm ci`, `typecheck`, `build` e `test` nos dois lados.
4. **Antes de qualquer push**, rode `npm run typecheck` e `npm run build` em
   `backend/` e `frontend/`.
5. **Nunca comitar segredo.** `.env` está no `.gitignore`; confira com
   `git status --short`.
6. Ao concluir um módulo, liste o que ficou de fora e o que depende de outra
   frente.

## Como rodar

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres + Redis
cd backend  && npm ci && npm run migrate && npm run start:dev   # :3000
cd frontend && npm ci && npm run dev                            # :3001
```

Preparação do banco, do zero: [`docs/banco.md`](docs/banco.md).
