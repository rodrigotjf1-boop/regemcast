# RegemCast

Disparo de WhatsApp em massa pela **API oficial da Meta** (Cloud API). Cada
cliente conecta o próprio WhatsApp Business Account, importa a base com opt-in,
monta o modelo aprovado e acompanha entrega, leitura e clique.

Monorepo: **backend** NestJS + Postgres (Drizzle, RLS por conta) + Redis/BullMQ;
**frontend** Next.js 14.

## Rodar local em 5 passos

```bash
# 1. Banco e fila
docker compose -f docker-compose.dev.yml up -d

# 2. Role da aplicação (uma vez; sem ele o runner recusa a migration)
docker compose -f docker-compose.dev.yml exec -T postgres \
  psql -U postgres -d regemcast < database/migrations/000_roles.sql

# 3. Configuração
cp backend/.env.example backend/.env     # preencha DATABASE_URL e JWT_SECRET
cp frontend/.env.example frontend/.env.local

# 4. Schema
cd backend && npm ci && npm run migrate

# 5. Subir
npm run start:dev          # API  → http://localhost:3000/api/v1
cd ../frontend && npm ci && npm run dev   # Web → http://localhost:3001
```

Documentação da API (com `SWAGGER_ENABLED=true`):
<http://localhost:3000/api/v1/docs>.

## Documentação

| Arquivo | O que tem |
| --- | --- |
| [`docs/banco.md`](docs/banco.md) | Preparar o banco do zero — Supabase (São Paulo) e local, passo a passo, com as verificações. |
| [`docs/rls.md`](docs/rls.md) | Como o isolamento entre contas funciona e o teste em SQL que prova que ele pega. |
| [`CLAUDE.md`](CLAUDE.md) | Regras permanentes do projeto: canal oficial, opt-in/opt-out, fila idempotente, convenções e fluxo de trabalho. |

## Comandos úteis

```bash
npm run migrate -- --status   # o que já foi aplicado e o que falta
npm run migrate -- --dry      # o que aplicaria, sem tocar no banco
npm run typecheck             # tsc --noEmit (backend e frontend)
npm run build                 # obrigatório antes de qualquer push
```

## Licença

Software proprietário. Todos os direitos reservados.
