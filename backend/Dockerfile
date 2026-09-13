# RegemCast — API.
#
# O contexto de build é a RAIZ do repositório, não a pasta backend/:
#   docker build -f backend/Dockerfile -t regemcast-api .
# Assim a imagem carrega também database/migrations, e `npm run migrate` roda
# de dentro do container — o mesmo binário que sobe é o que aplica o schema.
#
# Nada de ARG com segredo: build arg fica gravado no histórico da imagem e
# `docker history` mostra para qualquer um que baixe. Segredo entra só em
# runtime, por variável de ambiente.

# ---------------------------------------------------------------- deps
FROM node:22-alpine AS deps
WORKDIR /app
# argon2 é módulo nativo: sem toolchain o node-gyp falha no musl. Estes pacotes
# ficam só aqui e não vão para a imagem final.
RUN apk add --no-cache python3 make g++
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------- build
FROM deps AS build
WORKDIR /app
COPY backend/tsconfig.json backend/nest-cli.json ./
COPY backend/src ./src
RUN npm run build

# ---------------------------------------------------------------- deps de produção
FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------- runtime
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

# O usuário `node` (uid 1000) já vem na imagem. Rodar como root em container é
# convite para escalada de privilégio se algum dia houver RCE na aplicação.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build     --chown=node:node /app/dist ./dist
COPY --chown=node:node backend/package.json ./package.json
COPY --chown=node:node backend/scripts ./scripts
COPY --chown=node:node database/migrations ./database/migrations

USER node
EXPOSE 3000

# fetch é global no Node 22 — não precisa de curl nem wget na imagem.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
