# Contexto de build: raiz do repositório
FROM node:24-slim AS base
RUN npm install -g pnpm@12.8.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/

FROM base AS build
RUN pnpm install --frozen-lockfile --filter @doomscroll/api
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN pnpm --filter @doomscroll/api build

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter @doomscroll/api

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/package.json apps/api/
COPY apps/api/migrations apps/api/migrations
COPY personas personas
# Ponto de montagem do volume de mídia, já com dono node.
RUN mkdir -p /data/media && chown -R node:node /data
WORKDIR /app/apps/api
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
