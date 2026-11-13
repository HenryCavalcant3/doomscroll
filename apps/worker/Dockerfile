# Contexto de build: raiz do repositório
FROM node:24-slim AS base
RUN npm install -g pnpm@12.8.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/

FROM base AS build
RUN pnpm install --frozen-lockfile --filter @doomscroll/worker
COPY tsconfig.base.json ./
COPY apps/worker apps/worker
RUN pnpm --filter @doomscroll/worker build

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter @doomscroll/worker

FROM node:24-slim
# ffmpeg vem do apt; yt-dlp é o binário oficial, fácil de atualizar:
#   docker compose build --build-arg YT_DLP_VERSION=<versão> worker
ARG YT_DLP_VERSION=latest
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && apt-get clean \
 && asset=yt-dlp_linux; [ "$TARGETARCH" = "arm64" ] && asset=yt-dlp_linux_aarch64; \
    if [ "$YT_DLP_VERSION" = "latest" ]; then base=https://github.com/yt-dlp/yt-dlp/releases/latest/download; \
    else base=https://github.com/yt-dlp/yt-dlp/releases/download/$YT_DLP_VERSION; fi; \
    curl -fsSL -o /usr/local/bin/yt-dlp "$base/$asset" \
 && chmod +x /usr/local/bin/yt-dlp \
 && yt-dlp --version
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/worker/node_modules apps/worker/node_modules
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY apps/worker/package.json apps/worker/
WORKDIR /app/apps/worker
USER node
CMD ["node", "dist/index.js"]
