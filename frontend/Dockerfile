# RegemCast — Web (Next.js, output standalone).
#
# O contexto de build é a RAIZ do repositório:
#   docker build -f frontend/Dockerfile -t regemcast-web .
#
# Segredo NÃO entra aqui — e, desde a config em runtime, NADA de configuração
# entra: o endereço da API é lido pelo servidor Next a cada inicialização, da
# variável API_URL_PUBLICA (ver src/lib/config-runtime.tsx). A imagem é a mesma
# em qualquer ambiente; trocar de domínio é trocar a variável e reiniciar.

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
