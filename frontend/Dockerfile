# RegemCast — Web (Next.js, output standalone).
#
# O contexto de build é a RAIZ do repositório:
#   docker build -f frontend/Dockerfile -t regemcast-web .
#
# Segredo NÃO entra aqui. A única ARG é NEXT_PUBLIC_API_URL, que por definição
# é pública: tudo que começa com NEXT_PUBLIC_ é embutido no bundle do navegador
# e qualquer visitante consegue ler. Chave de serviço, token da Meta e segredo
# de sessão vivem só no backend.

# ---------------------------------------------------------------- deps
FROM node:22-alpine AS deps
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------- build
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ ./
ARG NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Garante que public/ exista: COPY de pasta ausente quebra o estágio final, e
# um projeto sem arquivo estático nenhum é perfeitamente válido.
RUN mkdir -p public && npm run build

# ---------------------------------------------------------------- runtime
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
# Sem HOSTNAME=0.0.0.0 o servidor standalone escuta só em localhost e o
# container responde "conexão recusada" de fora, sem log nenhum.
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# O standalone já traz o mínimo de node_modules de que precisa — não se copia
# a pasta inteira de dependências para cá.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

USER node
EXPOSE 3001

# Redirecionar (307 para a tela de login) é resposta saudável; só 5xx e conexão
# recusada contam como falha.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/',{redirect:'manual'}).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
